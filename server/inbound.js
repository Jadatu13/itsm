/**
 * Inbound email poller.
 * Connects to an IMAP mailbox, processes UNSEEN messages, marks them as seen.
 * Uses dedicated imap_user / imap_pass credentials (separate from SMTP).
 */

const { ImapFlow }    = require('imapflow');
const { simpleParser } = require('mailparser');
const { randomUUID }  = require('crypto');
const fs              = require('fs');
const path            = require('path');
const db              = require('./db');
const { decrypt }     = require('./lib/crypto');
const { sendNewTicket, sendAgentNotification } = require('./email');
const { runAutomations } = require('./automations');

// Poison-message guard: track per-UID processing attempts so one bad message
// can't be retried forever on every poll. Resets on process restart.
const poisonCounts = new Map();
const MAX_PROCESS_ATTEMPTS = 3;

// ─── Notification helpers ─────────────────────────────────────────────────────

async function agentEmailEnabled() {
  try {
    const r = await db.query(`SELECT value FROM settings WHERE key = 'notifications_agent_email'`);
    if (!r.rows.length) return true;
    return r.rows[0].value !== 'false';
  } catch { return true; }
}

async function getRecipients(assignedTo) {
  if (assignedTo) {
    const r = await db.query('SELECT name, email FROM agents WHERE id = $1', [assignedTo]);
    return r.rows.length ? [{ name: r.rows[0].name, email: r.rows[0].email }] : [];
  }
  const r = await db.query(`SELECT name, email FROM agents WHERE role = 'admin' AND email IS NOT NULL`);
  return r.rows.map(a => ({ name: a.name, email: a.email }));
}

// ─── Config ───────────────────────────────────────────────────────────────────

async function getConfig() {
  try {
    const result = await db.query(
      `SELECT key, value FROM settings
       WHERE key IN ('imap_host','imap_port','imap_tls','imap_folder','imap_poll_interval','imap_user','imap_pass')`
    );
    const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    if (!s.imap_host || !s.imap_user) return null;
    return {
      host:         s.imap_host,
      port:         parseInt(s.imap_port   || '993', 10),
      tls:          s.imap_tls             !== 'false',
      folder:       s.imap_folder          || 'INBOX',
      pollInterval: parseInt(s.imap_poll_interval || '60', 10) * 1000,
      user:         s.imap_user,
      pass:         s.imap_pass ? decrypt(s.imap_pass) : '',
    };
  } catch {
    return null;
  }
}

// ─── Quote stripper ───────────────────────────────────────────────────────────
// Removes forwarded/quoted content so we only store the user's actual reply.

function stripQuotedReply(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i];
    const trimmed = line.trim();

    // Outlook horizontal divider (10+ underscores)
    if (/^_{10,}$/.test(trimmed)) break;

    // "On [date] ... wrote:" — single line (Gmail / Apple Mail)
    if (/^On .{10,}wrote:\s*$/i.test(trimmed)) break;

    // "On [date] ..., \n  XYZ wrote:" — two-line Gmail variant
    if (/^On .+,\s*$/.test(trimmed) && i + 1 < lines.length) {
      if (/wrote:\s*$/i.test((lines[i + 1] || '').trim())) break;
    }

    // Outlook "From: " header block (signals the original message)
    if (/^From:\s+\S/.test(trimmed) && i > 0) break;

    // Standard email signature separator "-- "
    if (trimmed === '--' || trimmed === '-- ') break;

    // Skip quoted lines that start with >
    if (trimmed.startsWith('>')) continue;

    result.push(line);
  }

  // Strip trailing blank lines
  while (result.length && !result[result.length - 1].trim()) result.pop();

  return result.join('\n').trim();
}

// Strip quoted HTML reply blocks by cutting at known divider patterns
function stripQuotedHtml(html) {
  if (!html) return '';
  const dividers = [
    /<div[^>]+id=["']divRplyFwdMsg["'][^>]*>/i,
    /<div[^>]+class=["'][^"']*gmail_quote[^"']*["'][^>]*>/i,
    /<div[^>]+class=["'][^"']*yahoo_quoted[^"']*["'][^>]*>/i,
    /<blockquote[^>]*>/i,
  ];
  let cutIdx = html.length;
  for (const pattern of dividers) {
    const m = pattern.exec(html);
    if (m && m.index < cutIdx) cutIdx = m.index;
  }
  return html.slice(0, cutIdx).trim();
}

// ─── Attachment saver ─────────────────────────────────────────────────────────

async function saveAttachments(parsedAttachments, ticketId, replyId, htmlBody) {
  let updatedHtml = htmlBody;
  for (const att of (parsedAttachments || [])) {
    if (!att.content || att.content.length < 100) continue;
    const ext = path.extname(att.filename || '') || '';
    const storedName = `${randomUUID()}${ext}`;
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR || '/data/uploads', storedName), att.content);
    const saved = await db.query(
      `INSERT INTO ticket_attachments (ticket_id, reply_id, filename, original_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [ticketId, replyId || null, storedName, att.filename || storedName, att.contentType || null, att.content.length]
    );
    // Replace cid: references in HTML body. Escape the (attacker-controlled) cid
    // so regex metacharacters can't cause unintended replacements or ReDoS.
    if (att.cid && updatedHtml) {
      const escapedCid = att.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      updatedHtml = updatedHtml.replace(new RegExp(`cid:${escapedCid}`, 'g'), `/api/attachments/${saved.rows[0].id}`);
    }
  }
  return updatedHtml;
}

// ─── Email processor ──────────────────────────────────────────────────────────

async function processMessage(parsed) {
  const fromAddr = parsed.from?.value?.[0];
  if (!fromAddr?.address) return;

  const senderEmail   = fromAddr.address.toLowerCase().trim();
  const senderName    = (fromAddr.name || '').trim();
  const subject       = (parsed.subject || '(No subject)').trim();

  // Prefer HTML; strip quoted HTML blocks. Fall back to plain text wrapped in <p>.
  let htmlBody;
  if (parsed.html) {
    htmlBody = stripQuotedHtml(parsed.html);
  } else if (parsed.text) {
    const stripped = stripQuotedReply(parsed.text);
    htmlBody = stripped.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  } else {
    htmlBody = '';
  }

  // Plain-text body for ticket description / email notifications (strip tags)
  const plainBody = (htmlBody || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // ── Reply detection ──────────────────────────────────────────────────────
  // If the subject contains [TKT-XXXX] add a contact reply to that ticket.
  const refMatch = subject.match(/\[TKT-(\d+)\]/i);
  if (refMatch) {
    const ref = `TKT-${refMatch[1].padStart(4, '0')}`;
    const found = await db.query(
      `SELECT t.id, LOWER(c.email) AS contact_email
       FROM tickets t LEFT JOIN contacts c ON c.id = t.contact_id
       WHERE t.reference = $1`,
      [ref]
    );
    // Only append to an existing ticket if the sender is that ticket's contact.
    // This prevents anyone from injecting replies into arbitrary tickets by
    // guessing the sequential [TKT-####] reference. Otherwise fall through and
    // treat the message as a brand-new ticket.
    if (found.rows.length && found.rows[0].contact_email === senderEmail) {
      const ticketId = found.rows[0].id;
      const replyRes = await db.query(
        `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal)
         VALUES ($1, $2, false, false) RETURNING id`,
        [ticketId, htmlBody || '(empty)']
      );
      const replyId = replyRes.rows[0].id;
      // Save attachments
      const updatedHtml = await saveAttachments(parsed.attachments, ticketId, replyId, htmlBody);
      // If cid replacements happened, update the reply body
      if (updatedHtml !== htmlBody) {
        await db.query(`UPDATE ticket_replies SET body = $1 WHERE id = $2`, [updatedHtml, replyId]);
      }
      await db.query(`UPDATE tickets SET updated_at = NOW() WHERE id = $1`, [ticketId]);
      console.log(`[inbound] Reply added to ${ref}`);
      // Fire-and-forget automation for reply_received
      db.query('SELECT * FROM tickets WHERE id=$1', [ticketId]).then(r => {
        if (r.rows[0]) runAutomations(r.rows[0], 'reply_received', { db }).catch(e => console.error('[automation]', e));
      });
      // Notify assigned agent of contact reply
      agentEmailEnabled().then(async enabled => {
        if (!enabled) return;
        const info = await db.query(
          `SELECT t.reference, t.subject, t.assigned_to, t.id,
                  c.first_name || ' ' || c.last_name AS contact_name
           FROM tickets t JOIN contacts c ON c.id = t.contact_id WHERE t.id = $1`,
          [ticketId]
        );
        if (!info.rows.length) return;
        const { reference: tRef, subject, assigned_to, id: tId, contact_name } = info.rows[0];
        const recipients = await getRecipients(assigned_to);
        const plainPreview = (htmlBody || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        for (const rec of recipients) {
          sendAgentNotification({
            to:            rec.email,
            agentName:     rec.name,
            event:         'New reply from contact',
            reference:     tRef,
            ticketId:      tId,
            ticketSubject: subject,
            contactName:   contact_name,
            previewText:   plainPreview,
          }).catch(e => console.error('[notify] inbound reply:', e.message));
        }
      }).catch(e => console.error('[notify] inbound reply setting:', e.message));
      return;
    }
    // Reference not found — fall through and create a new ticket
  }

  // ── Find or create contact ───────────────────────────────────────────────
  let contactRow = await db.query(
    `SELECT id, first_name FROM contacts WHERE LOWER(email) = $1`,
    [senderEmail]
  );

  let contactId, firstName;

  if (contactRow.rows.length) {
    ({ id: contactId, first_name: firstName } = contactRow.rows[0]);
  } else {
    // Parse display name into first / last
    const nameParts = senderName ? senderName.split(/\s+/) : [];
    const first = nameParts[0] || senderEmail.split('@')[0];
    const last  = nameParts.slice(1).join(' ') || 'Unknown';

    // Domain → organisation lookup
    const domain = senderEmail.split('@')[1];
    let orgId = null;
    if (domain) {
      const orgRes = await db.query(
        `SELECT o.id FROM organisations o
         JOIN organisation_domains od ON od.organisation_id = o.id
         WHERE od.domain = $1`,
        [domain]
      );
      if (orgRes.rows.length) orgId = orgRes.rows[0].id;
    }

    const created = await db.query(
      `INSERT INTO contacts (first_name, last_name, email, organisation_id)
       VALUES ($1, $2, $3, $4) RETURNING id, first_name`,
      [first, last, senderEmail, orgId]
    );
    ({ id: contactId, first_name: firstName } = created.rows[0]);
    console.log(`[inbound] Auto-created contact for ${senderEmail}`);
  }

  // ── Create ticket ────────────────────────────────────────────────────────
  let slaHoursLow = 72;
  try {
    const slaCfg = await db.query(`SELECT value FROM settings WHERE key = 'sla_hours_low'`);
    if (slaCfg.rows.length) slaHoursLow = parseInt(slaCfg.rows[0].value, 10) || 72;
  } catch { /* use default */ }

  const ins = await db.query(
    `INSERT INTO tickets (subject, description, contact_id, priority, source, sla_due_at)
     VALUES ($1, $2, $3, 'low', 'email', NOW() + ($4 || ' hours')::INTERVAL) RETURNING id`,
    [subject, plainBody || '(empty)', contactId, String(slaHoursLow)]
  );

  const ticketId = ins.rows[0].id;

  // Save any attachments at the ticket level (no reply yet for new tickets from email)
  await saveAttachments(parsed.attachments, ticketId, null, htmlBody);

  // Fetch full ticket for confirmation email
  const tRow = await db.query(
    `SELECT t.reference, c.email AS contact_email, c.first_name
     FROM tickets t JOIN contacts c ON c.id = t.contact_id WHERE t.id = $1`,
    [ticketId]
  );

  if (tRow.rows.length) {
    const { reference, contact_email, first_name: fn } = tRow.rows[0];
    console.log(`[inbound] Created ticket ${reference} from ${senderEmail}`);
    sendNewTicket({ to: contact_email, firstName: fn, reference, subject, description: plainBody });
    // Fire-and-forget automation for ticket_created
    db.query('SELECT * FROM tickets WHERE id=$1', [ticketId]).then(r => {
      if (r.rows[0]) runAutomations(r.rows[0], 'ticket_created', { db }).catch(e => console.error('[automation]', e));
    });
    // Notify agent(s) of new inbound ticket
    agentEmailEnabled().then(async enabled => {
      if (!enabled) return;
      // New tickets from email are always unassigned initially
      const recipients = await getRecipients(null);
      for (const rec of recipients) {
        sendAgentNotification({
          to:            rec.email,
          agentName:     rec.name,
          event:         'New ticket created',
          reference,
          ticketId,
          ticketSubject: subject,
          contactName:   senderName || senderEmail,
          previewText:   plainBody,
        }).catch(e => console.error('[notify] inbound new ticket:', e.message));
      }
    }).catch(e => console.error('[notify] inbound new ticket setting:', e.message));
  }
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

async function poll() {
  const config = await getConfig();
  if (!config) return; // not configured yet

  const client = new ImapFlow({
    host:   config.host,
    port:   config.port,
    secure: config.tls,
    auth:   { user: config.user, pass: config.pass },
    logger: false,
    // Verify the server certificate by default. Self-signed certs may be allowed
    // only by explicitly setting IMAP_ALLOW_SELF_SIGNED=true (non-production).
    tls:    { rejectUnauthorized: process.env.IMAP_ALLOW_SELF_SIGNED !== 'true' },
  });

  // Prevent unhandled 'error' events from crashing the process
  client.on('error', err => {
    console.error('[inbound] IMAP client error:', err.message);
  });

  try {
    await client.connect();
    console.log(`[inbound] Connected to ${config.host} as ${config.user}`);
    const lock = await client.getMailboxLock(config.folder);

    try {
      const status = await client.status(config.folder, { messages: true, unseen: true });
      console.log(`[inbound] Mailbox "${config.folder}": ${status.messages} total, ${status.unseen} unseen`);

      const uids = await client.search({ seen: false });
      if (uids.length) {
        console.log(`[inbound] Processing ${uids.length} unseen message(s)…`);
        for (const uid of uids) {
          try {
            const msg = await client.fetchOne(uid, { source: true });
            let parsed;
            try {
              parsed = await simpleParser(msg.source);
            } catch (parseErr) {
              // Malformed message — permanent failure. Mark seen so it doesn't
              // loop forever poisoning every poll.
              console.error(`[inbound] uid ${uid} is unparseable, skipping:`, parseErr.message);
              await client.messageFlagsAdd(uid, ['\\Seen']);
              poisonCounts.delete(uid);
              continue;
            }
            await processMessage(parsed);
            await client.messageFlagsAdd(uid, ['\\Seen']);
            poisonCounts.delete(uid);
          } catch (err) {
            // Possibly transient (e.g. DB blip) — retry a few times, then give up
            // and mark seen so a single bad message can't block the queue forever.
            const n = (poisonCounts.get(uid) || 0) + 1;
            poisonCounts.set(uid, n);
            console.error(`[inbound] Error processing uid ${uid} (attempt ${n}):`, err.message);
            if (n >= MAX_PROCESS_ATTEMPTS) {
              console.error(`[inbound] uid ${uid} failed ${n}x — marking seen to avoid a poison loop.`);
              try { await client.messageFlagsAdd(uid, ['\\Seen']); } catch { /* ignore */ }
              poisonCounts.delete(uid);
            }
          }
        }
      } else {
        console.log('[inbound] No unseen messages — if you expected emails, make sure they are unread in the mailbox.');
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    console.error('[inbound] IMAP error:', err.message);
    if (err.authenticationFailed) {
      console.error('[inbound] Authentication failed — check your IMAP username and password in Settings.');
    }
    try { await client.logout(); } catch { /* ignore */ }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

async function tick() {
  await poll().catch(err => console.error('[inbound] Poll failed:', err.message));
  const config   = await getConfig().catch(() => null);
  const interval = config?.pollInterval ?? 60_000;
  _timer = setTimeout(tick, interval);
}

function startPoller() {
  // Delay first poll 15 s so the server finishes initialising
  _timer = setTimeout(tick, 15_000);
  console.log('[inbound] Email poller started (first check in 15 s)');
}

module.exports = { startPoller, poll };

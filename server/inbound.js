/**
 * Inbound email poller.
 * Connects to an IMAP mailbox, processes UNSEEN messages, marks them as seen.
 * Uses dedicated imap_user / imap_pass credentials (separate from SMTP).
 */

const { ImapFlow }    = require('imapflow');
const { simpleParser } = require('mailparser');
const db              = require('./db');
const { decrypt }     = require('./lib/crypto');
const { sendNewTicket } = require('./email');
const { runAutomations } = require('./automations');

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

// ─── Email processor ──────────────────────────────────────────────────────────

async function processMessage(parsed) {
  const fromAddr = parsed.from?.value?.[0];
  if (!fromAddr?.address) return;

  const senderEmail   = fromAddr.address.toLowerCase().trim();
  const senderName    = (fromAddr.name || '').trim();
  const subject       = (parsed.subject || '(No subject)').trim();

  // Prefer plain text; strip tags from HTML as fallback — then strip quoted reply chain
  const rawBody = (
    parsed.text?.trim() ||
    (parsed.html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() ||
    ''
  );
  const body = stripQuotedReply(rawBody);

  // ── Reply detection ──────────────────────────────────────────────────────
  // If the subject contains [TKT-XXXX] add a contact reply to that ticket.
  const refMatch = subject.match(/\[TKT-(\d+)\]/i);
  if (refMatch) {
    const ref = `TKT-${refMatch[1].padStart(4, '0')}`;
    const found = await db.query(`SELECT id FROM tickets WHERE reference = $1`, [ref]);
    if (found.rows.length) {
      await db.query(
        `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal)
         VALUES ($1, $2, false, false)`,
        [found.rows[0].id, body || '(empty)']
      );
      await db.query(`UPDATE tickets SET updated_at = NOW() WHERE id = $1`, [found.rows[0].id]);
      console.log(`[inbound] Reply added to ${ref}`);
      // Fire-and-forget automation for reply_received
      const replyTicketId = found.rows[0].id;
      db.query('SELECT * FROM tickets WHERE id=$1', [replyTicketId]).then(r => {
        if (r.rows[0]) runAutomations(r.rows[0], 'reply_received', { db }).catch(e => console.error('[automation]', e));
      });
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
    [subject, body || '(empty)', contactId, String(slaHoursLow)]
  );

  const ticketId = ins.rows[0].id;

  // Fetch full ticket for confirmation email
  const tRow = await db.query(
    `SELECT t.reference, c.email AS contact_email, c.first_name
     FROM tickets t JOIN contacts c ON c.id = t.contact_id WHERE t.id = $1`,
    [ticketId]
  );

  if (tRow.rows.length) {
    const { reference, contact_email, first_name: fn } = tRow.rows[0];
    console.log(`[inbound] Created ticket ${reference} from ${senderEmail}`);
    sendNewTicket({ to: contact_email, firstName: fn, reference, subject, description: body });
    // Fire-and-forget automation for ticket_created
    db.query('SELECT * FROM tickets WHERE id=$1', [ticketId]).then(r => {
      if (r.rows[0]) runAutomations(r.rows[0], 'ticket_created', { db }).catch(e => console.error('[automation]', e));
    });
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
    tls:    { rejectUnauthorized: false }, // allow self-signed certs
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
            const msg    = await client.fetchOne(uid, { source: true });
            const parsed = await simpleParser(msg.source);
            await processMessage(parsed);
            await client.messageFlagsAdd(uid, ['\\Seen']);
          } catch (err) {
            console.error(`[inbound] Error processing uid ${uid}:`, err.message);
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

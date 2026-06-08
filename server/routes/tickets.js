const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { sendNewTicket, sendAgentReply, sendTicketResolved, sendAgentNotification, sendMentionNotification, stripTags } = require('../email');
const { runAutomations } = require('../automations');
const requireAdmin = require('../middleware/requireAdmin');
const { logAudit }  = require('../lib/audit');

const storage = multer.diskStorage({
  destination: '/data/uploads',
  filename: (req, file, cb) => {
    const { randomUUID } = require('crypto');
    cb(null, `${randomUUID()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// GET /api/tickets
// status=active  → all non-resolved (default in UI)
// status=<value> → specific status
// search=<text>  → subject ILIKE search
router.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    const params = [];
    const conditions = [];

    if (status === 'active') {
      conditions.push(`t.status != 'resolved'::ticket_status`);
    } else if (status) {
      params.push(status);
      conditions.push(`t.status = $${params.length}::ticket_status`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(t.subject ILIKE $${params.length} OR t.reference ILIKE $${params.length})`);
    }

    if (req.query.priority) {
      params.push(req.query.priority);
      conditions.push(`t.priority = $${params.length}::ticket_priority`);
    }

    if (req.query.category) {
      params.push(req.query.category);
      conditions.push(`t.category = $${params.length}`);
    }

    if (req.query.organisation_id) {
      params.push(req.query.organisation_id);
      conditions.push(`c.organisation_id = $${params.length}`);
    }

    if (req.query.source) {
      params.push(req.query.source);
      conditions.push(`t.source = $${params.length}`);
    }

    if (req.query.assigned_to === 'none') {
      conditions.push(`t.assigned_to IS NULL`);
    } else if (req.query.assigned_to && req.query.assigned_to !== 'me') {
      params.push(req.query.assigned_to);
      conditions.push(`t.assigned_to = $${params.length}`);
    }
    // 'me' is resolved client-side — the built-in "My Tickets" view sends the actual agent id via the assign dropdown

    if (req.query.sla === 'breached') {
      conditions.push(`t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW()`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT
        t.id, t.reference, t.subject, t.status, t.priority, t.category, t.source,
        t.created_at, t.updated_at, t.sla_due_at,
        c.first_name || ' ' || c.last_name AS contact_name,
        c.id AS contact_id,
        o.name AS organisation_name,
        o.id AS organisation_id,
        a.id AS assigned_to,
        a.name AS assigned_name
       FROM tickets t
       JOIN contacts c ON c.id = t.contact_id
       LEFT JOIN organisations o ON o.id = c.organisation_id
       LEFT JOIN agents a ON a.id = t.assigned_to
       ${where}
       ORDER BY t.id DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// GET /api/tickets/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
        t.id, t.reference, t.subject, t.description, t.status, t.priority, t.category, t.source,
        t.created_at, t.updated_at, t.sla_due_at,
        c.id AS contact_id,
        c.first_name || ' ' || c.last_name AS contact_name,
        c.email AS contact_email,
        o.id AS organisation_id,
        o.name AS organisation_name,
        a.id AS assigned_to,
        a.name AS assigned_name
       FROM tickets t
       JOIN contacts c ON c.id = t.contact_id
       LEFT JOIN organisations o ON o.id = c.organisation_id
       LEFT JOIN agents a ON a.id = t.assigned_to
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

// ─── Notification helpers ─────────────────────────────────────────────────────

/** Returns true when agent email notifications are enabled (default: true). */
async function agentEmailEnabled() {
  try {
    const r = await db.query(`SELECT value FROM settings WHERE key = 'notifications_agent_email'`);
    if (!r.rows.length) return true; // default on
    return r.rows[0].value !== 'false';
  } catch { return true; }
}

/**
 * Returns { email, name } for the ticket's assigned agent, or all admin agents if unassigned.
 * Returns an empty array when there is nobody to notify.
 */
async function getRecipients(assignedTo) {
  if (assignedTo) {
    const r = await db.query('SELECT name, email FROM agents WHERE id = $1', [assignedTo]);
    return r.rows.length ? [{ name: r.rows[0].name, email: r.rows[0].email }] : [];
  }
  const r = await db.query(`SELECT name, email FROM agents WHERE role = 'admin' AND email IS NOT NULL`);
  return r.rows.map(a => ({ name: a.name, email: a.email }));
}

async function getSlaHours() {
  try {
    const result = await db.query(`SELECT key, value FROM settings WHERE key LIKE 'sla_%'`);
    const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    return {
      high:   parseInt(s.sla_hours_high   || '4',  10),
      medium: parseInt(s.sla_hours_medium  || '24', 10),
      low:    parseInt(s.sla_hours_low     || '72', 10),
    };
  } catch {
    return { high: 4, medium: 24, low: 72 };
  }
}

// POST /api/tickets
router.post('/', async (req, res) => {
  const { subject, description, contact_id, priority, category, source } = req.body;
  if (!subject || !description || !contact_id) {
    return res.status(400).json({ error: 'subject, description, and contact_id are required' });
  }
  try {
    const SLA_HOURS = await getSlaHours();
    const p = priority || 'low';
    const slaHours = SLA_HOURS[p] ?? 72;
    const result = await db.query(
      `INSERT INTO tickets (subject, description, contact_id, priority, category, source, sla_due_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' hours')::INTERVAL)
       RETURNING id`,
      [subject, description, contact_id, p, category || null, source || 'manual', slaHours]
    );
    const ticket = await db.query(
      `SELECT
        t.id, t.reference, t.subject, t.description, t.status, t.priority, t.category, t.source,
        t.created_at, t.updated_at, t.sla_due_at,
        c.first_name || ' ' || c.last_name AS contact_name,
        c.first_name,
        c.email AS contact_email,
        o.name AS organisation_name,
        a.id AS assigned_to, a.name AS assigned_name
       FROM tickets t
       JOIN contacts c ON c.id = t.contact_id
       LEFT JOIN organisations o ON o.id = c.organisation_id
       LEFT JOIN agents a ON a.id = t.assigned_to
       WHERE t.id = $1`,
      [result.rows[0].id]
    );
    const t = ticket.rows[0];
    res.status(201).json(t);

    // Fire-and-forget automations
    runAutomations(t, 'ticket_created', { db }).catch(e => console.error('[automation]', e));

    // Fire-and-forget email — never blocks the response
    sendNewTicket({
      to:          t.contact_email,
      firstName:   t.first_name,
      reference:   t.reference,
      subject:     t.subject,
      description: stripTags(t.description),
    });

    // Notify agent(s) of new ticket
    agentEmailEnabled().then(async enabled => {
      if (!enabled) return;
      const recipients = await getRecipients(t.assigned_to);
      for (const rec of recipients) {
        sendAgentNotification({
          to:           rec.email,
          agentName:    rec.name,
          event:        'New ticket created',
          reference:    t.reference,
          ticketId:     t.id,
          ticketSubject: t.subject,
          contactName:  t.contact_name,
          previewText:  stripTags(t.description),
        }).catch(e => console.error('[notify] new ticket:', e.message));
      }
    }).catch(e => console.error('[notify] new ticket setting:', e.message));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// PUT /api/tickets/:id
router.put('/:id', async (req, res) => {
  const { subject, description, contact_id, priority, category, source } = req.body;
  if (!subject || !description || !contact_id) {
    return res.status(400).json({ error: 'subject, description, and contact_id are required' });
  }
  try {
    const SLA_HOURS = await getSlaHours();
    const p = priority || 'low';
    const slaHours = SLA_HOURS[p] ?? 72;
    const update = await db.query(
      `UPDATE tickets
       SET subject = $1, description = $2, contact_id = $3,
           priority = $4, category = $5, source = $6,
           sla_due_at = created_at + ($7 || ' hours')::INTERVAL,
           updated_at = NOW()
       WHERE id = $8 RETURNING id`,
      [subject, description, contact_id, p, category || null, source || 'manual', slaHours, req.params.id]
    );
    if (!update.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    const ticket = await db.query(
      `SELECT
        t.id, t.reference, t.subject, t.description, t.status, t.priority, t.category, t.source,
        t.created_at, t.updated_at, t.sla_due_at,
        c.id AS contact_id,
        c.first_name || ' ' || c.last_name AS contact_name,
        c.email AS contact_email,
        o.id AS organisation_id,
        o.name AS organisation_name,
        a.id AS assigned_to, a.name AS assigned_name
       FROM tickets t
       JOIN contacts c ON c.id = t.contact_id
       LEFT JOIN organisations o ON o.id = c.organisation_id
       LEFT JOIN agents a ON a.id = t.assigned_to
       WHERE t.id = $1`,
      [req.params.id]
    );
    res.json(ticket.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// PATCH /api/tickets/:id/assign
router.patch('/:id/assign', async (req, res) => {
  const { assigned_to } = req.body;
  try {
    const before = await db.query('SELECT assigned_to FROM tickets WHERE id=$1', [req.params.id]);
    const oldAssignedTo = before.rows[0]?.assigned_to;

    const result = await db.query(
      `UPDATE tickets SET assigned_to = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, assigned_to`,
      [assigned_to || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    const agent = assigned_to
      ? await db.query('SELECT id, name, email FROM agents WHERE id=$1', [assigned_to]).then(r => r.rows[0])
      : null;

    // Audit log
    logAudit({ req, action: 'ticket.assigned', entityType: 'ticket', entityId: parseInt(req.params.id),
      oldValue: { assigned_to: oldAssignedTo }, newValue: { assigned_to: assigned_to || null } }).catch(() => {});

    res.json({ assigned_to: agent?.id ?? null, assigned_name: agent?.name ?? null });

    // Notify assigned agent
    if (agent?.email) {
      agentEmailEnabled().then(async enabled => {
        if (!enabled) return;
        const info = await db.query(
          `SELECT t.reference, t.subject, c.first_name || ' ' || c.last_name AS contact_name
           FROM tickets t JOIN contacts c ON c.id = t.contact_id WHERE t.id = $1`,
          [req.params.id]
        );
        if (!info.rows.length) return;
        const { reference, subject, contact_name } = info.rows[0];
        sendAgentNotification({
          to:            agent.email,
          agentName:     agent.name,
          event:         'Ticket assigned to you',
          reference,
          ticketId:      req.params.id,
          ticketSubject: subject,
          contactName:   contact_name,
        }).catch(e => console.error('[notify] assign:', e.message));
      }).catch(e => console.error('[notify] assign setting:', e.message));
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to assign ticket' });
  }
});

// PATCH /api/tickets/:id/status
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['open', 'in_progress', 'on_hold', 'resolved'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Valid status required' });
  }
  try {
    const before = await db.query('SELECT status FROM tickets WHERE id=$1', [req.params.id]);
    const oldStatus = before.rows[0]?.status;

    const result = await db.query(
      `UPDATE tickets SET status = $1::ticket_status, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    res.json(result.rows[0]);

    // Audit log
    logAudit({ req, action: 'ticket.status_changed', entityType: 'ticket', entityId: parseInt(req.params.id),
      oldValue: { status: oldStatus }, newValue: { status } }).catch(() => {});

    // Fire-and-forget automations on status change
    runAutomations(result.rows[0], 'status_changed', { db }).catch(e => console.error('[automation]', e));

    // Send resolved email if status just became resolved
    if (status === 'resolved') {
      const info = await db.query(
        `SELECT t.reference, t.subject, c.first_name, c.email
         FROM tickets t JOIN contacts c ON c.id = t.contact_id
         WHERE t.id = $1`,
        [req.params.id]
      );
      if (info.rows.length) {
        const { reference, subject, first_name, email } = info.rows[0];
        sendTicketResolved({ to: email, firstName: first_name, reference, ticketSubject: subject });
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE /api/tickets/:id — admin only
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const before = await db.query('SELECT id, reference, subject FROM tickets WHERE id=$1', [req.params.id]);
    const old = before.rows[0];
    const result = await db.query('DELETE FROM tickets WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    if (old) {
      logAudit({ req, action: 'ticket.deleted', entityType: 'ticket', entityId: old.id,
        oldValue: { reference: old.reference, subject: old.subject } }).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

// POST /api/tickets/:id/merge — move all replies to target, then delete source
router.post('/:id/merge', async (req, res) => {
  const sourceId = req.params.id;
  const { target_id } = req.body;
  if (!target_id) return res.status(400).json({ error: 'target_id is required' });
  if (String(sourceId) === String(target_id)) return res.status(400).json({ error: 'Cannot merge a ticket into itself' });
  try {
    // Fetch source ticket details before deleting
    const srcResult = await db.query(
      `SELECT t.reference, t.subject, t.description, t.priority, t.category,
              c.first_name || ' ' || c.last_name AS contact_name, c.email AS contact_email
       FROM tickets t
       LEFT JOIN contacts c ON c.id = t.contact_id
       WHERE t.id = $1`,
      [sourceId]
    );
    if (!srcResult.rows.length) return res.status(404).json({ error: 'Source ticket not found' });
    const src = srcResult.rows[0];

    // Move all replies from source to target
    await db.query('UPDATE ticket_replies SET ticket_id = $1 WHERE ticket_id = $2', [target_id, sourceId]);

    // Post an internal note on the target summarising what was merged in
    const agentName = req.agent?.name || 'An agent';
    const noteLines = [
      `<p><strong>${agentName} merged ${src.reference} into this ticket.</strong></p>`,
      `<p><strong>Subject:</strong> ${src.subject}</p>`,
      src.contact_name ? `<p><strong>Contact:</strong> ${src.contact_name} (${src.contact_email})</p>` : null,
      src.priority     ? `<p><strong>Priority:</strong> ${src.priority}</p>` : null,
      src.category     ? `<p><strong>Category:</strong> ${src.category}</p>` : null,
      src.description  ? `<hr/><p>${src.description.replace(/\n/g, '<br>')}</p>` : null,
    ].filter(Boolean).join('');

    await db.query(
      `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal, sender_name)
       VALUES ($1, $2, true, true, 'System')`,
      [target_id, noteLines]
    );

    // Delete the source ticket (cascade removes any remaining replies)
    await db.query('DELETE FROM tickets WHERE id = $1', [sourceId]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to merge tickets' });
  }
});

// GET /api/tickets/:id/replies
router.get('/:id/replies', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.id, r.ticket_id, r.body, r.is_agent_reply, r.is_internal, r.created_at,
              CASE WHEN r.is_agent_reply OR r.is_internal THEN COALESCE(r.sender_name, 'Support Agent')
                   ELSE c.first_name || ' ' || c.last_name
              END AS sender_name
       FROM ticket_replies r
       JOIN tickets t ON t.id = r.ticket_id
       JOIN contacts c ON c.id = t.contact_id
       WHERE r.ticket_id = $1
       ORDER BY r.created_at ASC`,
      [req.params.id]
    );
    const replies = result.rows;

    // Fetch attachments for all replies
    if (replies.length) {
      const replyIds = replies.map(r => r.id);
      const attResult = await db.query(
        `SELECT * FROM ticket_attachments WHERE reply_id = ANY($1::int[])`,
        [replyIds]
      );
      const attMap = {};
      for (const att of attResult.rows) {
        if (!attMap[att.reply_id]) attMap[att.reply_id] = [];
        attMap[att.reply_id].push(att);
      }
      for (const reply of replies) {
        reply.attachments = attMap[reply.id] || [];
      }
    }

    res.json(replies);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch replies' });
  }
});

// POST /api/tickets/:id/replies
router.post('/:id/replies', upload.array('files', 10), async (req, res) => {
  const { body, is_agent_reply, is_internal } = req.body;
  if (!body) return res.status(400).json({ error: 'body is required' });
  const isAgent    = is_agent_reply === true || is_agent_reply === 'true';
  const isInternal = is_internal    === true || is_internal    === 'true';
  try {
    const ticketCheck = await db.query(
      `SELECT t.id, t.reference, t.subject, c.first_name, c.email
       FROM tickets t JOIN contacts c ON c.id = t.contact_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!ticketCheck.rows.length) return res.status(404).json({ error: 'Ticket not found' });

    const senderName = (isAgent || isInternal) ? (req.agent?.name || null) : null;
    const result = await db.query(
      `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal, sender_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, body, isAgent || isInternal, isInternal, senderName]
    );
    const reply = result.rows[0];

    // Save uploaded files to ticket_attachments
    const attachments = [];
    if (req.files && req.files.length) {
      for (const file of req.files) {
        const attResult = await db.query(
          `INSERT INTO ticket_attachments (ticket_id, reply_id, filename, original_name, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [req.params.id, reply.id, file.filename, file.originalname, file.mimetype, file.size]
        );
        attachments.push(attResult.rows[0]);
      }
    }

    res.status(201).json({ ...reply, attachments });

    // Only email the contact for non-internal agent replies
    if (isAgent && !isInternal) {
      const { reference, subject, first_name, email } = ticketCheck.rows[0];
      // Fetch prior non-internal replies for the history thread (newest first, excluding the one just inserted)
      const historyResult = await db.query(
        `SELECT r.body, r.is_agent_reply, r.created_at,
                CASE WHEN r.is_agent_reply THEN COALESCE(r.sender_name, 'Support Agent')
                     ELSE c.first_name || ' ' || c.last_name
                END AS sender_name
         FROM ticket_replies r
         JOIN tickets t ON t.id = r.ticket_id
         JOIN contacts c ON c.id = t.contact_id
         WHERE r.ticket_id = $1
           AND r.is_internal = false
           AND r.id != $2
         ORDER BY r.created_at DESC`,
        [req.params.id, reply.id]
      );
      sendAgentReply({
        to:            email,
        firstName:     first_name,
        reference,
        ticketSubject: subject,
        replyBody:     body,
        agentName:     req.agent?.name || 'Support Agent',
        history:       historyResult.rows,
      });
    }

    // Notify assigned agent when contact replies (not agent, not internal)
    if (!isAgent && !isInternal) {
      agentEmailEnabled().then(async enabled => {
        if (!enabled) return;
        const info = await db.query(
          `SELECT t.reference, t.subject, t.assigned_to,
                  c.first_name || ' ' || c.last_name AS contact_name
           FROM tickets t JOIN contacts c ON c.id = t.contact_id WHERE t.id = $1`,
          [req.params.id]
        );
        if (!info.rows.length) return;
        const { reference, subject, assigned_to, contact_name } = info.rows[0];
        const recipients = await getRecipients(assigned_to);
        const plainPreview = stripTags(body);
        for (const rec of recipients) {
          sendAgentNotification({
            to:            rec.email,
            agentName:     rec.name,
            event:         'New reply from contact',
            reference,
            ticketId:      req.params.id,
            ticketSubject: subject,
            contactName:   contact_name,
            previewText:   plainPreview,
          }).catch(e => console.error('[notify] contact reply:', e.message));
        }
      }).catch(e => console.error('[notify] contact reply setting:', e.message));
    }

    // Handle @mentions in internal notes
    if (isInternal) {
      agentEmailEnabled().then(async enabled => {
        if (!enabled) return;
        const plainBody = stripTags(body);
        const mentionMatches = plainBody.match(/@([A-Za-z][A-Za-z0-9 _-]{0,49})/g);
        if (!mentionMatches || !mentionMatches.length) return;

        const info = await db.query(
          `SELECT t.reference, t.subject FROM tickets t WHERE t.id = $1`,
          [req.params.id]
        );
        if (!info.rows.length) return;
        const { reference, subject } = info.rows[0];

        // Fetch all agents to match mentions against
        const agentsRes = await db.query('SELECT id, name, email FROM agents WHERE email IS NOT NULL');
        const allAgents = agentsRes.rows;

        const authorName = req.agent?.name || 'An agent';
        const notified = new Set();

        for (const mention of mentionMatches) {
          const query = mention.slice(1).toLowerCase(); // strip @
          for (const ag of allAgents) {
            if (notified.has(ag.id)) continue;
            if (ag.name.toLowerCase().includes(query)) {
              notified.add(ag.id);
              sendMentionNotification({
                to:                 ag.email,
                mentionedAgentName: ag.name,
                authorName,
                reference,
                ticketId:           req.params.id,
                ticketSubject:      subject,
                notePreview:        plainBody,
              }).catch(e => console.error('[notify] mention:', e.message));
            }
          }
        }
      }).catch(e => console.error('[notify] mention setting:', e.message));
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add reply' });
  }
});

// POST /api/tickets/bulk
// Body: { ids: [1,2,3], action: 'assign'|'status'|'priority'|'resolve', value: '...' }
router.post('/bulk', async (req, res) => {
  const { ids, action, value } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (!action) return res.status(400).json({ error: 'action is required' });

  const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');

  try {
    let result;
    if (action === 'assign') {
      result = await db.query(
        `UPDATE tickets SET assigned_to = $1, updated_at = NOW() WHERE id IN (${placeholders}) RETURNING id`,
        [value || null, ...ids]
      );
    } else if (action === 'status') {
      const validStatuses = ['open', 'in_progress', 'on_hold', 'resolved'];
      if (!validStatuses.includes(value)) return res.status(400).json({ error: 'Invalid status value' });
      result = await db.query(
        `UPDATE tickets SET status = $1::ticket_status, updated_at = NOW() WHERE id IN (${placeholders}) RETURNING id`,
        [value, ...ids]
      );
    } else if (action === 'priority') {
      const validPriorities = ['low', 'medium', 'high'];
      if (!validPriorities.includes(value)) return res.status(400).json({ error: 'Invalid priority value' });
      result = await db.query(
        `UPDATE tickets SET priority = $1::ticket_priority, updated_at = NOW() WHERE id IN (${placeholders}) RETURNING id`,
        [value, ...ids]
      );
    } else if (action === 'resolve') {
      const resolvePlaceholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      result = await db.query(
        `UPDATE tickets SET status = 'resolved'::ticket_status, updated_at = NOW() WHERE id IN (${resolvePlaceholders}) RETURNING id`,
        [...ids]
      );
    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }
    res.json({ updated: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Bulk action failed' });
  }
});

// GET /api/tickets/:id/time — list time entries for a ticket
router.get('/:id/time', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT tte.id, tte.ticket_id, tte.agent_id, tte.minutes, tte.note, tte.logged_at,
              a.name AS agent_name
       FROM ticket_time_entries tte
       LEFT JOIN agents a ON a.id = tte.agent_id
       WHERE tte.ticket_id = $1
       ORDER BY tte.logged_at DESC`,
      [req.params.id]
    );
    const total = result.rows.reduce((sum, r) => sum + r.minutes, 0);
    res.json({ entries: result.rows, total_minutes: total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch time entries' });
  }
});

// POST /api/tickets/:id/time — log time for a ticket
router.post('/:id/time', async (req, res) => {
  const { minutes, note, agent_id } = req.body;
  if (!minutes || isNaN(parseInt(minutes)) || parseInt(minutes) < 1) {
    return res.status(400).json({ error: 'minutes must be a positive integer' });
  }
  try {
    const ticketCheck = await db.query('SELECT id FROM tickets WHERE id = $1', [req.params.id]);
    if (!ticketCheck.rows.length) return res.status(404).json({ error: 'Ticket not found' });

    const agentId = agent_id || req.agent?.id || null;
    const result = await db.query(
      `INSERT INTO ticket_time_entries (ticket_id, agent_id, minutes, note)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, agentId, parseInt(minutes), note || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log time' });
  }
});

// GET /api/tickets/:id/custom-fields — get custom field values for a ticket
router.get('/:id/custom-fields', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT tfv.field_key, tfv.value, tcf.label, tcf.field_type, tcf.options, tcf.sort_order
       FROM ticket_field_values tfv
       JOIN ticket_custom_fields tcf ON tcf.field_key = tfv.field_key
       WHERE tfv.ticket_id = $1
       ORDER BY tcf.sort_order`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch custom field values' });
  }
});

// PUT /api/tickets/:id/custom-fields — upsert field values { field_key: value }
router.put('/:id/custom-fields', async (req, res) => {
  const values = req.body;
  if (typeof values !== 'object' || Array.isArray(values)) {
    return res.status(400).json({ error: 'Body must be an object of field_key: value pairs' });
  }
  try {
    const ticketCheck = await db.query('SELECT id FROM tickets WHERE id = $1', [req.params.id]);
    if (!ticketCheck.rows.length) return res.status(404).json({ error: 'Ticket not found' });

    for (const [fieldKey, value] of Object.entries(values)) {
      await db.query(
        `INSERT INTO ticket_field_values (ticket_id, field_key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (ticket_id, field_key) DO UPDATE SET value = EXCLUDED.value`,
        [req.params.id, fieldKey, value === null || value === '' ? null : String(value)]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save custom field values' });
  }
});

module.exports = router;

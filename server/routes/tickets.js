const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendNewTicket, sendAgentReply, sendTicketResolved } = require('../email');
const { runAutomations } = require('../automations');

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
      description: t.description,
    });
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
    const result = await db.query(
      `UPDATE tickets SET assigned_to = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, assigned_to`,
      [assigned_to || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    const agent = assigned_to
      ? await db.query('SELECT id, name FROM agents WHERE id=$1', [assigned_to]).then(r => r.rows[0])
      : null;
    res.json({ assigned_to: agent?.id ?? null, assigned_name: agent?.name ?? null });
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
    const result = await db.query(
      `UPDATE tickets SET status = $1::ticket_status, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    res.json(result.rows[0]);

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

// DELETE /api/tickets/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM tickets WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket not found' });
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
    const noteLines = [
      `<p><strong>Merged from ${src.reference}</strong></p>`,
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
              CASE WHEN r.is_agent_reply OR r.is_internal THEN 'Support Agent'
                   ELSE c.first_name || ' ' || c.last_name
              END AS sender_name
       FROM ticket_replies r
       JOIN tickets t ON t.id = r.ticket_id
       JOIN contacts c ON c.id = t.contact_id
       WHERE r.ticket_id = $1
       ORDER BY r.created_at ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch replies' });
  }
});

// POST /api/tickets/:id/replies
router.post('/:id/replies', async (req, res) => {
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

    const result = await db.query(
      `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, body, isAgent || isInternal, isInternal]
    );
    res.status(201).json(result.rows[0]);

    // Only email the contact for non-internal agent replies
    if (isAgent && !isInternal) {
      const { reference, subject, first_name, email } = ticketCheck.rows[0];
      sendAgentReply({
        to:            email,
        firstName:     first_name,
        reference,
        ticketSubject: subject,
        replyBody:     body,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add reply' });
  }
});

module.exports = router;

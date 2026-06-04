const express      = require('express');
const router       = express.Router();
const db           = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const { logAudit } = require('../lib/audit');

// GET /api/contacts  (optional ?q= for search)
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE (c.first_name || ' ' || c.last_name ILIKE $1 OR c.email ILIKE $1)`;
    }
    const result = await db.query(
      `SELECT
        c.id, c.first_name, c.last_name, c.email, c.phone, c.created_at,
        c.first_name || ' ' || c.last_name AS full_name,
        o.id AS organisation_id,
        o.name AS organisation_name,
        COUNT(t.id)::int AS ticket_count
       FROM contacts c
       LEFT JOIN organisations o ON o.id = c.organisation_id
       LEFT JOIN tickets t ON t.contact_id = c.id
       ${where}
       GROUP BY c.id, o.id, o.name
       ORDER BY lower(c.first_name) NULLS LAST, lower(c.last_name) NULLS LAST`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// GET /api/contacts/:id
router.get('/:id', async (req, res) => {
  try {
    const contactResult = await db.query(
      `SELECT
        c.id, c.first_name, c.last_name, c.email, c.phone, c.notes, c.created_at,
        c.first_name || ' ' || c.last_name AS full_name,
        o.id AS organisation_id,
        o.name AS organisation_name
       FROM contacts c
       LEFT JOIN organisations o ON o.id = c.organisation_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!contactResult.rows.length) return res.status(404).json({ error: 'Contact not found' });

    const ticketsResult = await db.query(
      `SELECT
        t.id, t.reference, t.subject, t.status, t.priority,
        t.created_at, t.updated_at
       FROM tickets t
       WHERE t.contact_id = $1
       ORDER BY t.id ASC`,
      [req.params.id]
    );

    res.json({ ...contactResult.rows[0], tickets: ticketsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch contact' });
  }
});

// POST /api/contacts
router.post('/', async (req, res) => {
  const { first_name, last_name, email, organisation_id, phone, notes } = req.body;
  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: 'first_name, last_name, and email are required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO contacts (first_name, last_name, email, organisation_id, phone, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [first_name, last_name, email, organisation_id || null, phone || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A contact with that email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

// PUT /api/contacts/:id
router.put('/:id', async (req, res) => {
  const { first_name, last_name, email, organisation_id, phone, notes } = req.body;
  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: 'first_name, last_name, and email are required' });
  }
  try {
    const result = await db.query(
      `UPDATE contacts
       SET first_name = $1, last_name = $2, email = $3, organisation_id = $4, phone = $5, notes = $6
       WHERE id = $7
       RETURNING *`,
      [first_name, last_name, email, organisation_id || null, phone || null, notes || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contact not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A contact with that email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// DELETE /api/contacts/:id — nulls ticket contact_id so history is preserved (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const before = await db.query(
      `SELECT id, first_name || ' ' || last_name AS full_name, email FROM contacts WHERE id=$1`, [req.params.id]
    );
    const old = before.rows[0];
    await db.query('UPDATE tickets SET contact_id = NULL WHERE contact_id = $1', [req.params.id]);
    await db.query('UPDATE service_requests SET contact_id = NULL WHERE contact_id = $1', [req.params.id]).catch(() => {});
    const result = await db.query('DELETE FROM contacts WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Contact not found' });
    if (old) {
      logAudit({ req, action: 'contact.deleted', entityType: 'contact', entityId: old.id,
        oldValue: { full_name: old.full_name, email: old.email } }).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// GET /api/contacts/:id/activity — chronological timeline of all activity for this contact
router.get('/:id/activity', async (req, res) => {
  const contactId = req.params.id;
  try {
    const events = [];

    // Tickets created
    const ticketsResult = await db.query(
      `SELECT
        t.id, t.reference, t.subject, t.status, t.created_at
       FROM tickets t
       WHERE t.contact_id = $1
       ORDER BY t.created_at DESC`,
      [contactId]
    );

    for (const t of ticketsResult.rows) {
      events.push({
        type:        'ticket_created',
        timestamp:   t.created_at,
        description: `Ticket ${t.reference} created: ${t.subject}`,
        link:        `/tickets/${t.id}`,
        metadata:    { ticket_id: t.id, reference: t.reference, subject: t.subject, status: t.status },
      });

      if (t.status === 'resolved') {
        // We don't have a separate resolution timestamp, use updated_at from a sub-query
        events.push({
          type:        'ticket_resolved',
          timestamp:   t.created_at, // will be overwritten below
          description: `Ticket ${t.reference} resolved`,
          link:        `/tickets/${t.id}`,
          metadata:    { ticket_id: t.id, reference: t.reference },
          _ticket_id_for_update: t.id,
        });
      }
    }

    // Replace placeholder timestamps for resolved tickets with actual updated_at
    if (ticketsResult.rows.some(t => t.status === 'resolved')) {
      const resolvedRows = ticketsResult.rows.filter(t => t.status === 'resolved');
      const updatedResult = await db.query(
        `SELECT id, updated_at FROM tickets WHERE id = ANY($1::int[])`,
        [resolvedRows.map(t => t.id)]
      );
      const updatedMap = {};
      for (const row of updatedResult.rows) updatedMap[row.id] = row.updated_at;

      for (const ev of events) {
        if (ev.type === 'ticket_resolved' && ev._ticket_id_for_update) {
          ev.timestamp = updatedMap[ev._ticket_id_for_update] || ev.timestamp;
          delete ev._ticket_id_for_update;
        }
      }
    }

    // Ticket replies (via tickets joined on contact_id)
    const repliesResult = await db.query(
      `SELECT
        r.id, r.body, r.created_at, r.is_internal, r.sender_name,
        t.id AS ticket_id, t.reference
       FROM ticket_replies r
       JOIN tickets t ON t.id = r.ticket_id
       WHERE t.contact_id = $1
       ORDER BY r.created_at DESC`,
      [contactId]
    );

    for (const r of repliesResult.rows) {
      // Determine direction: if sender_name is set it came from contact (email in), otherwise agent
      const fromContact = r.sender_name && r.sender_name !== '';
      events.push({
        type:        fromContact ? 'reply_from_contact' : 'reply_from_agent',
        timestamp:   r.created_at,
        description: fromContact
          ? `Reply from contact on ticket ${r.reference}`
          : `Agent reply on ticket ${r.reference}`,
        link:        `/tickets/${r.ticket_id}`,
        metadata:    {
          ticket_id: r.ticket_id,
          reference: r.reference,
          sender_name: r.sender_name,
          is_internal: r.is_internal,
          preview: r.body ? r.body.replace(/<[^>]+>/g, '').slice(0, 120) : '',
        },
      });
    }

    // Service requests
    const srResult = await db.query(
      `SELECT
        sr.id, sr.form_name, sr.created_at,
        t.id AS ticket_id, t.reference
       FROM service_requests sr
       LEFT JOIN tickets t ON t.id = sr.ticket_id
       WHERE sr.contact_id = $1
       ORDER BY sr.created_at DESC`,
      [contactId]
    );

    for (const sr of srResult.rows) {
      events.push({
        type:        'service_request',
        timestamp:   sr.created_at,
        description: `Service request submitted: ${sr.form_name || 'Unknown form'}`,
        link:        sr.ticket_id ? `/tickets/${sr.ticket_id}` : null,
        metadata:    {
          service_request_id: sr.id,
          form_name: sr.form_name,
          ticket_id: sr.ticket_id,
          reference: sr.reference,
        },
      });
    }

    // Sort all events by timestamp descending
    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(events);
  } catch (err) {
    console.error('[contacts/activity] error:', err);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// POST /api/contacts/:id/merge — reassign all tickets to target, then delete source
router.post('/:id/merge', async (req, res) => {
  const sourceId = req.params.id;
  const { target_id } = req.body;
  if (!target_id) return res.status(400).json({ error: 'target_id is required' });
  if (String(sourceId) === String(target_id)) return res.status(400).json({ error: 'Cannot merge a contact into itself' });
  try {
    const before = await db.query(
      `SELECT id, first_name || ' ' || last_name AS full_name, email FROM contacts WHERE id=$1`, [sourceId]
    );
    const old = before.rows[0];
    await db.query('UPDATE tickets SET contact_id = $1 WHERE contact_id = $2', [target_id, sourceId]);
    await db.query('UPDATE service_requests SET contact_id = $1 WHERE contact_id = $2', [target_id, sourceId]).catch(() => {});
    await db.query('DELETE FROM contacts WHERE id = $1', [sourceId]);
    logAudit({ req, action: 'contact.merged', entityType: 'contact', entityId: parseInt(sourceId),
      oldValue: { full_name: old?.full_name, email: old?.email },
      newValue: { merged_into: parseInt(target_id) } }).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to merge contacts' });
  }
});

module.exports = router;

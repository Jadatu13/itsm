const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/contacts
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
        c.id, c.first_name, c.last_name, c.email, c.created_at,
        c.first_name || ' ' || c.last_name AS full_name,
        o.id AS organisation_id,
        o.name AS organisation_name,
        COUNT(t.id)::int AS ticket_count
       FROM contacts c
       LEFT JOIN organisations o ON o.id = c.organisation_id
       LEFT JOIN tickets t ON t.contact_id = c.id
       GROUP BY c.id, o.id, o.name
       ORDER BY c.last_name, c.first_name`
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
        c.id, c.first_name, c.last_name, c.email, c.created_at,
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

    res.json({
      ...contactResult.rows[0],
      tickets: ticketsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch contact' });
  }
});

// POST /api/contacts
router.post('/', async (req, res) => {
  const { first_name, last_name, email, organisation_id } = req.body;
  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: 'first_name, last_name, and email are required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO contacts (first_name, last_name, email, organisation_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [first_name, last_name, email, organisation_id || null]
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
  const { first_name, last_name, email, organisation_id } = req.body;
  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: 'first_name, last_name, and email are required' });
  }
  try {
    const result = await db.query(
      `UPDATE contacts
       SET first_name = $1, last_name = $2, email = $3, organisation_id = $4
       WHERE id = $5
       RETURNING *`,
      [first_name, last_name, email, organisation_id || null, req.params.id]
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

module.exports = router;

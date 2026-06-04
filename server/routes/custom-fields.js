/*
 * Migration SQL (run once against the database):
 *
 * CREATE TABLE IF NOT EXISTS ticket_custom_fields (
 *   id SERIAL PRIMARY KEY,
 *   label TEXT NOT NULL,
 *   field_key TEXT NOT NULL UNIQUE,
 *   field_type TEXT NOT NULL DEFAULT 'text', -- text, number, select, date, checkbox
 *   options JSONB DEFAULT '[]',              -- for select type
 *   required BOOLEAN DEFAULT false,
 *   sort_order INT DEFAULT 0,
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * CREATE TABLE IF NOT EXISTS ticket_field_values (
 *   ticket_id INT REFERENCES tickets(id) ON DELETE CASCADE,
 *   field_key TEXT NOT NULL,
 *   value TEXT,
 *   PRIMARY KEY (ticket_id, field_key)
 * );
 *
 * CREATE TABLE IF NOT EXISTS ticket_time_entries (
 *   id SERIAL PRIMARY KEY,
 *   ticket_id INT REFERENCES tickets(id) ON DELETE CASCADE,
 *   agent_id INT REFERENCES agents(id) ON DELETE SET NULL,
 *   minutes INT NOT NULL,
 *   note TEXT,
 *   logged_at TIMESTAMPTZ DEFAULT NOW()
 * );
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/custom-fields — list all custom fields
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM ticket_custom_fields ORDER BY sort_order, id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch custom fields' });
  }
});

// POST /api/custom-fields — create a field (admin only)
router.post('/', async (req, res) => {
  const { label, field_key, field_type, options, required, sort_order } = req.body;
  if (!label || !field_key) {
    return res.status(400).json({ error: 'label and field_key are required' });
  }
  // Sanitise field_key: lowercase, alphanumeric + underscore only
  const key = field_key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  try {
    const result = await db.query(
      `INSERT INTO ticket_custom_fields (label, field_key, field_type, options, required, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        label,
        key,
        field_type || 'text',
        JSON.stringify(options || []),
        !!required,
        sort_order ?? 0,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'field_key already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create custom field' });
  }
});

// PUT /api/custom-fields/:id — update a field
router.put('/:id', async (req, res) => {
  const { label, field_type, options, required, sort_order } = req.body;
  if (!label) return res.status(400).json({ error: 'label is required' });
  try {
    const result = await db.query(
      `UPDATE ticket_custom_fields
       SET label = $1, field_type = $2, options = $3, required = $4, sort_order = $5
       WHERE id = $6 RETURNING *`,
      [
        label,
        field_type || 'text',
        JSON.stringify(options || []),
        !!required,
        sort_order ?? 0,
        req.params.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Field not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update custom field' });
  }
});

// DELETE /api/custom-fields/:id — delete a field (and all its values via cascade)
router.delete('/:id', async (req, res) => {
  try {
    // Also remove orphaned values manually in case ON DELETE CASCADE isn't set on field_key
    const field = await db.query('SELECT field_key FROM ticket_custom_fields WHERE id = $1', [req.params.id]);
    if (!field.rows.length) return res.status(404).json({ error: 'Field not found' });

    await db.query('DELETE FROM ticket_field_values WHERE field_key = $1', [field.rows[0].field_key]);
    await db.query('DELETE FROM ticket_custom_fields WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete custom field' });
  }
});

module.exports = router;

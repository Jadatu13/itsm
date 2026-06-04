const express      = require('express');
const router       = express.Router();
const db           = require('../db');
const requireAdmin = require('../middleware/requireAdmin');

// GET /api/automations
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM automations ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch automations' });
  }
});

// POST /api/automations — admin only
router.post('/', requireAdmin, async (req, res) => {
  const { name, trigger_type, match_all, conditions, actions } = req.body;
  if (!name || !trigger_type) {
    return res.status(400).json({ error: 'name and trigger_type are required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO automations (name, trigger_type, match_all, conditions, actions)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        name,
        trigger_type,
        match_all !== false,
        JSON.stringify(conditions || []),
        JSON.stringify(actions || []),
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create automation' });
  }
});

// PUT /api/automations/:id — admin only
router.put('/:id', requireAdmin, async (req, res) => {
  const { name, trigger_type, match_all, conditions, actions, enabled } = req.body;
  if (!name || !trigger_type) {
    return res.status(400).json({ error: 'name and trigger_type are required' });
  }
  try {
    const result = await db.query(
      `UPDATE automations
       SET name = $1, trigger_type = $2, match_all = $3,
           conditions = $4, actions = $5,
           enabled = COALESCE($6, enabled),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        name,
        trigger_type,
        match_all !== false,
        JSON.stringify(conditions || []),
        JSON.stringify(actions || []),
        enabled !== undefined ? enabled : null,
        req.params.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Automation not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update automation' });
  }
});

// DELETE /api/automations/:id — admin only
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM automations WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Automation not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete automation' });
  }
});

// PATCH /api/automations/:id/toggle — admin only
router.patch('/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE automations SET enabled = NOT enabled, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Automation not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to toggle automation' });
  }
});

module.exports = router;

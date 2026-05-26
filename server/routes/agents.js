const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const db      = require('../db');

// GET /api/agents
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, email, role, created_at FROM agents ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// POST /api/agents
router.post('/', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  try {
    const hash   = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO agents (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at`,
      [name, email, hash, role || 'agent']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// PUT /api/agents/:id
router.put('/:id', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await db.query(
        `UPDATE agents SET name=$1, email=$2, password_hash=$3, role=$4 WHERE id=$5`,
        [name, email, hash, role || 'agent', req.params.id]
      );
    } else {
      await db.query(
        `UPDATE agents SET name=$1, email=$2, role=$3 WHERE id=$4`,
        [name, email, role || 'agent', req.params.id]
      );
    }
    const result = await db.query(
      'SELECT id, name, email, role, created_at FROM agents WHERE id=$1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Agent not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// DELETE /api/agents/:id
router.delete('/:id', async (req, res) => {
  try {
    // Unassign tickets before deleting
    await db.query('UPDATE tickets SET assigned_to = NULL WHERE assigned_to = $1', [req.params.id]);
    const result = await db.query('DELETE FROM agents WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Agent not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

module.exports = router;

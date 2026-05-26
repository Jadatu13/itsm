const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/canned-responses
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM canned_responses ORDER BY title');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch canned responses' });
  }
});

// POST /api/canned-responses
router.post('/', async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  try {
    const result = await db.query(
      'INSERT INTO canned_responses (title, body) VALUES ($1, $2) RETURNING *',
      [title, body]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create canned response' });
  }
});

// PUT /api/canned-responses/:id
router.put('/:id', async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  try {
    const result = await db.query(
      'UPDATE canned_responses SET title=$1, body=$2 WHERE id=$3 RETURNING *',
      [title, body, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update canned response' });
  }
});

// DELETE /api/canned-responses/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM canned_responses WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete canned response' });
  }
});

module.exports = router;

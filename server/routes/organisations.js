const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/organisations
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
        o.id, o.name, o.created_at,
        COUNT(DISTINCT c.id)::int AS contact_count,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('id', od.id, 'domain', od.domain)
            ORDER BY od.domain
          ) FILTER (WHERE od.id IS NOT NULL),
          '[]'::json
        ) AS domains
       FROM organisations o
       LEFT JOIN contacts c ON c.organisation_id = o.id
       LEFT JOIN organisation_domains od ON od.organisation_id = o.id
       GROUP BY o.id
       ORDER BY o.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch organisations' });
  }
});

// GET /api/organisations/by-domain?domain=acme.com
// Must be defined BEFORE /:id to avoid being swallowed by that route
router.get('/by-domain', async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.json(null);
  try {
    const result = await db.query(
      `SELECT o.id, o.name
       FROM organisations o
       JOIN organisation_domains od ON od.organisation_id = o.id
       WHERE od.domain = $1`,
      [domain.toLowerCase().trim()]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to lookup domain' });
  }
});

// POST /api/organisations
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await db.query(
      'INSERT INTO organisations (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create organisation' });
  }
});

// PUT /api/organisations/:id
router.put('/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await db.query(
      'UPDATE organisations SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Organisation not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update organisation' });
  }
});

// POST /api/organisations/:id/domains
router.post('/:id/domains', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain is required' });
  const cleaned = domain.toLowerCase().trim().replace(/^@/, '');
  try {
    const result = await db.query(
      `INSERT INTO organisation_domains (organisation_id, domain)
       VALUES ($1, $2) RETURNING *`,
      [req.params.id, cleaned]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That domain is already assigned to an organisation' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to add domain' });
  }
});

// DELETE /api/organisations/:id/domains/:domainId
router.delete('/:id/domains/:domainId', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM organisation_domains WHERE id = $1 AND organisation_id = $2',
      [req.params.domainId, req.params.id]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove domain' });
  }
});

module.exports = router;

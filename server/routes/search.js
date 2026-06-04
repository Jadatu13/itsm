const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/search?q=<query>
// Searches across tickets, contacts, organisations, and published KB articles.
router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ tickets: [], contacts: [], organisations: [], articles: [] });
  }

  const term = `%${q.trim()}%`;

  try {
    const [tickets, contacts, organisations, articles] = await Promise.all([
      db.query(
        `SELECT
          t.id,
          t.reference,
          t.subject,
          t.status,
          t.priority,
          c.first_name || ' ' || c.last_name AS contact_name
         FROM tickets t
         LEFT JOIN contacts c ON c.id = t.contact_id
         WHERE t.reference ILIKE $1 OR t.subject ILIKE $1
         ORDER BY t.updated_at DESC
         LIMIT 5`,
        [term]
      ),

      db.query(
        `SELECT
          c.id,
          c.first_name || ' ' || c.last_name AS full_name,
          c.email,
          o.name AS organisation_name
         FROM contacts c
         LEFT JOIN organisations o ON o.id = c.organisation_id
         WHERE c.first_name ILIKE $1 OR c.last_name ILIKE $1 OR c.email ILIKE $1
            OR (c.first_name || ' ' || c.last_name) ILIKE $1
         ORDER BY c.first_name, c.last_name
         LIMIT 5`,
        [term]
      ),

      db.query(
        `SELECT id, name
         FROM organisations
         WHERE name ILIKE $1 OR EXISTS (
           SELECT 1 FROM organisation_domains d
           WHERE d.organisation_id = organisations.id AND d.domain ILIKE $1
         )
         ORDER BY name
         LIMIT 5`,
        [term]
      ),

      db.query(
        `SELECT
          a.id,
          a.title,
          f.name AS folder_name
         FROM kb_articles a
         LEFT JOIN kb_folders f ON f.id = a.folder_id
         WHERE a.published = true
           AND (a.title ILIKE $1 OR a.body ILIKE $1)
         ORDER BY a.title
         LIMIT 5`,
        [term]
      ),
    ]);

    res.json({
      tickets:       tickets.rows,
      contacts:      contacts.rows,
      organisations: organisations.rows,
      articles:      articles.rows,
    });
  } catch (err) {
    console.error('[search] error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;

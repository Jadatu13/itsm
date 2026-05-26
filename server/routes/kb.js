const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ─── Folders ──────────────────────────────────────────────────────────────────

// GET /api/kb/folders  — full flat list (client builds tree)
router.get('/folders', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.id, f.name, f.icon, f.sort_order, f.parent_id, f.org_id,
              o.name AS org_name,
              COUNT(a.id)::int AS article_count
       FROM kb_folders f
       LEFT JOIN organisations o ON o.id = f.org_id
       LEFT JOIN kb_articles a ON a.folder_id = f.id
       GROUP BY f.id, o.name
       ORDER BY f.sort_order, f.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// POST /api/kb/folders
router.post('/folders', async (req, res) => {
  const { name, icon, sort_order, parent_id, org_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await db.query(
      `INSERT INTO kb_folders (name, icon, sort_order, parent_id, org_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name.trim(), icon || '📁', sort_order ?? 0, parent_id || null, org_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// PUT /api/kb/folders/:id
router.put('/folders/:id', async (req, res) => {
  const { name, icon, sort_order, parent_id, org_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    // Prevent a folder from being its own parent or ancestor
    const id = parseInt(req.params.id, 10);
    const pid = parent_id ? parseInt(parent_id, 10) : null;
    if (pid === id) return res.status(400).json({ error: 'A folder cannot be its own parent.' });

    const result = await db.query(
      `UPDATE kb_folders
       SET name=$1, icon=$2, sort_order=$3, parent_id=$4, org_id=$5
       WHERE id=$6 RETURNING *`,
      [name.trim(), icon || '📁', sort_order ?? 0, pid, org_id || null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Folder not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

// DELETE /api/kb/folders/:id — moves articles to Unfiled, sub-folders to root
router.delete('/folders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await db.query(`UPDATE kb_articles SET folder_id = NULL WHERE folder_id = $1`, [id]);
    await db.query(`UPDATE kb_folders SET parent_id = NULL WHERE parent_id = $1`, [id]);
    const result = await db.query(`DELETE FROM kb_folders WHERE id=$1 RETURNING id`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Folder not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// ─── Articles ─────────────────────────────────────────────────────────────────

// GET /api/kb
router.get('/', async (req, res) => {
  try {
    const { search, folder_id, visibility } = req.query;
    const params = [], conditions = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(a.title ILIKE $${params.length} OR a.body ILIKE $${params.length})`);
    }
    if (folder_id === 'unfiled') {
      conditions.push(`a.folder_id IS NULL`);
    } else if (folder_id) {
      params.push(folder_id);
      conditions.push(`a.folder_id = $${params.length}`);
    }
    if (visibility) {
      params.push(visibility);
      conditions.push(`a.visibility = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT a.id, a.title, a.published, a.visibility, a.created_at, a.updated_at,
              a.folder_id, f.name AS folder_name, f.icon AS folder_icon,
              LEFT(
                trim(regexp_replace(regexp_replace(a.body, '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g'))
              , 300) AS excerpt
       FROM kb_articles a
       LEFT JOIN kb_folders f ON f.id = a.folder_id
       ${where}
       ORDER BY a.updated_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// GET /api/kb/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, f.name AS folder_name, f.icon AS folder_icon
       FROM kb_articles a
       LEFT JOIN kb_folders f ON f.id = a.folder_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Article not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// POST /api/kb
router.post('/', async (req, res) => {
  const { title, body, folder_id, published, visibility } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  try {
    const result = await db.query(
      `INSERT INTO kb_articles (title, body, folder_id, published, visibility)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, body, folder_id || null, published ?? false, visibility || 'internal']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create article' });
  }
});

// PUT /api/kb/:id
router.put('/:id', async (req, res) => {
  const { title, body, folder_id, published, visibility } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  try {
    const result = await db.query(
      `UPDATE kb_articles
       SET title=$1, body=$2, folder_id=$3, published=$4, visibility=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [title, body, folder_id || null, published ?? false, visibility || 'internal', req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Article not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update article' });
  }
});

// PATCH /api/kb/:id/move  — lightweight folder reassignment (no full body needed)
router.patch('/:id/move', async (req, res) => {
  const { folder_id } = req.body
  try {
    const result = await db.query(
      `UPDATE kb_articles SET folder_id=$1, updated_at=NOW() WHERE id=$2 RETURNING id, folder_id`,
      [folder_id || null, req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to move article' })
  }
})

// DELETE /api/kb/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM kb_articles WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Article not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

module.exports = router;

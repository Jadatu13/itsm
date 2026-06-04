const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');

const SECRET = process.env.JWT_SECRET || 'itsm-dev-secret-change-in-production';

// Verify JWT from Authorization header OR ?token= query param (needed for browser file opens)
function verifyToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try { return jwt.verify(header.slice(7), SECRET); } catch { return null; }
  }
  if (req.query.token) {
    try { return jwt.verify(req.query.token, SECRET); } catch { return null; }
  }
  return null;
}

// GET /api/attachments/:id  — serve the file inline
// Accepts auth via: Authorization: Bearer <token>  OR  ?token=<jwt>
router.get('/:id', async (req, res) => {
  const agent = verifyToken(req);
  if (!agent) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const result = await db.query('SELECT * FROM ticket_attachments WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Attachment not found' });
    const att = result.rows[0];
    const filePath = path.join('/data/uploads', att.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
    res.setHeader('Content-Disposition', `inline; filename="${att.original_name}"`);
    if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
    res.sendFile(filePath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to serve attachment' });
  }
});

module.exports = router;

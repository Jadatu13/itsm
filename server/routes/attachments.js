const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');

// GET /api/attachments/:id  — serve the file
router.get('/:id', async (req, res) => {
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

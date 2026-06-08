const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');
const { sign, verify } = require('../lib/secret');

const UPLOAD_DIR = '/data/uploads';

// MIME types we are willing to render inline (everything else is force-downloaded
// so a malicious uploaded .html/.svg can never execute on our origin).
const INLINE_SAFE_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
  'application/pdf', 'text/plain',
]);

// ─── Session auth (header) — returns the decoded agent or portal payload ───────
function sessionPayload(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try { return verify(header.slice(7)); } catch { return null; }
}

// Is this session allowed to access attachments for the given ticket?
async function sessionCanAccessTicket(payload, ticketId) {
  if (!payload) return false;
  // Agent tokens (no `type`) may view any ticket — shared support queue.
  if (payload.type !== 'portal') return true;
  // Portal tokens may only view their own contact's tickets.
  const r = await db.query('SELECT contact_id FROM tickets WHERE id = $1', [ticketId]);
  return r.rows.length > 0 && r.rows[0].contact_id === payload.contact_id;
}

// ─── Ticket-scoped download token (used in URLs for browser file opens) ────────
// GET /api/attachments/ticket/:ticketId/token
// Requires a valid session that is authorised for the ticket. Returns a
// short-lived token scoped to that ticket only — never the session JWT itself.
router.get('/ticket/:ticketId/token', async (req, res) => {
  const payload = sessionPayload(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorised' });
  const ticketId = parseInt(req.params.ticketId, 10);
  if (!Number.isInteger(ticketId)) return res.status(400).json({ error: 'Invalid ticket id' });

  if (!(await sessionCanAccessTicket(payload, ticketId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const token = sign({ aud: 'att-dl', tid: ticketId }, { expiresIn: '15m' });
  res.json({ token });
});

// ─── Serve a file ─────────────────────────────────────────────────────────────
// GET /api/attachments/:id
// Authorises via EITHER:
//   • a session header (Authorization: Bearer …) + ownership check, OR
//   • a ticket-scoped ?dt=<download-token> whose tid matches the attachment's ticket.
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid attachment id' });

  try {
    const result = await db.query('SELECT * FROM ticket_attachments WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Attachment not found' });
    const att = result.rows[0];

    // Authorise
    let authorised = false;
    if (req.query.dt) {
      try {
        const dt = verify(String(req.query.dt));
        authorised = dt.aud === 'att-dl' && dt.tid === att.ticket_id;
      } catch { authorised = false; }
    }
    if (!authorised) {
      const payload = sessionPayload(req);
      authorised = await sessionCanAccessTicket(payload, att.ticket_id);
    }
    if (!authorised) return res.status(403).json({ error: 'Forbidden' });

    // Resolve path safely — filename is a server-generated UUID, but defend in depth
    // against any path traversal by confining the resolved path to UPLOAD_DIR.
    const filePath = path.resolve(UPLOAD_DIR, path.basename(att.filename));
    if (!filePath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    // Never let the browser sniff a different type, and only render safe types inline.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const safeInline = att.mime_type && INLINE_SAFE_MIME.has(att.mime_type);
    const mime = safeInline ? att.mime_type : 'application/octet-stream';
    const disposition = safeInline ? 'inline' : 'attachment';
    // Sanitise the filename for the header (strip quotes / backslash / CRLF).
    const safeName = String(att.original_name || 'file').replace(/[\r\n"\\]/g, '_');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
    res.sendFile(filePath);
  } catch (err) {
    console.error('[attachments] serve error:', err.message);
    res.status(500).json({ error: 'Failed to serve attachment' });
  }
});

module.exports = router;

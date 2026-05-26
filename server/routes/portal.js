const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const portalAuth = require('../middleware/portalAuth');
const requireAuth = require('../middleware/auth');

const SECRET = process.env.JWT_SECRET || 'itsm-dev-secret-change-in-production';

// POST /api/portal/auth/login
router.post('/auth/login', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const result = await db.query(
      'SELECT id, first_name, last_name, email FROM contacts WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'No account found for this email address.' });
    }
    const contact = result.rows[0];
    const token = jwt.sign(
      { type: 'portal', contact_id: contact.id },
      SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      contact: {
        id: contact.id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/portal/me
router.get('/me', portalAuth, (req, res) => {
  res.json(req.contact);
});

// GET /api/portal/tickets
router.get('/tickets', portalAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.id, t.reference, t.subject, t.status, t.priority, t.created_at, t.updated_at, t.sla_due_at,
              a.name AS assigned_name
       FROM tickets t
       LEFT JOIN agents a ON a.id = t.assigned_to
       WHERE t.contact_id = $1
       ORDER BY t.updated_at DESC`,
      [req.contact.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// GET /api/portal/tickets/:id
router.get('/tickets/:id', portalAuth, async (req, res) => {
  try {
    const ticketResult = await db.query(
      `SELECT t.*, a.name AS assigned_name
       FROM tickets t
       LEFT JOIN agents a ON a.id = t.assigned_to
       WHERE t.id = $1 AND t.contact_id = $2`,
      [req.params.id, req.contact.id]
    );
    if (!ticketResult.rows.length) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    const repliesResult = await db.query(
      `SELECT * FROM ticket_replies
       WHERE ticket_id = $1 AND is_internal = false
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ ...ticketResult.rows[0], replies: repliesResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

// POST /api/portal/tickets/:id/reply
router.post('/tickets/:id/reply', portalAuth, async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Reply body is required.' });
  try {
    const ticketCheck = await db.query(
      'SELECT id FROM tickets WHERE id = $1 AND contact_id = $2',
      [req.params.id, req.contact.id]
    );
    if (!ticketCheck.rows.length) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    const senderName = `${req.contact.first_name} ${req.contact.last_name}`;
    const result = await db.query(
      `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal, sender_name)
       VALUES ($1, $2, false, false, $3)
       RETURNING *`,
      [req.params.id, body, senderName]
    );
    // Update ticket updated_at
    await db.query('UPDATE tickets SET updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to post reply' });
  }
});

// GET /api/portal/kb
router.get('/kb', portalAuth, async (req, res) => {
  try {
    const { search, folder_id } = req.query;
    const params = [];
    const conditions = [`a.visibility = 'public'`, `a.published = true`];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(a.title ILIKE $${params.length} OR a.body ILIKE $${params.length})`);
    }
    if (folder_id) {
      params.push(folder_id);
      conditions.push(`a.folder_id = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const result = await db.query(
      `SELECT a.id, a.title, a.published, a.folder_id, f.name AS folder_name, f.icon AS folder_icon,
              LEFT(
                trim(regexp_replace(regexp_replace(a.body, '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g'))
              , 220) AS excerpt
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

// GET /api/portal/kb/folders — must be before /kb/:id
router.get('/kb/folders', portalAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT f.id, f.name, f.icon
       FROM kb_folders f
       JOIN kb_articles a ON a.folder_id = f.id
       WHERE a.visibility = 'public' AND a.published = true
       ORDER BY f.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// GET /api/portal/kb/:id
router.get('/kb/:id', portalAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, f.name AS folder_name, f.icon AS folder_icon
       FROM kb_articles a
       LEFT JOIN kb_folders f ON f.id = a.folder_id
       WHERE a.id = $1 AND a.visibility = 'public' AND a.published = true`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Article not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// GET /api/portal/service-catalog
router.get('/service-catalog', portalAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM service_request_forms WHERE enabled = true ORDER BY sort_order, name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch service catalog' });
  }
});

// GET /api/portal/service-catalog/:id
router.get('/service-catalog/:id', portalAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM service_request_forms WHERE id = $1 AND enabled = true',
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Form not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch form' });
  }
});

// POST /api/portal/service-catalog/:id/submit
router.post('/service-catalog/:id/submit', portalAuth, async (req, res) => {
  const { field_values = {} } = req.body;
  try {
    const formResult = await db.query(
      'SELECT * FROM service_request_forms WHERE id = $1 AND enabled = true',
      [req.params.id]
    );
    if (!formResult.rows.length) {
      return res.status(404).json({ error: 'Form not found' });
    }
    const form = formResult.rows[0];
    const fields = form.fields || [];

    // Build subject
    let subject = form.ticket_subject_template || form.name;
    if (form.ticket_subject_template) {
      fields.forEach(field => {
        const val = field_values[field.id] || '';
        subject = subject.replace(new RegExp(`{{${field.label}}}`, 'g'), val);
      });
    }

    // Build description as plain text (no markdown — ticket description is plain text)
    const separator = '─'.repeat(40);
    const lines = [`Service Request: ${form.name}`, separator];
    fields.forEach(field => {
      const val = field_values[field.id];
      if (val === undefined || val === null || val === '') return;
      // Format date values as NZ DD/MM/YYYY
      let display = typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val);
      if (field.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(display)) {
        const [y, m, d] = display.split('-');
        display = `${d}/${m}/${y}`;
      }
      lines.push(`${field.label}: ${display}`);
    });
    let description = lines.join('\n');
    if (lines.length <= 2) description = `Service request submitted via portal form: ${form.name}`;

    // Get SLA hours from settings
    let slaHours = 24;
    try {
      const slaResult = await db.query(
        `SELECT value FROM settings WHERE key = $1`,
        [`sla_hours_${form.ticket_priority || 'medium'}`]
      );
      if (slaResult.rows.length) slaHours = parseInt(slaResult.rows[0].value, 10);
    } catch {}

    const ticketResult = await db.query(
      `INSERT INTO tickets (subject, description, contact_id, priority, category, source, status, sla_due_at)
       VALUES ($1, $2, $3, $4, $5, 'portal', 'open', NOW() + ($6 || ' hours')::INTERVAL)
       RETURNING *`,
      [
        subject,
        description,
        req.contact.id,
        form.ticket_priority || 'medium',
        form.ticket_category || null,
        slaHours,
      ]
    );
    const ticket = ticketResult.rows[0];

    // Determine approval status
    const approvalStatus = form.requires_approval ? 'pending' : 'not_required';

    // Insert service_request record
    const srInsert = await db.query(
      `INSERT INTO service_requests (form_id, contact_id, ticket_id, form_name, field_values, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [form.id, req.contact.id, ticket.id, form.name, JSON.stringify(field_values), approvalStatus]
    );

    // If approval not required but automation action exists, execute immediately
    if (!form.requires_approval && form.automation_action?.type && form.automation_action.type !== 'none') {
      const { executeAutomation } = require('../graphExecutor');
      const sr = srInsert.rows[0];
      executeAutomation(sr, form).then(async (result) => {
        const status = result.noTenant ? 'no_tenant' : result.success ? 'completed' : 'failed';
        await db.query(
          `UPDATE service_requests SET execution_status = $1, execution_log = $2 WHERE id = $3`,
          [status, JSON.stringify(result.log), sr.id]
        );
      }).catch(err => console.error('[portal-auto-execute]', err));
    }

    // Get the reference
    const refResult = await db.query('SELECT reference FROM tickets WHERE id = $1', [ticket.id]);
    res.json({
      ticket_id: ticket.id,
      reference: refResult.rows[0]?.reference,
      approval_required: form.requires_approval || false,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// Resolve the M365 tenant for a portal request strictly by the contact's organisation.
// Returns null if the org has no linked tenant (ticket-only path, no automation).
async function resolvePortalTenant(contactId) {
  if (!contactId) return null;
  const cr = await db.query('SELECT organisation_id FROM contacts WHERE id = $1', [contactId]);
  const orgId = cr.rows[0]?.organisation_id;
  if (!orgId) return null;
  const tr = await db.query('SELECT * FROM m365_tenants WHERE organisation_id = $1 AND connected = true LIMIT 1', [orgId]);
  return tr.rows[0] || null;
}

// GET /api/portal/graph/users?form_id=... — fetch live Entra ID users for user_picker fields
router.get('/graph/users', portalAuth, async (req, res) => {
  const { form_id } = req.query;
  try {
    const tenant = await resolvePortalTenant(req.contact?.id);
    if (!tenant) return res.json({ users: [], connected: false });

    const tokenUrl = `https://login.microsoftonline.com/${tenant.tenant_id}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials', client_id: tenant.client_id,
      client_secret: tenant.client_secret, scope: 'https://graph.microsoft.com/.default',
    });
    const tokenRes = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (!tokenRes.ok) return res.json({ users: [], connected: false });
    const { access_token } = await tokenRes.json();

    const usersRes = await fetch(
      'https://graph.microsoft.com/v1.0/users?$select=displayName,userPrincipalName&$top=999&$orderby=displayName',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    if (!usersRes.ok) return res.json({ users: [], connected: true });
    const { value = [] } = await usersRes.json();

    const users = value
      .filter(u => u.userPrincipalName && !u.userPrincipalName.startsWith('#EXT#'))
      .map(u => ({ name: u.displayName, email: u.userPrincipalName }));

    res.json({ users, connected: true });
  } catch (err) {
    console.error('[graph/users]', err.message);
    res.json({ users: [], connected: false });
  }
});

// GET /api/portal/graph/groups?form_id=... — fetch live Entra ID groups for group_picker fields
router.get('/graph/groups', portalAuth, async (req, res) => {
  const { form_id } = req.query;
  try {
    const tenant = await resolvePortalTenant(req.contact?.id);
    if (!tenant) return res.json({ groups: [], connected: false });

    const tokenUrl = `https://login.microsoftonline.com/${tenant.tenant_id}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials', client_id: tenant.client_id,
      client_secret: tenant.client_secret, scope: 'https://graph.microsoft.com/.default',
    });
    const tokenRes = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (!tokenRes.ok) return res.json({ groups: [], connected: false });
    const { access_token } = await tokenRes.json();

    const groupsRes = await fetch(
      'https://graph.microsoft.com/v1.0/groups?$select=id,displayName&$top=999&$orderby=displayName',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    if (!groupsRes.ok) return res.json({ groups: [], connected: true });
    const { value = [] } = await groupsRes.json();

    const groups = value
      .filter(g => g.displayName)
      .map(g => ({ id: g.id, name: g.displayName }));

    res.json({ groups, connected: true });
  } catch (err) {
    console.error('[graph/groups]', err.message);
    res.json({ groups: [], connected: false });
  }
});

// GET /api/portal/check-upn?upn=... — real-time UPN availability check
router.get('/check-upn', portalAuth, async (req, res) => {
  const { upn } = req.query;
  if (!upn) return res.status(400).json({ error: 'upn is required' });

  try {
    const tenant = await resolvePortalTenant(req.contact?.id);
    if (!tenant) return res.json({ exists: false, checked: false });

    const { checkUPNExists } = require('../graphExecutor');
    const exists = await checkUPNExists(tenant, upn);
    res.json({ exists, checked: true });
  } catch (err) {
    console.error('[check-upn]', err.message);
    res.json({ exists: false, checked: false }); // fail open — don't block submission
  }
});

// POST /api/portal/preview-token — requires agent auth
router.post('/preview-token', requireAuth, async (req, res) => {
  const { contact_id } = req.body;
  if (!contact_id) return res.status(400).json({ error: 'contact_id is required' });
  try {
    const result = await db.query(
      'SELECT id, first_name, last_name, email FROM contacts WHERE id = $1',
      [contact_id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    const contact = result.rows[0];
    const token = jwt.sign(
      { type: 'portal', contact_id: contact.id, is_preview: true },
      SECRET,
      { expiresIn: '2h' }
    );
    res.json({
      token,
      contact: {
        id: contact.id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate preview token' });
  }
});

module.exports = router;

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcrypt');
const db         = require('./db');
const requireAuth = require('./middleware/auth');

const ticketRoutes        = require('./routes/tickets');
const contactRoutes       = require('./routes/contacts');
const organisationRoutes  = require('./routes/organisations');
const settingsRoutes      = require('./routes/settings');
const authRoutes          = require('./routes/auth');
const agentRoutes         = require('./routes/agents');
const cannedRoutes        = require('./routes/canned-responses');
const kbRoutes            = require('./routes/kb');
const reportsRoutes       = require('./routes/reports');
const automationRoutes    = require('./routes/automations');
const portalRoutes        = require('./routes/portal');
const serviceCatalogRoutes = require('./routes/service-catalog');
const brandingRoutes      = require('./routes/branding');
const tenantRoutes        = require('./routes/tenants');
const aiRoutes            = require('./routes/ai');
const notificationRoutes  = require('./routes/notifications');
const attachmentRoutes    = require('./routes/attachments');
const { startPoller }     = require('./inbound');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

// ── Public routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/api/tickets',         requireAuth, ticketRoutes);
app.use('/api/contacts',        requireAuth, contactRoutes);
app.use('/api/organisations',   requireAuth, organisationRoutes);
app.use('/api/settings',        requireAuth, settingsRoutes);
app.use('/api/agents',          requireAuth, agentRoutes);
app.use('/api/canned-responses',requireAuth, cannedRoutes);
app.use('/api/kb',              requireAuth, kbRoutes);
app.use('/api/reports',         requireAuth, reportsRoutes);
app.use('/api/automations',     requireAuth, automationRoutes);
app.use('/api/portal',          portalRoutes);
app.use('/api/service-catalog', requireAuth, serviceCatalogRoutes);
app.use('/api/branding',        brandingRoutes);
app.use('/api/tenants',         requireAuth, tenantRoutes);
app.use('/api/ai',              requireAuth, aiRoutes);
app.use('/api/notifications',   requireAuth, notificationRoutes);
app.use('/api/attachments',     requireAuth, attachmentRoutes);

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open')        AS open,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status = 'on_hold')     AS on_hold,
        COUNT(*) FILTER (WHERE status = 'resolved'
          AND updated_at >= NOW() - INTERVAL '30 days') AS resolved_last_30,
        COUNT(*) FILTER (WHERE status != 'resolved'
          AND assigned_to IS NULL)                      AS unassigned,
        COUNT(*) FILTER (WHERE status != 'resolved'
          AND sla_due_at IS NOT NULL
          AND sla_due_at < NOW())                       AS sla_breached
      FROM tickets
    `);
    res.json(stats.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/dashboard/recent', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        t.id, t.reference, t.subject, t.status, t.priority, t.updated_at, t.sla_due_at,
        c.first_name || ' ' || c.last_name AS contact_name,
        a.name AS assigned_name
      FROM tickets t
      JOIN contacts c ON c.id = t.contact_id
      LEFT JOIN agents a ON a.id = t.assigned_to
      WHERE t.status != 'resolved'
      ORDER BY t.updated_at DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recent tickets' });
  }
});

// ── Startup ───────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`ITSM server running on http://localhost:${PORT}`);

  // ── Schema migrations (idempotent) ─────────────────────────────────────────
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS kb_folders (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        icon       TEXT DEFAULT '📁',
        sort_order INT  DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      ALTER TABLE kb_articles
        ADD COLUMN IF NOT EXISTS folder_id INT REFERENCES kb_folders(id) ON DELETE SET NULL
    `);
    // Subfolder support
    await db.query(`
      ALTER TABLE kb_folders
        ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES kb_folders(id) ON DELETE SET NULL
    `);
    // Org-specific folder visibility
    await db.query(`
      ALTER TABLE kb_folders
        ADD COLUMN IF NOT EXISTS org_id INT REFERENCES organisations(id) ON DELETE CASCADE
    `);
    // Article visibility: 'internal' (agents only) or 'public' (client portal)
    await db.query(`
      ALTER TABLE kb_articles
        ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'
    `);
    await db.query(`
      ALTER TABLE ticket_replies
        ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT false
    `);
    await db.query(`
      ALTER TABLE ticket_replies
        ADD COLUMN IF NOT EXISTS sender_name TEXT
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS service_request_forms (
        id              SERIAL PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT,
        icon            TEXT DEFAULT '📋',
        category        TEXT DEFAULT 'general',
        fields          JSONB NOT NULL DEFAULT '[]',
        ticket_priority TEXT NOT NULL DEFAULT 'medium',
        ticket_category TEXT,
        ticket_subject_template TEXT,
        enabled         BOOLEAN DEFAULT true,
        sort_order      INT DEFAULT 0,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS service_requests (
        id           SERIAL PRIMARY KEY,
        form_id      INT REFERENCES service_request_forms(id) ON DELETE SET NULL,
        contact_id   INT REFERENCES contacts(id) ON DELETE CASCADE,
        ticket_id    INT REFERENCES tickets(id) ON DELETE SET NULL,
        form_name    TEXT,
        field_values JSONB NOT NULL DEFAULT '{}',
        created_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS automations (
        id           SERIAL PRIMARY KEY,
        name         TEXT NOT NULL,
        enabled      BOOLEAN DEFAULT true,
        trigger_type TEXT NOT NULL,
        match_all    BOOLEAN DEFAULT true,
        conditions   JSONB NOT NULL DEFAULT '[]',
        actions      JSONB NOT NULL DEFAULT '[]',
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS portal_branding (
        id               INT DEFAULT 1 PRIMARY KEY CHECK (id = 1),
        brand_name       TEXT    NOT NULL DEFAULT 'Help Centre',
        logo_url         TEXT,
        primary_color    TEXT    NOT NULL DEFAULT '#4F46E5',
        nav_bg           TEXT    NOT NULL DEFAULT '#FFFFFF',
        nav_text         TEXT    NOT NULL DEFAULT '#111827',
        nav_active_bg    TEXT    NOT NULL DEFAULT '#EEF2FF',
        nav_active_text  TEXT    NOT NULL DEFAULT '#4F46E5',
        page_bg          TEXT    NOT NULL DEFAULT '#F8F9FB',
        button_bg        TEXT    NOT NULL DEFAULT '#4F46E5',
        button_text      TEXT    NOT NULL DEFAULT '#FFFFFF',
        login_title      TEXT    NOT NULL DEFAULT 'Welcome to the Help Centre',
        login_subtitle   TEXT    NOT NULL DEFAULT 'Sign in with your work email address',
        footer_text      TEXT,
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`INSERT INTO portal_branding (id) VALUES (1) ON CONFLICT DO NOTHING`);

    // ── M365 Tenants ────────────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS m365_tenants (
        id               SERIAL PRIMARY KEY,
        display_name     TEXT NOT NULL,
        tenant_id        TEXT NOT NULL UNIQUE,
        client_id        TEXT NOT NULL,
        client_secret    TEXT NOT NULL,
        access_token     TEXT,
        token_expires_at TIMESTAMPTZ,
        connected        BOOLEAN DEFAULT false,
        connected_at     TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Service catalog — automation columns ─────────────────────────────────
    await db.query(`
      ALTER TABLE service_request_forms
        ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false
    `);
    await db.query(`
      ALTER TABLE service_request_forms
        ADD COLUMN IF NOT EXISTS automation_action JSONB
    `);
    await db.query(`
      ALTER TABLE service_request_forms
        ADD COLUMN IF NOT EXISTS automation_tenant_id INT REFERENCES m365_tenants(id) ON DELETE SET NULL
    `);

    // ── Service requests — approval & execution columns ───────────────────────
    await db.query(`
      ALTER TABLE service_requests
        ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'not_required'
    `);
    await db.query(`
      ALTER TABLE service_requests
        ADD COLUMN IF NOT EXISTS approved_by INT REFERENCES agents(id) ON DELETE SET NULL
    `);
    await db.query(`
      ALTER TABLE service_requests
        ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
    `);
    await db.query(`
      ALTER TABLE service_requests
        ADD COLUMN IF NOT EXISTS rejection_reason TEXT
    `);
    await db.query(`
      ALTER TABLE service_requests
        ADD COLUMN IF NOT EXISTS execution_status TEXT
    `);
    await db.query(`
      ALTER TABLE service_requests
        ADD COLUMN IF NOT EXISTS execution_log JSONB DEFAULT '[]'
    `);

    // ── Ticket attachments ───────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS ticket_attachments (
        id            SERIAL PRIMARY KEY,
        ticket_id     INT  REFERENCES tickets(id)        ON DELETE CASCADE,
        reply_id      INT  REFERENCES ticket_replies(id) ON DELETE SET NULL,
        filename      TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type     TEXT,
        size_bytes    INT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Tenant group aliases ─────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS tenant_group_aliases (
        id         SERIAL PRIMARY KEY,
        tenant_id  INT  NOT NULL REFERENCES m365_tenants(id) ON DELETE CASCADE,
        alias      TEXT NOT NULL,
        group_name TEXT NOT NULL,
        UNIQUE(tenant_id, alias)
      )
    `);

    console.log('[db] Migrations applied');
  } catch (err) {
    console.error('[db] Migration error:', err.message);
  }

  // Ensure uploads directory exists
  try {
    const fs = require('fs');
    const uploadsDir = '/data/uploads';
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (err) {
    console.error('[uploads] Could not create uploads dir:', err.message);
  }

  // Seed default admin if no agents exist
  try {
    const check = await db.query('SELECT COUNT(*) FROM agents');
    if (parseInt(check.rows[0].count, 10) === 0) {
      const hash = await bcrypt.hash('changeme123', 10);
      await db.query(
        `INSERT INTO agents (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
        ['Admin', 'admin@itsm.local', hash]
      );
      console.log('─────────────────────────────────────────────');
      console.log('  Default admin account created:');
      console.log('  Email:    admin@itsm.local');
      console.log('  Password: changeme123');
      console.log('  Change this in Settings → Agents immediately!');
      console.log('─────────────────────────────────────────────');
    }
  } catch (err) {
    console.error('Failed to seed admin:', err.message);
  }

  startPoller();
});

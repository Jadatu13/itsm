require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const bcrypt     = require('bcrypt');
const db         = require('./db');
const { runMigrations } = require('./db/migrate');
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
const searchRoutes        = require('./routes/search');
const customFieldsRoutes  = require('./routes/custom-fields');
const auditRoutes         = require('./routes/audit');
const { startPoller }     = require('./inbound');
const { startSlaMonitor } = require('./jobs/slaMonitor');

const app  = express();
const PORT = process.env.PORT || 3001;

// Behind nginx/Traefik — trust the proxy so rate-limit sees the real client IP.
app.set('trust proxy', 1);

// Security headers. CSP is disabled here (this is a JSON API; the SPA is served
// separately by nginx) and CORP is relaxed so the front-end can embed images/
// attachments when served from a different dev origin.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const corsOrigin = process.env.CLIENT_URL || '*';
if (corsOrigin === '*') {
  console.warn('[cors] CLIENT_URL is "*" — set it to your real front-end origin in production.');
}
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));

// Throttle authentication endpoints (brute force / SSO-state abuse).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// ── Public routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);

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
app.use('/api/attachments',     attachmentRoutes);  // auth handled inline (supports ?token= for browser downloads)
app.use('/api/search',          requireAuth, searchRoutes);
app.use('/api/custom-fields',   requireAuth, customFieldsRoutes);
app.use('/api/audit',           requireAuth, auditRoutes);

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

  // ── Schema migrations (idempotent, fail-loud) ──────────────────────────────
  try {
    await runMigrations(db);
  } catch (err) {
    console.error(err.message);
    console.error('[db] FATAL: aborting startup on migration failure.');
    process.exit(1);
  }

  // Ensure uploads directory exists
  try {
    const fs = require('fs');
    const uploadsDir = '/data/uploads';
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (err) {
    console.error('[uploads] Could not create uploads dir:', err.message);
  }

  // Seed a bootstrap admin if no agents exist. Login is SSO-only, so this row
  // mainly exists so the first real admin can be promoted; the password is a
  // throwaway random value (never the well-known 'changeme123').
  try {
    const check = await db.query('SELECT COUNT(*) FROM agents');
    if (parseInt(check.rows[0].count, 10) === 0) {
      const randomPw = require('crypto').randomBytes(24).toString('hex');
      const hash = await bcrypt.hash(randomPw, 12);
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@itsm.local';
      await db.query(
        `INSERT INTO agents (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
        ['Admin', email, hash]
      );
      console.log('─────────────────────────────────────────────');
      console.log('  Bootstrap admin created:', email);
      console.log('  Login is via Microsoft SSO. To grant yourself admin,');
      console.log('  sign in once via SSO then promote your agent in the DB,');
      console.log('  or set BOOTSTRAP_ADMIN_EMAIL to your SSO email before first boot.');
      console.log('─────────────────────────────────────────────');
    }
  } catch (err) {
    console.error('Failed to seed admin:', err.message);
  }

  startPoller();
  startSlaMonitor();
});

const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const requireAuth = require('../middleware/auth');

const SECRET  = process.env.JWT_SECRET || 'itsm-dev-secret-change-in-production';
const EXPIRES = '7d';

// ─── Azure Entra ID SSO ───────────────────────────────────────────────────────

const AZURE_CLIENT_ID     = process.env.AZURE_CLIENT_ID;
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const AZURE_TENANT_ID     = process.env.AZURE_TENANT_ID;
const APP_URL             = (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');
const REDIRECT_URI        = `${APP_URL}/api/auth/azure/callback`;

// GET /api/auth/azure/login  — redirects browser to Microsoft login
router.get('/azure/login', (req, res) => {
  if (!AZURE_CLIENT_ID || !AZURE_TENANT_ID) {
    return res.status(500).send('Azure SSO is not configured. Set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID and APP_URL in your .env file.');
  }
  const state  = jwt.sign({ ts: Date.now() }, SECRET, { expiresIn: '5m' });
  const params = new URLSearchParams({
    client_id:     AZURE_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  REDIRECT_URI,
    scope:         'openid email profile',
    response_mode: 'query',
    state,
  });
  res.redirect(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/authorize?${params}`);
});

// GET /api/auth/azure/callback  — Microsoft redirects here after login
router.get('/azure/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('[azure sso] error from Microsoft:', error, error_description);
    return res.redirect(`/login?error=${encodeURIComponent(error_description || error)}`);
  }

  // Verify state to prevent CSRF
  try { jwt.verify(state, SECRET); }
  catch { return res.redirect('/login?error=Invalid+state+parameter'); }

  try {
    // Exchange authorisation code for tokens
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          client_id:     AZURE_CLIENT_ID,
          client_secret: AZURE_CLIENT_SECRET,
          code,
          redirect_uri:  REDIRECT_URI,
          grant_type:    'authorization_code',
        }),
      }
    );
    const tokens = await tokenRes.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    // Decode the ID token — issued directly by Microsoft so we trust it
    const idToken = jwt.decode(tokens.id_token);
    if (!idToken) throw new Error('Missing or invalid ID token');

    const email = (idToken.email || idToken.preferred_username || '').toLowerCase().trim();
    const name  = idToken.name || email.split('@')[0];
    if (!email) throw new Error('Microsoft did not return an email address');

    // Find or auto-create an agent for this Microsoft account
    let agentRow = await db.query(
      'SELECT id, name, email, role, totp_enabled FROM agents WHERE LOWER(email) = $1',
      [email]
    ).then(r => r.rows[0]);

    if (!agentRow) {
      agentRow = await db.query(
        `INSERT INTO agents (name, email, password_hash, role)
         VALUES ($1, $2, 'sso-only', 'agent')
         RETURNING id, name, email, role, totp_enabled`,
        [name, email]
      ).then(r => r.rows[0]);
      console.log(`[azure sso] Auto-created agent: ${email}`);
    }

    // If 2FA is enabled, issue a temp token and redirect for 2FA challenge
    if (agentRow.totp_enabled) {
      const tempToken = jwt.sign(
        { id: agentRow.id, name: agentRow.name, email: agentRow.email, role: agentRow.role, _2fa_pending: true },
        SECRET,
        { expiresIn: '5m' }
      );
      return res.redirect(`/login?requires2fa=true&tempToken=${encodeURIComponent(tempToken)}`);
    }

    const token = jwt.sign(
      { id: agentRow.id, name: agentRow.name, email: agentRow.email, role: agentRow.role },
      SECRET,
      { expiresIn: EXPIRES }
    );

    // Redirect to frontend — React reads the token from the URL
    res.redirect(`/login?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('[azure sso]', err.message);
    res.redirect(`/login?error=${encodeURIComponent('Authentication failed: ' + err.message)}`);
  }
});

// POST /api/auth/login — disabled, SSO only
router.post('/login', (req, res) => {
  res.status(403).json({ error: 'Password login is disabled. Please sign in with Microsoft SSO.' });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json(req.agent);
});

// GET /api/auth/config  — tells the frontend whether SSO is configured
router.get('/config', (req, res) => {
  res.json({ ssoEnabled: !!(AZURE_CLIENT_ID && AZURE_TENANT_ID) });
});

// ─── 2FA — TOTP ──────────────────────────────────────────────────────────────

// POST /api/auth/2fa/challenge — accepts { tempToken, code }, verifies TOTP, returns full JWT
router.post('/2fa/challenge', async (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code) {
    return res.status(400).json({ error: 'tempToken and code are required' });
  }
  try {
    let payload;
    try {
      payload = jwt.verify(tempToken, SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired temp token' });
    }
    if (!payload._2fa_pending) {
      return res.status(400).json({ error: 'Token is not a 2FA pending token' });
    }

    const result = await db.query(
      'SELECT id, name, email, role, totp_secret, totp_enabled FROM agents WHERE id=$1',
      [payload.id]
    );
    const agent = result.rows[0];
    if (!agent || !agent.totp_enabled || !agent.totp_secret) {
      return res.status(400).json({ error: '2FA is not enabled for this account' });
    }

    const { authenticator } = require('otplib');
    const valid = authenticator.verify({ token: code, secret: agent.totp_secret });
    if (!valid) {
      return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    const fullToken = jwt.sign(
      { id: agent.id, name: agent.name, email: agent.email, role: agent.role, twoFactorVerified: true },
      SECRET,
      { expiresIn: EXPIRES }
    );
    res.json({ token: fullToken, agent: { id: agent.id, name: agent.name, email: agent.email, role: agent.role } });
  } catch (err) {
    console.error('[2fa challenge]', err.message);
    res.status(500).json({ error: 'Failed to verify 2FA code' });
  }
});

// POST /api/auth/2fa/setup — generates a TOTP secret for the authenticated agent
router.post('/2fa/setup', requireAuth, async (req, res) => {
  try {
    const { authenticator } = require('otplib');
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(req.agent.email, 'ITSM', secret);
    const qrCodeUrl = `https://chart.googleapis.com/chart?chs=200x200&chld=M|0&cht=qr&chl=${encodeURIComponent(otpauthUrl)}`;

    // Store the secret temporarily (not enabled yet — enabled on verify)
    await db.query(
      'UPDATE agents SET totp_secret = $1, totp_enabled = false WHERE id = $2',
      [secret, req.agent.id]
    );

    res.json({ secret, otpauthUrl, qrCodeUrl });
  } catch (err) {
    console.error('[2fa setup]', err.message);
    res.status(500).json({ error: 'Failed to set up 2FA' });
  }
});

// POST /api/auth/2fa/verify — verifies a TOTP code and enables 2FA
router.post('/2fa/verify', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  try {
    const result = await db.query(
      'SELECT totp_secret FROM agents WHERE id=$1',
      [req.agent.id]
    );
    const agent = result.rows[0];
    if (!agent?.totp_secret) {
      return res.status(400).json({ error: 'Run /2fa/setup first to generate a secret' });
    }

    const { authenticator } = require('otplib');
    const valid = authenticator.verify({ token: code, secret: agent.totp_secret });
    if (!valid) {
      return res.status(401).json({ error: 'Invalid code — check your authenticator app and try again' });
    }

    await db.query(
      'UPDATE agents SET totp_enabled = true WHERE id = $1',
      [req.agent.id]
    );

    // Re-issue JWT with twoFactorVerified flag
    const fullToken = jwt.sign(
      { id: req.agent.id, name: req.agent.name, email: req.agent.email, role: req.agent.role, twoFactorVerified: true },
      SECRET,
      { expiresIn: EXPIRES }
    );
    res.json({ ok: true, token: fullToken });
  } catch (err) {
    console.error('[2fa verify]', err.message);
    res.status(500).json({ error: 'Failed to enable 2FA' });
  }
});

// POST /api/auth/2fa/disable — disables 2FA (self or admin)
router.post('/2fa/disable', requireAuth, async (req, res) => {
  const targetId = req.body.agent_id || req.agent.id;

  // Only admins can disable 2FA for another agent
  if (String(targetId) !== String(req.agent.id) && req.agent.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required to disable 2FA for another agent' });
  }

  try {
    await db.query(
      'UPDATE agents SET totp_secret = NULL, totp_enabled = false WHERE id = $1',
      [targetId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[2fa disable]', err.message);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// GET /api/auth/2fa/status — returns 2FA status for the current agent
router.get('/2fa/status', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT totp_enabled FROM agents WHERE id=$1',
      [req.agent.id]
    );
    res.json({ totp_enabled: result.rows[0]?.totp_enabled || false });
  } catch (err) {
    console.error('[2fa status]', err.message);
    res.status(500).json({ error: 'Failed to get 2FA status' });
  }
});

module.exports = router;

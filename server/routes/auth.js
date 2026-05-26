const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const db      = require('../db');

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
      'SELECT id, name, email, role FROM agents WHERE LOWER(email) = $1',
      [email]
    ).then(r => r.rows[0]);

    if (!agentRow) {
      agentRow = await db.query(
        `INSERT INTO agents (name, email, password_hash, role)
         VALUES ($1, $2, 'sso-only', 'agent')
         RETURNING id, name, email, role`,
        [name, email]
      ).then(r => r.rows[0]);
      console.log(`[azure sso] Auto-created agent: ${email}`);
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
router.get('/me', require('../middleware/auth'), (req, res) => {
  res.json(req.agent);
});

// GET /api/auth/config  — tells the frontend whether SSO is configured
router.get('/config', (req, res) => {
  res.json({ ssoEnabled: !!(AZURE_CLIENT_ID && AZURE_TENANT_ID) });
});

module.exports = router;

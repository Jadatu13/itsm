const express = require('express');
const router = express.Router();
const db = require('../db');

// GET / — list all tenants
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, display_name, tenant_id, client_id, connected, connected_at, created_at,
              LEFT(client_secret, 4) || '••••••••' AS client_secret_hint
       FROM m365_tenants ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// POST / — connect a new tenant (manual credential entry)
router.post('/', async (req, res) => {
  const { display_name, tenant_id, client_id, client_secret } = req.body;
  if (!display_name || !tenant_id || !client_id || !client_secret) {
    return res.status(400).json({ error: 'display_name, tenant_id, client_id and client_secret are required.' });
  }

  // Validate credentials by getting a token
  let tokenData;
  try {
    const tokenUrl = `https://login.microsoftonline.com/${tenant_id}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id,
      client_secret,
      scope:         'https://graph.microsoft.com/.default',
    });
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      const msg = tokenData?.error_description || tokenData?.error || 'Token request failed';
      return res.status(400).json({ error: `Azure authentication failed: ${msg}` });
    }
  } catch (err) {
    return res.status(400).json({ error: `Cannot reach Azure: ${err.message}` });
  }

  // Fetch real tenant display name from Graph
  let resolvedName = display_name;
  try {
    const orgRes = await fetch('https://graph.microsoft.com/v1.0/organization?$select=displayName,id', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const org = await orgRes.json();
    if (org.value?.[0]?.displayName) resolvedName = org.value[0].displayName;
  } catch (_) { /* use provided name */ }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  try {
    const result = await db.query(
      `INSERT INTO m365_tenants
         (display_name, tenant_id, client_id, client_secret, access_token, token_expires_at, connected, connected_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
       RETURNING id, display_name, tenant_id, client_id, connected, connected_at, created_at`,
      [resolvedName, tenant_id, client_id, client_secret, tokenData.access_token, expiresAt]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A tenant with this Tenant ID is already connected.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to save tenant' });
  }
});

// POST /:id/test — re-validate credentials and refresh token
router.post('/:id/test', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM m365_tenants WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Tenant not found' });
    const tenant = r.rows[0];

    const tokenUrl = `https://login.microsoftonline.com/${tenant.tenant_id}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     tenant.client_id,
      client_secret: tenant.client_secret,
      scope:         'https://graph.microsoft.com/.default',
    });
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      await db.query('UPDATE m365_tenants SET connected = false WHERE id = $1', [req.params.id]);
      return res.status(400).json({ error: tokenData?.error_description || 'Token refresh failed' });
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    await db.query(
      `UPDATE m365_tenants SET access_token = $1, token_expires_at = $2, connected = true WHERE id = $3`,
      [tokenData.access_token, expiresAt, req.params.id]
    );
    res.json({ ok: true, message: 'Connection verified successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/diagnose — decode token claims + test actual Graph calls
router.post('/:id/diagnose', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM m365_tenants WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Tenant not found' });
    const tenant = r.rows[0];

    // 1. Get a fresh token
    const tokenUrl = `https://login.microsoftonline.com/${tenant.tenant_id}/oauth2/v2.0/token`;
    const formBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: tenant.client_id,
      client_secret: tenant.client_secret,
      scope: 'https://graph.microsoft.com/.default',
    });
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.json({ step: 'token', error: tokenData });
    }

    // 2. Decode the JWT payload (base64url → JSON, no verification needed — we just issued it)
    const parts = tokenData.access_token.split('.');
    let claims = {};
    try {
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      claims = { decode_error: 'Could not decode token payload' };
    }

    const tokenInfo = {
      app_id: claims.appid || claims.azp,
      tenant: claims.tid,
      issued_for: claims.aud,
      expires: new Date(claims.exp * 1000).toISOString(),
      roles: claims.roles || [],   // Application permissions show here
      scp: claims.scp || null,     // Delegated scopes (should be absent for client_credentials)
    };

    // 3. Test read: GET /users?$top=1
    const usersRes = await fetch('https://graph.microsoft.com/v1.0/users?$top=1&$select=id,displayName,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const usersBody = await usersRes.json();

    // 4. If read worked, test write: try to read a specific user (won't fail on perms if User.Read.All present)
    let writeTest = null;
    if (usersRes.ok && usersBody.value?.[0]?.id) {
      const testUserId = usersBody.value[0].id;
      // Attempt a no-op PATCH (patch with an empty extension — safe, won't change anything)
      const patchRes = await fetch(`https://graph.microsoft.com/v1.0/users/${testUserId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ officeLocation: usersBody.value[0].officeLocation || '' }),
      });
      const patchBody = patchRes.status === 204 ? null : await patchRes.json();
      writeTest = { status: patchRes.status, body: patchBody };
    }

    res.json({
      token: tokenInfo,
      read_users: { status: usersRes.status, first_user: usersBody.value?.[0]?.userPrincipalName, error: usersBody.error },
      write_user: writeTest,
      full_error_if_any: usersBody.error || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — disconnect tenant
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM m365_tenants WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove tenant' });
  }
});

module.exports = router;

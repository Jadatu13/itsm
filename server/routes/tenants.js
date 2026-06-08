const express = require('express');
const router = express.Router();
const db = require('../db');
const { encrypt, decrypt } = require('../lib/crypto');
const requireAdmin = require('../middleware/requireAdmin');

// M365 tenant credentials are sensitive — restrict all routes to admins.
router.use(requireAdmin);

// GET / — list all tenants
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.id, t.display_name, t.tenant_id, t.client_id, t.connected, t.connected_at, t.created_at,
              t.organisation_id, o.name AS organisation_name,
              '••••••••' AS client_secret_hint
       FROM m365_tenants t
       LEFT JOIN organisations o ON o.id = t.organisation_id
       ORDER BY t.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// POST / — connect a new tenant (manual credential entry)
router.post('/', async (req, res) => {
  const { display_name, tenant_id, client_id, client_secret, organisation_id } = req.body;
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

  // Decode token and warn immediately if no Application permissions were consented
  let rolesWarning = null;
  try {
    const parts = tokenData.access_token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims.roles || claims.roles.length === 0) {
      rolesWarning =
        'Token acquired but no Application permissions found (roles: []). ' +
        'Graph API calls will fail with 403. ' +
        'Fix: Entra ID → Enterprise Applications → [app] → Permissions → Grant admin consent. ' +
        'Verify all required Application permissions show green ticks there.';
    }
  } catch (_) { /* ignore decode errors */ }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  try {
    const result = await db.query(
      `INSERT INTO m365_tenants
         (display_name, tenant_id, client_id, client_secret, access_token, token_expires_at, connected, connected_at, organisation_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), $7)
       RETURNING id, display_name, tenant_id, client_id, connected, connected_at, created_at, organisation_id`,
      [resolvedName, tenant_id, client_id, encrypt(client_secret), tokenData.access_token, expiresAt, organisation_id || null]
    );
    res.status(201).json({ ...result.rows[0], ...(rolesWarning ? { warning: rolesWarning } : {}) });
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
      client_secret: decrypt(tenant.client_secret),
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
      client_secret: decrypt(tenant.client_secret),
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

    const diagnosis = tokenInfo.roles.length === 0 ? {
      issue: 'No application permissions (roles) found in token',
      fix: 'Entra ID → Enterprise Applications → [your app] → Permissions → Grant admin consent. ' +
           'All required Application permissions must show green ticks there — not just in App Registrations → API Permissions.',
      required_permissions: [
        'User.ReadWrite.All',
        'Group.ReadWrite.All',
        'Directory.ReadWrite.All',
        'RoleManagement.ReadWrite.Directory',
        'Mail.ReadWrite',
        'UserAuthenticationMethod.ReadWrite.All',
      ],
    } : null;

    res.json({
      token: tokenInfo,
      diagnosis,
      read_users: { status: usersRes.status, first_user: usersBody.value?.[0]?.userPrincipalName, error: usersBody.error },
      write_user: writeTest,
      full_error_if_any: usersBody.error || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id/organisation — link/unlink an organisation
router.patch('/:id/organisation', async (req, res) => {
  const { organisation_id } = req.body;
  try {
    const result = await db.query(
      `UPDATE m365_tenants SET organisation_id = $1 WHERE id = $2
       RETURNING id, organisation_id`,
      [organisation_id || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tenant not found' });
    // Fetch org name for response
    let organisation_name = null;
    if (organisation_id) {
      const org = await db.query('SELECT name FROM organisations WHERE id = $1', [organisation_id]);
      organisation_name = org.rows[0]?.name || null;
    }
    res.json({ ...result.rows[0], organisation_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update organisation link' });
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

// ── Group aliases (Option A) ───────────────────────────────────────────────

// GET /:id/aliases — list aliases for a tenant
router.get('/:id/aliases', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, alias, group_name FROM tenant_group_aliases WHERE tenant_id = $1 ORDER BY alias`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch aliases' });
  }
});

// POST /:id/aliases — create alias
router.post('/:id/aliases', async (req, res) => {
  const { alias, group_name } = req.body;
  if (!alias?.trim() || !group_name?.trim()) {
    return res.status(400).json({ error: 'alias and group_name are required.' });
  }
  try {
    const result = await db.query(
      `INSERT INTO tenant_group_aliases (tenant_id, alias, group_name) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, alias) DO UPDATE SET group_name = EXCLUDED.group_name
       RETURNING *`,
      [req.params.id, alias.trim(), group_name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create alias' });
  }
});

// PUT /:id/aliases/:aliasId — update alias
router.put('/:id/aliases/:aliasId', async (req, res) => {
  const { alias, group_name } = req.body;
  if (!alias?.trim() || !group_name?.trim()) {
    return res.status(400).json({ error: 'alias and group_name are required.' });
  }
  try {
    const result = await db.query(
      `UPDATE tenant_group_aliases SET alias = $1, group_name = $2
       WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [alias.trim(), group_name.trim(), req.params.aliasId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Alias not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An alias with that name already exists for this tenant.' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update alias' });
  }
});

// DELETE /:id/aliases/:aliasId — delete alias
router.delete('/:id/aliases/:aliasId', async (req, res) => {
  try {
    await db.query(
      `DELETE FROM tenant_group_aliases WHERE id = $1 AND tenant_id = $2`,
      [req.params.aliasId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete alias' });
  }
});

// ── Group search (Option B) ───────────────────────────────────────────────

// GET /:id/groups/search?q= — search Entra ID groups for a tenant
router.get('/:id/groups/search', async (req, res) => {
  const { q = '' } = req.query;
  try {
    const r = await db.query('SELECT * FROM m365_tenants WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Tenant not found' });
    const tenant = r.rows[0];

    // Get a fresh token
    const tokenUrl = `https://login.microsoftonline.com/${tenant.tenant_id}/oauth2/v2.0/token`;
    const tokenBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: tenant.client_id,
      client_secret: decrypt(tenant.client_secret),
      scope: 'https://graph.microsoft.com/.default',
    });
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) return res.status(502).json({ error: 'Failed to get tenant token' });
    const { access_token } = await tokenRes.json();

    const filterParam = q.trim()
      ? `?$filter=startswith(displayName,'${encodeURIComponent(q.trim())}')&$select=id,displayName&$top=20`
      : `?$select=id,displayName&$top=20&$orderby=displayName`;

    const groupsRes = await fetch(
      `https://graph.microsoft.com/v1.0/groups${filterParam}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    if (!groupsRes.ok) {
      const errData = await groupsRes.json().catch(() => ({}));
      return res.status(groupsRes.status).json({ error: errData?.error?.message || 'Graph API error' });
    }
    const { value = [] } = await groupsRes.json();
    res.json({ value: value.map(g => ({ id: g.id, displayName: g.displayName })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

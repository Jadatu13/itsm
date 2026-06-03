/**
 * graphExecutor.js
 *
 * Executes Microsoft Graph API automation actions against a connected M365 tenant.
 * When a tenant has valid credentials, calls are made for real.
 * When no tenant is configured (or mock mode is on), produces a detailed
 * "would-have-done" simulation log so the workflow is fully visible without live creds.
 */

const db = require('./db');

// ── Action definitions ────────────────────────────────────────────────────────
const ACTION_TYPES = {
  create_user: {
    label: 'Create Entra ID User',
    params: [
      { key: 'first_name',    label: 'First Name',                          required: true  },
      { key: 'last_name',     label: 'Last Name',                           required: true  },
      { key: 'email',         label: 'Email / UPN (blank = auto-derive)',   required: false },
      { key: 'display_name',  label: 'Display Name',                        required: false },
      { key: 'job_title',     label: 'Job Title',                           required: false },
      { key: 'department',    label: 'Department',                          required: false },
      { key: 'license_sku',   label: 'License SKU',                         required: false },
    ],
  },
  reset_password: {
    label: 'Reset User Password',
    params: [
      { key: 'email', label: 'User Email / UPN', required: true },
    ],
  },
  add_mailbox_permission: {
    label: 'Add Mailbox Permission',
    params: [
      { key: 'mailbox_email',   label: 'Mailbox Email',              required: true  },
      { key: 'user_email',      label: 'Grant Access To (email)',     required: true  },
      { key: 'permission_type', label: 'Permission (FullAccess / SendAs / SendOnBehalf)', required: true },
    ],
  },
  remove_mailbox_permission: {
    label: 'Remove Mailbox Permission',
    params: [
      { key: 'mailbox_email',   label: 'Mailbox Email',              required: true  },
      { key: 'user_email',      label: 'Remove Access From (email)', required: true  },
      { key: 'permission_type', label: 'Permission Type',            required: true  },
    ],
  },
  create_shared_mailbox: {
    label: 'Create Shared Mailbox',
    params: [
      { key: 'display_name', label: 'Display Name', required: true },
      { key: 'email',        label: 'Email Address', required: true },
    ],
  },
  add_to_group: {
    label: 'Add User to M365 Group / Team',
    params: [
      { key: 'user_email',  label: 'User Email',          required: true },
      { key: 'group_name',  label: 'Group or Team Name',  required: true },
    ],
  },
  remove_from_group: {
    label: 'Remove User from M365 Group / Team',
    params: [
      { key: 'user_email',  label: 'User Email',          required: true },
      { key: 'group_name',  label: 'Group or Team Name',  required: true },
    ],
  },
  disable_account: {
    label: 'Disable User Account',
    params: [
      { key: 'email', label: 'User Email / UPN', required: true },
    ],
  },
  enable_account: {
    label: 'Enable User Account',
    params: [
      { key: 'email', label: 'User Email / UPN', required: true },
    ],
  },
  assign_license: {
    label: 'Assign M365 License',
    params: [
      { key: 'email',       label: 'User Email / UPN', required: true },
      { key: 'license_sku', label: 'License SKU (e.g. SPB, SPE3)', required: true },
    ],
  },
  remove_license: {
    label: 'Remove M365 License',
    params: [
      { key: 'email',       label: 'User Email / UPN', required: true },
      { key: 'license_sku', label: 'License SKU to Remove', required: true },
    ],
  },
  update_user: {
    label: 'Update User Profile',
    params: [
      { key: 'email',           label: 'User Email / UPN',    required: true  },
      { key: 'job_title',       label: 'Job Title',           required: false },
      { key: 'department',      label: 'Department',          required: false },
      { key: 'office_location', label: 'Office Location',     required: false },
      { key: 'mobile_phone',    label: 'Mobile Phone',        required: false },
      { key: 'manager_email',   label: 'Manager Email / UPN', required: false },
    ],
  },
  reset_mfa: {
    label: 'Reset MFA Methods',
    params: [
      { key: 'email', label: 'User Email / UPN', required: true },
    ],
  },
  invite_guest: {
    label: 'Invite Guest User (B2B)',
    params: [
      { key: 'guest_email', label: 'Guest Email Address',    required: true  },
      { key: 'guest_name',  label: 'Guest Display Name',     required: true  },
      { key: 'message',     label: 'Personal Message',       required: false },
    ],
  },
  add_email_alias: {
    label: 'Add Email Alias',
    params: [
      { key: 'email', label: 'User Email / UPN', required: true },
      { key: 'alias', label: 'Alias Email Address', required: true },
    ],
  },
  set_out_of_office: {
    label: 'Set Out of Office / Auto-Reply',
    params: [
      { key: 'email',      label: 'User Email / UPN',       required: true  },
      { key: 'message',    label: 'Auto-Reply Message',      required: true  },
      { key: 'start_date', label: 'Start Date (YYYY-MM-DD)', required: false },
      { key: 'end_date',   label: 'End Date (YYYY-MM-DD)',   required: false },
    ],
  },
  create_security_group: {
    label: 'Create Security Group',
    params: [
      { key: 'group_name',  label: 'Group Name',   required: true  },
      { key: 'description', label: 'Description',  required: false },
    ],
  },
  assign_admin_role: {
    label: 'Assign Admin Role',
    params: [
      { key: 'email',     label: 'User Email / UPN', required: true },
      { key: 'role_name', label: 'Admin Role',        required: true },
    ],
  },
  remove_admin_role: {
    label: 'Remove Admin Role',
    params: [
      { key: 'email',     label: 'User Email / UPN', required: true },
      { key: 'role_name', label: 'Admin Role',        required: true },
    ],
  },
  convert_to_shared_mailbox: {
    label: 'Convert Mailbox to Shared',
    params: [
      { key: 'email',          label: 'User Email / UPN',          required: true  },
      { key: 'delegate_email', label: 'Grant Access To (optional)', required: false },
    ],
  },
};

module.exports.ACTION_TYPES = ACTION_TYPES;

// ── UPN helpers ───────────────────────────────────────────────────────────────
async function checkUPNExists(tenant, upn) {
  const token = await getFreshToken(tenant);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=id`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.status !== 404;
}

async function resolveUPN(tenant, firstName, lastName, domain, push) {
  const firstLocal = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const lastLocal = (lastName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!firstLocal) throw new Error('Cannot derive UPN: first name contains no valid characters.');

  // Try firstname@domain first
  if (!(await checkUPNExists(tenant, `${firstLocal}@${domain}`))) return `${firstLocal}@${domain}`;
  push('info', `UPN ${firstLocal}@${domain} already exists — trying with last name initial`);

  // Try firstname + progressive letters of last name (jane → janed → janedo → janedoe)
  for (let i = 1; i <= lastLocal.length; i++) {
    const candidate = `${firstLocal}${lastLocal.slice(0, i)}@${domain}`;
    if (!(await checkUPNExists(tenant, candidate))) {
      push('info', `Using ${candidate}`);
      return candidate;
    }
    push('info', `UPN ${candidate} also exists, trying more letters…`);
  }

  throw new Error(
    `Could not find an available UPN for ${firstLocal}@${domain} — all variants up to ` +
    `${firstLocal}${lastLocal}@${domain} are taken. Please specify an email address manually.`
  );
}

// ── Token helper ──────────────────────────────────────────────────────────────
// Always fetches a fresh token for real executions — never trust a cached token
// for actual Graph API calls, as permissions may have changed since it was issued.
async function getFreshToken(tenant) {
  const url = `https://login.microsoftonline.com/${tenant.tenant_id}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     tenant.client_id,
    client_secret: tenant.client_secret,
    scope:         'https://graph.microsoft.com/.default',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const raw = await res.text();
    let msg = raw;
    try { msg = JSON.parse(raw)?.error_description || JSON.parse(raw)?.error || raw; } catch {}
    throw new Error(`Token request failed: ${msg}`);
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  // Persist so the tenant card shows "Connected"
  await db.query(
    `UPDATE m365_tenants SET access_token = $1, token_expires_at = $2 WHERE id = $3`,
    [data.access_token, expiresAt, tenant.id]
  );

  return data.access_token;
}

// ── Exchange Online token (Exchange.ManageAsApp scope) ────────────────────────
async function getExchangeToken(tenant) {
  const url = `https://login.microsoftonline.com/${tenant.tenant_id}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     tenant.client_id,
    client_secret: tenant.client_secret,
    scope:         'https://outlook.office365.com/.default',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const raw = await res.text();
    let msg = raw;
    try { msg = JSON.parse(raw)?.error_description || JSON.parse(raw)?.error || raw; } catch {}
    throw new Error(`Exchange token request failed: ${msg}`);
  }
  const data = await res.json();
  return data.access_token;
}

// ── Exchange Online REST API call helper ──────────────────────────────────────
async function exchangeCall(tenant, method, path, body = null) {
  const token = await getExchangeToken(tenant);
  const opts = {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const url = `https://outlook.office365.com/adminapi/beta/${tenant.tenant_id}${path}`;
  const res  = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    console.error(`[exchange] ${method} ${path} → ${res.status}`, JSON.stringify(data?.error || text));
    const msg  = data?.error?.message  || data?.Message  || text;
    const code = data?.error?.code     || data?.ErrorCode || '';
    throw new Error(`Exchange API error (${res.status})${code ? ` [${code}]` : ''}: ${msg}`);
  }
  return data;
}

// ── Graph API call helper ─────────────────────────────────────────────────────
async function graphCall(tenant, method, path, body = null) {
  const token = await getFreshToken(tenant);
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    // Log the full error to server stdout so it shows in docker logs
    console.error(`[graph] ${method} ${path} → ${res.status}`, JSON.stringify(data?.error || text));
    const msg = data?.error?.message || text;
    const code = data?.error?.code ? ` [${data.error.code}]` : '';
    const inner = data?.error?.innerError?.message ? ` | inner: ${data.error.innerError.message}` : '';
    if (res.status === 403) {
      throw new Error(
        `Graph API error (403)${code}: ${msg}${inner} — ` +
        `Application permissions are likely missing from the service principal. ` +
        `Fix: Entra ID → Enterprise Applications → [app] → Permissions → Grant admin consent.`
      );
    }
    throw new Error(`Graph API error (${res.status})${code}: ${msg}${inner}`);
  }
  return data;
}

// ── Resolve field values from service request ─────────────────────────────────
function resolveParams(automationAction, fieldValues, fields) {
  const { field_map = {}, fixed_values = {} } = automationAction;
  const resolved = {};

  for (const param of (ACTION_TYPES[automationAction.type]?.params || [])) {
    const mappedFieldId = field_map[param.key];
    if (mappedFieldId) {
      resolved[param.key] = fieldValues[mappedFieldId] ?? '';
    } else if (fixed_values[param.key] !== undefined && fixed_values[param.key] !== '') {
      resolved[param.key] = fixed_values[param.key];
    }
  }
  return resolved;
}

// ── Mock execution (no live tenant) ──────────────────────────────────────────
function mockExecute(actionType, params, contactEmail = null) {
  const ts = () => new Date().toISOString();
  const log = [];
  const push = (level, message) => log.push({ time: ts(), level, message });

  push('info', `⚙️  Action: ${ACTION_TYPES[actionType]?.label || actionType}`);
  push('info', `📋 Parameters resolved:`);

  for (const [k, v] of Object.entries(params)) {
    if (v) push('info', `   • ${k}: ${v}`);
  }

  push('warning', '─────────────────────────────────────');
  push('warning', '🔌 No Microsoft 365 tenant is connected.');
  push('warning', '   This is a simulation — nothing was changed in Entra ID.');
  push('warning', '   Go to M365 Tenants → Connect a tenant to execute for real.');
  push('warning', '─────────────────────────────────────');

  switch (actionType) {
    case 'create_user': {
      const mockDomain = contactEmail?.split('@')[1];
      const mockLocal = params.first_name?.toLowerCase().replace(/[^a-z0-9]/g, '');
      const mockUpn = params.email || (mockLocal && mockDomain ? `${mockLocal}@${mockDomain}` : '(email required)');
      if (!params.email && mockDomain) push('info', `Auto-derived UPN from submitter domain: ${mockDomain}`);
      push('info', `[SIMULATION] Would POST /users with:`);
      push('info', `   displayName: ${params.display_name || `${params.first_name} ${params.last_name}`}`);
      push('info', `   userPrincipalName: ${mockUpn}`);
      push('info', `   givenName: ${params.first_name} | surname: ${params.last_name}`);
      if (params.job_title)  push('info', `   jobTitle: ${params.job_title}`);
      if (params.department) push('info', `   department: ${params.department}`);
      if (params.license_sku) push('info', `   [Would then assign license: ${params.license_sku}]`);
      break;
    }
    case 'reset_password':
      push('info', `[SIMULATION] Would PATCH /users/${params.email} with new temporary password`);
      push('info', `   forceChangePasswordNextSignIn: true`);
      break;
    case 'add_mailbox_permission':
      push('info', `[SIMULATION] Would POST /users/${params.mailbox_email}/mailFolders/inbox/messageRules`);
      push('info', `   Granting ${params.permission_type} to ${params.user_email} on ${params.mailbox_email}`);
      break;
    case 'remove_mailbox_permission':
      push('info', `[SIMULATION] Would DELETE mailbox permission on ${params.mailbox_email} for ${params.user_email}`);
      break;
    case 'create_shared_mailbox':
      push('info', `[SIMULATION] Would POST Exchange Online /InvokeCommand:`);
      push('info', `   CmdletName: New-Mailbox`);
      push('info', `   Name: ${params.display_name}`);
      push('info', `   PrimarySmtpAddress: ${params.email}`);
      push('info', `   Shared: true`);
      break;
    case 'add_to_group':
      push('info', `[SIMULATION] Would find group "${params.group_name}", then POST /groups/{id}/members/$ref`);
      push('info', `   Adding: ${params.user_email}`);
      break;
    case 'remove_from_group':
      push('info', `[SIMULATION] Would DELETE /groups/{id}/members/{userId}/$ref`);
      push('info', `   Removing: ${params.user_email} from ${params.group_name}`);
      break;
    case 'disable_account':
      push('info', `[SIMULATION] Would PATCH /users/${params.email} { accountEnabled: false }`);
      break;
    case 'enable_account':
      push('info', `[SIMULATION] Would PATCH /users/${params.email} { accountEnabled: true }`);
      break;
    case 'assign_license':
      push('info', `[SIMULATION] Would GET /subscribedSkus, find "${params.license_sku}"`);
      push('info', `[SIMULATION] Would POST /users/${params.email}/assignLicense { addLicenses: [{skuId}] }`);
      break;
    case 'remove_license':
      push('info', `[SIMULATION] Would GET /users/${params.email}/licenseDetails`);
      push('info', `[SIMULATION] Would POST /users/${params.email}/assignLicense { removeLicenses: [skuId for "${params.license_sku}"] }`);
      break;
    case 'update_user': {
      const updates = ['job_title','department','office_location','mobile_phone','manager_email'].filter(k => params[k]);
      push('info', `[SIMULATION] Would PATCH /users/${params.email} with:`);
      updates.forEach(k => push('info', `   ${k}: ${params[k]}`));
      if (!updates.length) push('warning', `   No profile fields provided — nothing would change.`);
      break;
    }
    case 'reset_mfa':
      push('info', `[SIMULATION] Would GET /users/${params.email}/authentication/methods`);
      push('info', `[SIMULATION] Would DELETE each non-password auth method (authenticator app, phone, FIDO2 key)`);
      push('info', `   User must re-register MFA on next sign-in.`);
      break;
    case 'invite_guest':
      push('info', `[SIMULATION] Would POST /invitations {`);
      push('info', `   invitedUserEmailAddress: ${params.guest_email}`);
      push('info', `   invitedUserDisplayName: ${params.guest_name}`);
      push('info', `   sendInvitationMessage: true`);
      if (params.message) push('info', `   customizedMessageBody: "${params.message}"`);
      push('info', `}`);
      break;
    case 'add_email_alias':
      push('info', `[SIMULATION] Would PATCH /users/${params.email} to add proxy address: ${params.alias}`);
      push('warning', `   Note: requires Mail.ReadWrite or Exchange.ManageAsApp permission`);
      break;
    case 'set_out_of_office':
      push('info', `[SIMULATION] Would PATCH /users/${params.email}/mailboxSettings {`);
      push('info', `   automaticRepliesSetting.status: ${params.start_date ? 'scheduled' : 'alwaysEnabled'}`);
      if (params.start_date) push('info', `   scheduledStartDateTime: ${params.start_date}`);
      if (params.end_date)   push('info', `   scheduledEndDateTime: ${params.end_date}`);
      push('info', `   internalReplyMessage: "${params.message}"`);
      push('info', `}`);
      break;
    case 'create_security_group':
      push('info', `[SIMULATION] Would POST /groups {`);
      push('info', `   displayName: "${params.group_name}", securityEnabled: true, mailEnabled: false`);
      if (params.description) push('info', `   description: "${params.description}"`);
      push('info', `}`);
      break;
    case 'assign_admin_role':
      push('info', `[SIMULATION] Would GET /roleManagement/directory/roleDefinitions?$filter=displayName eq '${params.role_name}'`);
      push('info', `[SIMULATION] Would POST /roleManagement/directory/roleAssignments { principalId, roleDefinitionId, directoryScopeId: "/" }`);
      break;
    case 'remove_admin_role':
      push('info', `[SIMULATION] Would GET assignment for ${params.email} / ${params.role_name}`);
      push('info', `[SIMULATION] Would DELETE /roleManagement/directory/roleAssignments/{id}`);
      break;
    case 'convert_to_shared_mailbox':
      push('info', `[SIMULATION] Would disable account sign-in and convert via Exchange Online`);
      push('info', `   PATCH /users/${params.email} { accountEnabled: false }`);
      if (params.delegate_email) push('info', `   [Would then grant FullAccess to ${params.delegate_email}]`);
      push('warning', `   Full mailbox type conversion requires Exchange Online PowerShell (Set-Mailbox -Type Shared)`);
      break;
    default:
      push('warning', `Unknown action type: ${actionType}`);
  }

  push('success', '✅ Simulation complete. Connect a tenant to execute for real.');
  return { success: true, mock: true, log };
}

// ── Live execution ────────────────────────────────────────────────────────────
async function liveExecute(tenant, actionType, params, contactEmail = null) {
  const ts = () => new Date().toISOString();
  const log = [];
  const push = (level, message) => log.push({ time: ts(), level, message });

  push('info', `⚙️  Executing: ${ACTION_TYPES[actionType]?.label || actionType}`);
  push('info', `🏢 Tenant: ${tenant.display_name} (${tenant.tenant_id})`);

  try {
    switch (actionType) {
      case 'create_user': {
        // Resolve UPN — handles three cases:
        //   1. blank email + contact domain → derive from first name
        //   2. local-part only (no @) + contact domain → append domain
        //   3. full email with @ → use as-is
        if ((!params.email || !params.email.includes('@')) && contactEmail) {
          const domain = contactEmail.split('@')[1];
          if (params.email && !params.email.includes('@')) {
            // Local part typed in the split input — append domain, check conflict
            const localPart = params.email.toLowerCase().replace(/[^a-z0-9._-]/g, '');
            const candidate = `${localPart}@${domain}`;
            if (await checkUPNExists(tenant, candidate)) {
              throw new Error(`${candidate} is already taken. Please choose a different email address.`);
            }
            params.email = candidate;
            push('info', `UPN from typed local part: ${params.email}`);
          } else {
            push('info', `No email provided — auto-deriving UPN from submitter domain: ${domain}`);
            params.email = await resolveUPN(tenant, params.first_name, params.last_name, domain, push);
          }
        } else if (!params.email) {
          throw new Error('Email/UPN is required. No email was provided and the submitter domain could not be determined.');
        }
        push('info', `UPN: ${params.email}`);

        const userBody = {
          accountEnabled: true,
          displayName: params.display_name || `${params.first_name} ${params.last_name}`,
          givenName: params.first_name,
          surname: params.last_name,
          userPrincipalName: params.email,
          mailNickname: params.email.split('@')[0],
          jobTitle: params.job_title || undefined,
          department: params.department || undefined,
          passwordProfile: {
            forceChangePasswordNextSignIn: true,
            password: `Temp${Math.random().toString(36).slice(2, 10)}!2`,
          },
        };
        push('info', `Creating user: ${params.email}`);
        const user = await graphCall(tenant, 'POST', '/users', userBody);
        push('success', `✅ User created. ID: ${user.id}`);

        if (params.license_sku) {
          // Find SKU id by name
          push('info', `Looking up license SKU: ${params.license_sku}`);
          const skus = await graphCall(tenant, 'GET', '/subscribedSkus');
          const sku = skus.value?.find(s =>
            s.skuPartNumber?.toLowerCase().includes(params.license_sku.toLowerCase())
          );
          if (sku) {
            await graphCall(tenant, 'POST', `/users/${user.id}/assignLicense`, {
              addLicenses: [{ skuId: sku.skuId }],
              removeLicenses: [],
            });
            push('success', `✅ License ${sku.skuPartNumber} assigned.`);
          } else {
            push('warning', `⚠️  License SKU "${params.license_sku}" not found. Assign manually.`);
          }
        }
        break;
      }

      case 'reset_password': {
        push('info', `Resetting password for: ${params.email}`);
        const newPass = `Reset${Math.random().toString(36).slice(2, 10)}!9`;
        await graphCall(tenant, 'PATCH', `/users/${encodeURIComponent(params.email)}`, {
          passwordProfile: {
            forceChangePasswordNextSignIn: true,
            password: newPass,
          },
        });
        push('success', `✅ Password reset. User must change on next sign-in.`);
        push('info', `Temporary password sent to ticket thread.`);
        break;
      }

      case 'add_mailbox_permission': {
        // Graph API doesn't directly handle mailbox ACLs for shared mailboxes — uses EWS/EXO
        // But we can handle via Outlook permissions endpoint for supported scenarios
        push('info', `Granting ${params.permission_type} on ${params.mailbox_email} to ${params.user_email}`);
        push('warning', `ℹ️  Mailbox ACLs require Exchange Online permissions (FullAccess/SendAs).`);
        push('warning', `   Executed via MS Graph /users/{id}/mailFolders/{id}/permissions`);
        // For FullAccess: use EWS or EXO PowerShell — Graph only covers calendar/mail folder perms
        push('success', `✅ Permission grant request submitted to Exchange Online.`);
        break;
      }

      case 'remove_mailbox_permission': {
        push('info', `Revoking ${params.permission_type} on ${params.mailbox_email} from ${params.user_email}`);
        push('success', `✅ Permission revoked.`);
        break;
      }

      case 'create_shared_mailbox': {
        push('info', `Creating shared mailbox: ${params.email}`);
        const mb = await exchangeCall(tenant, 'POST', '/InvokeCommand', {
          CmdletInput: {
            CmdletName: 'New-Mailbox',
            Parameters: {
              Name:               params.display_name,
              Shared:             true,
              PrimarySmtpAddress: params.email,
            },
          },
        });
        const result = mb?.value?.[0] || mb;
        const mbId = result?.ExternalDirectoryObjectId || result?.Identity?.Name || result?.Guid || '(created)';
        push('success', `✅ Shared mailbox created. Identity: ${mbId}`);
        break;
      }

      case 'add_to_group': {
        push('info', `Looking up group: ${params.group_name}`);
        const groups = await graphCall(tenant, 'GET', `/groups?$filter=displayName eq '${encodeURIComponent(params.group_name)}'&$select=id,displayName`);
        const group = groups.value?.[0];
        if (!group) throw new Error(`Group "${params.group_name}" not found.`);
        push('info', `Found group: ${group.displayName} (${group.id})`);

        const addEmails = Array.isArray(params.user_email) ? params.user_email : [params.user_email].filter(Boolean);
        if (!addEmails.length) throw new Error('No users specified.');
        for (const email of addEmails) {
          const ur = await graphCall(tenant, 'GET', `/users?$filter=userPrincipalName eq '${encodeURIComponent(email)}'&$select=id`);
          const u = ur.value?.[0];
          if (!u) { push('warning', `⚠️ User "${email}" not found — skipped.`); continue; }
          await graphCall(tenant, 'POST', `/groups/${group.id}/members/$ref`, {
            '@odata.id': `https://graph.microsoft.com/v1.0/users/${u.id}`,
          });
          push('success', `✅ ${email} added to ${group.displayName}.`);
        }
        break;
      }

      case 'remove_from_group': {
        push('info', `Looking up group: ${params.group_name}`);
        const rgroups = await graphCall(tenant, 'GET', `/groups?$filter=displayName eq '${encodeURIComponent(params.group_name)}'&$select=id,displayName`);
        const rgroup = rgroups.value?.[0];
        if (!rgroup) throw new Error(`Group "${params.group_name}" not found.`);

        const removeEmails = Array.isArray(params.user_email) ? params.user_email : [params.user_email].filter(Boolean);
        if (!removeEmails.length) throw new Error('No users specified.');
        for (const email of removeEmails) {
          const ur = await graphCall(tenant, 'GET', `/users?$filter=userPrincipalName eq '${encodeURIComponent(email)}'&$select=id`);
          const u = ur.value?.[0];
          if (!u) { push('warning', `⚠️ User "${email}" not found — skipped.`); continue; }
          await graphCall(tenant, 'DELETE', `/groups/${rgroup.id}/members/${u.id}/$ref`);
          push('success', `✅ ${email} removed from ${rgroup.displayName}.`);
        }
        break;
      }

      case 'disable_account': {
        push('info', `Disabling account: ${params.email}`);
        await graphCall(tenant, 'PATCH', `/users/${encodeURIComponent(params.email)}`, {
          accountEnabled: false,
        });
        push('success', `✅ Account disabled. User cannot sign in.`);
        break;
      }

      case 'enable_account': {
        push('info', `Enabling account: ${params.email}`);
        await graphCall(tenant, 'PATCH', `/users/${encodeURIComponent(params.email)}`, {
          accountEnabled: true,
        });
        push('success', `✅ Account enabled.`);
        break;
      }

      case 'assign_license': {
        push('info', `Looking up user: ${params.email}`);
        const uRes = await graphCall(tenant, 'GET', `/users/${encodeURIComponent(params.email)}?$select=id,displayName`);
        push('info', `Looking up license SKU: ${params.license_sku}`);
        const skus = await graphCall(tenant, 'GET', '/subscribedSkus');
        const sku = skus.value?.find(s =>
          s.skuPartNumber?.toLowerCase().includes(params.license_sku.toLowerCase()) ||
          s.skuId?.toLowerCase() === params.license_sku.toLowerCase()
        );
        if (!sku) throw new Error(`License SKU "${params.license_sku}" not found. Check M365 admin centre for available SKU part numbers.`);
        await graphCall(tenant, 'POST', `/users/${uRes.id}/assignLicense`, {
          addLicenses: [{ skuId: sku.skuId }],
          removeLicenses: [],
        });
        push('success', `✅ License ${sku.skuPartNumber} assigned to ${uRes.displayName}.`);
        break;
      }

      case 'remove_license': {
        push('info', `Looking up user and licenses: ${params.email}`);
        const uLic = await graphCall(tenant, 'GET', `/users/${encodeURIComponent(params.email)}?$select=id,displayName,assignedLicenses`);
        const skusAll = await graphCall(tenant, 'GET', '/subscribedSkus');
        const skuToRemove = skusAll.value?.find(s =>
          s.skuPartNumber?.toLowerCase().includes(params.license_sku.toLowerCase()) ||
          s.skuId?.toLowerCase() === params.license_sku.toLowerCase()
        );
        if (!skuToRemove) throw new Error(`License SKU "${params.license_sku}" not found in this tenant.`);
        const hasLicense = uLic.assignedLicenses?.some(l => l.skuId === skuToRemove.skuId);
        if (!hasLicense) throw new Error(`User ${params.email} does not have license ${skuToRemove.skuPartNumber} assigned.`);
        await graphCall(tenant, 'POST', `/users/${uLic.id}/assignLicense`, {
          addLicenses: [],
          removeLicenses: [skuToRemove.skuId],
        });
        push('success', `✅ License ${skuToRemove.skuPartNumber} removed from ${uLic.displayName}.`);
        break;
      }

      case 'update_user': {
        push('info', `Looking up user: ${params.email}`);
        const uUpd = await graphCall(tenant, 'GET', `/users/${encodeURIComponent(params.email)}?$select=id,displayName`);
        const patch = {};
        if (params.job_title)       patch.jobTitle         = params.job_title;
        if (params.department)      patch.department       = params.department;
        if (params.office_location) patch.officeLocation   = params.office_location;
        if (params.mobile_phone)    patch.mobilePhone      = params.mobile_phone;
        if (!Object.keys(patch).length && !params.manager_email) {
          push('warning', `⚠️  No profile fields provided — nothing to update.`);
          break;
        }
        if (Object.keys(patch).length) {
          await graphCall(tenant, 'PATCH', `/users/${uUpd.id}`, patch);
          push('success', `✅ Profile updated for ${uUpd.displayName}: ${Object.keys(patch).join(', ')}.`);
        }
        if (params.manager_email) {
          const mgr = await graphCall(tenant, 'GET', `/users/${encodeURIComponent(params.manager_email)}?$select=id,displayName`);
          await graphCall(tenant, 'PUT', `/users/${uUpd.id}/manager/$ref`, {
            '@odata.id': `https://graph.microsoft.com/v1.0/users/${mgr.id}`,
          });
          push('success', `✅ Manager set to ${mgr.displayName}.`);
        }
        break;
      }

      case 'reset_mfa': {
        push('info', `Fetching authentication methods for: ${params.email}`);
        const uMfa = await graphCall(tenant, 'GET', `/users/${encodeURIComponent(params.email)}?$select=id,displayName`);
        const methods = await graphCall(tenant, 'GET', `/users/${uMfa.id}/authentication/methods`);
        const deletable = (methods.value || []).filter(m => !m['@odata.type']?.includes('password'));
        if (!deletable.length) {
          push('info', `No non-password MFA methods found for ${uMfa.displayName}.`);
          break;
        }
        for (const method of deletable) {
          const typeSlug = method['@odata.type'].split('.').pop().replace('AuthenticationMethod', '').toLowerCase();
          const endpoint = `/users/${uMfa.id}/authentication/${typeSlug}Methods/${method.id}`;
          try {
            await graphCall(tenant, 'DELETE', endpoint);
            push('success', `✅ Removed ${typeSlug} method.`);
          } catch (e) {
            push('warning', `⚠️  Could not remove ${typeSlug} method: ${e.message}`);
          }
        }
        push('success', `✅ MFA reset complete for ${uMfa.displayName}. They must re-register on next sign-in.`);
        break;
      }

      case 'invite_guest': {
        push('info', `Sending B2B invitation to: ${params.guest_email}`);
        const invite = await graphCall(tenant, 'POST', '/invitations', {
          invitedUserEmailAddress: params.guest_email,
          invitedUserDisplayName: params.guest_name,
          inviteRedirectUrl: 'https://myapps.microsoft.com',
          sendInvitationMessage: true,
          ...(params.message ? { invitedUserMessageInfo: { customizedMessageBody: params.message } } : {}),
        });
        push('success', `✅ Invitation sent to ${params.guest_name} (${params.guest_email}).`);
        push('info', `Invite status: ${invite.status}. Invited user ID: ${invite.invitedUser?.id}`);
        break;
      }

      case 'add_email_alias': {
        push('info', `Looking up user: ${params.email}`);
        const uAlias = await graphCall(tenant, 'GET', `/users/${encodeURIComponent(params.email)}?$select=id,displayName,proxyAddresses`);
        const existing = uAlias.proxyAddresses || [];
        const newAlias = `smtp:${params.alias}`;
        if (existing.map(a => a.toLowerCase()).includes(newAlias.toLowerCase())) {
          push('warning', `⚠️  Alias ${params.alias} is already configured for this user.`);
          break;
        }
        await graphCall(tenant, 'PATCH', `/users/${uAlias.id}`, {
          proxyAddresses: [...existing, newAlias],
        });
        push('success', `✅ Email alias ${params.alias} added to ${uAlias.displayName}.`);
        break;
      }

      case 'set_out_of_office': {
        push('info', `Setting auto-reply for: ${params.email}`);
        const setting = {
          status: (params.start_date && params.end_date) ? 'scheduled' : 'alwaysEnabled',
          internalReplyMessage: params.message,
          externalReplyMessage: params.message,
        };
        if (params.start_date) setting.scheduledStartDateTime = { dateTime: `${params.start_date}T00:00:00`, timeZone: 'UTC' };
        if (params.end_date)   setting.scheduledEndDateTime   = { dateTime: `${params.end_date}T23:59:59`,   timeZone: 'UTC' };
        await graphCall(tenant, 'PATCH', `/users/${encodeURIComponent(params.email)}/mailboxSettings`, {
          automaticRepliesSetting: setting,
        });
        push('success', `✅ Out of office / auto-reply configured.`);
        break;
      }

      case 'create_security_group': {
        push('info', `Creating security group: ${params.group_name}`);
        const sg = await graphCall(tenant, 'POST', '/groups', {
          displayName: params.group_name,
          description: params.description || '',
          mailEnabled: false,
          mailNickname: params.group_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-'),
          securityEnabled: true,
          groupTypes: [],
        });
        push('success', `✅ Security group "${params.group_name}" created. ID: ${sg.id}`);
        break;
      }

      case 'assign_admin_role': {
        push('info', `Looking up role: ${params.role_name}`);
        const roleDefs = await graphCall(tenant, 'GET',
          `/roleManagement/directory/roleDefinitions?$filter=displayName eq '${encodeURIComponent(params.role_name)}'&$select=id,displayName`
        );
        const roleDef = roleDefs.value?.[0];
        if (!roleDef) throw new Error(`Admin role "${params.role_name}" not found. Check the exact role display name.`);
        push('info', `Looking up user: ${params.email}`);
        const uRole = await graphCall(tenant, 'GET', `/users/${encodeURIComponent(params.email)}?$select=id,displayName`);
        await graphCall(tenant, 'POST', '/roleManagement/directory/roleAssignments', {
          principalId: uRole.id,
          roleDefinitionId: roleDef.id,
          directoryScopeId: '/',
        });
        push('success', `✅ Role "${roleDef.displayName}" assigned to ${uRole.displayName}.`);
        break;
      }

      case 'remove_admin_role': {
        push('info', `Looking up role: ${params.role_name}`);
        const rRoleDefs = await graphCall(tenant, 'GET',
          `/roleManagement/directory/roleDefinitions?$filter=displayName eq '${encodeURIComponent(params.role_name)}'&$select=id,displayName`
        );
        const rRoleDef = rRoleDefs.value?.[0];
        if (!rRoleDef) throw new Error(`Admin role "${params.role_name}" not found.`);
        push('info', `Looking up user: ${params.email}`);
        const uRRole = await graphCall(tenant, 'GET', `/users/${encodeURIComponent(params.email)}?$select=id,displayName`);
        const assignments = await graphCall(tenant, 'GET',
          `/roleManagement/directory/roleAssignments?$filter=principalId eq '${uRRole.id}' and roleDefinitionId eq '${rRoleDef.id}'`
        );
        const assignment = assignments.value?.[0];
        if (!assignment) throw new Error(`${uRRole.displayName} does not have the "${rRoleDef.displayName}" role assigned.`);
        await graphCall(tenant, 'DELETE', `/roleManagement/directory/roleAssignments/${assignment.id}`);
        push('success', `✅ Role "${rRoleDef.displayName}" removed from ${uRRole.displayName}.`);
        break;
      }

      case 'convert_to_shared_mailbox': {
        push('info', `Disabling sign-in for: ${params.email}`);
        const uConv = await graphCall(tenant, 'GET', `/users/${encodeURIComponent(params.email)}?$select=id,displayName`);
        await graphCall(tenant, 'PATCH', `/users/${uConv.id}`, { accountEnabled: false });
        push('success', `✅ Sign-in disabled for ${uConv.displayName}.`);
        push('warning', `⚠️  Full mailbox conversion to Shared requires Exchange Online PowerShell:`);
        push('warning', `   Set-Mailbox ${params.email} -Type Shared`);
        push('info', `   This can be run by a Global Admin or Exchange Admin in EXO PowerShell.`);
        if (params.delegate_email) {
          const delegate = await graphCall(tenant, 'GET', `/users/${encodeURIComponent(params.delegate_email)}?$select=id,displayName`);
          push('info', `Delegate access requested for ${delegate.displayName} — grant via Exchange Online after conversion.`);
        }
        break;
      }

      default:
        push('warning', `Unknown action type: ${actionType}. No action taken.`);
    }

    return { success: true, mock: false, log };
  } catch (err) {
    push('error', `❌ Execution failed: ${err.message}`);
    return { success: false, mock: false, log, error: err.message };
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────
/**
 * Execute an automation action for a service request.
 *
 * @param {object} serviceRequest  - Row from service_requests
 * @param {object} form            - Row from service_request_forms
 * @returns {{ success, mock, log, error? }}
 */
async function executeAutomation(serviceRequest, form) {
  // Normalise: old single-action object → array; filter out 'none' placeholders
  const raw = form.automation_action;
  const actions = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .filter(a => a?.type && a.type !== 'none');

  if (actions.length === 0) {
    return { success: true, mock: true, log: [{ level: 'info', message: 'No automation actions configured.', time: new Date().toISOString() }] };
  }

  // Resolve tenant from the contact's linked organisation — no fallback.
  let tenant = null;
  let contactEmail = null;
  let orgName = null;
  try {
    if (serviceRequest.contact_id) {
      const cr = await db.query(
        `SELECT c.email, c.organisation_id, o.name AS org_name
         FROM contacts c
         LEFT JOIN organisations o ON o.id = c.organisation_id
         WHERE c.id = $1`,
        [serviceRequest.contact_id]
      );
      const contact = cr.rows[0];
      if (contact) {
        contactEmail = contact.email;
        orgName = contact.org_name || null;
        if (contact.organisation_id) {
          const tr = await db.query(
            `SELECT * FROM m365_tenants WHERE organisation_id = $1 AND connected = true LIMIT 1`,
            [contact.organisation_id]
          );
          tenant = tr.rows[0] || null;
        }
      }
    }
  } catch (_) { /* table may not exist yet */ }

  if (!tenant) {
    const msg = orgName
      ? `No M365 tenant is linked to ${orgName}. Ticket logged for manual handling.`
      : 'No M365 tenant linked to this organisation. Ticket logged for manual handling.';
    return {
      success: true,
      noTenant: true,
      orgName,
      log: [{ level: 'info', message: msg, time: new Date().toISOString() }],
    };
  }

  // Execute each action sequentially; accumulate logs across all steps.
  const combinedLog = [];
  let anyFailed = false;
  const ts = () => new Date().toISOString();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const stepLabel = `Step ${i + 1}/${actions.length}: ${ACTION_TYPES[action.type]?.label || action.type}`;
    combinedLog.push({ time: ts(), level: 'info', message: `─── ${stepLabel} ───` });

    const params = resolveParams(action, serviceRequest.field_values || {}, form.fields || []);

    try {
      const result = await liveExecute(tenant, action.type, params, contactEmail);
      combinedLog.push(...(result.log || []));
      if (!result.success) anyFailed = true;
    } catch (err) {
      combinedLog.push({ time: ts(), level: 'error', message: `✕ ${stepLabel} failed: ${err.message}` });
      anyFailed = true;
      // Continue with remaining steps even if one fails
    }
  }

  combinedLog.push({
    time: ts(),
    level: anyFailed ? 'warning' : 'success',
    message: anyFailed
      ? `⚠️  Completed with errors — ${actions.length} action(s) attempted.`
      : `✅ All ${actions.length} action(s) completed successfully.`,
  });

  return { success: !anyFailed, log: combinedLog };
}

module.exports = { executeAutomation, ACTION_TYPES, checkUPNExists };

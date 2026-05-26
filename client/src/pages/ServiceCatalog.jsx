import { useEffect, useState, useRef } from 'react'
import { apiFetch } from '../utils/api'
import styles from './ServiceCatalog.module.css'
import ConfirmModal from '../components/ConfirmModal'

// M365 automation action definitions (mirrors server/graphExecutor.js)
const ACTION_TYPES = {
  none:                    { label: 'No automation',                params: [] },
  create_user:             { label: 'Create Entra ID User',         params: [
    { key: 'first_name',    label: 'First Name',        required: true  },
    { key: 'last_name',     label: 'Last Name',         required: true  },
    { key: 'email',         label: 'Email / UPN',       required: true  },
    { key: 'display_name',  label: 'Display Name',      required: false },
    { key: 'job_title',     label: 'Job Title',         required: false },
    { key: 'department',    label: 'Department',        required: false },
    { key: 'license_sku',   label: 'License SKU',       required: false },
  ]},
  reset_password:          { label: 'Reset User Password',          params: [
    { key: 'email', label: 'User Email / UPN', required: true },
  ]},
  add_mailbox_permission:  { label: 'Add Mailbox Permission',       params: [
    { key: 'mailbox_email',   label: 'Mailbox Email',                       required: true  },
    { key: 'user_email',      label: 'Grant Access To (email)',              required: true  },
    { key: 'permission_type', label: 'Permission (FullAccess / SendAs / SendOnBehalf)', required: true },
  ]},
  remove_mailbox_permission: { label: 'Remove Mailbox Permission',  params: [
    { key: 'mailbox_email',   label: 'Mailbox Email',              required: true  },
    { key: 'user_email',      label: 'Remove Access From (email)', required: true  },
    { key: 'permission_type', label: 'Permission Type',            required: true  },
  ]},
  create_shared_mailbox:   { label: 'Create Shared Mailbox',        params: [
    { key: 'display_name', label: 'Display Name', required: true },
    { key: 'email',        label: 'Email Address', required: true },
  ]},
  add_to_group:            { label: 'Add User to M365 Group / Team', params: [
    { key: 'user_email', label: 'User Email',         required: true },
    { key: 'group_name', label: 'Group or Team Name', required: true },
  ]},
  remove_from_group:       { label: 'Remove User from Group / Team', params: [
    { key: 'user_email', label: 'User Email',         required: true },
    { key: 'group_name', label: 'Group or Team Name', required: true },
  ]},
  disable_account:         { label: 'Disable User Account',          params: [
    { key: 'email', label: 'User Email / UPN', required: true },
  ]},
  enable_account:          { label: 'Enable User Account',           params: [
    { key: 'email', label: 'User Email / UPN', required: true },
  ]},
  assign_license:          { label: 'Assign M365 License',            params: [
    { key: 'email',       label: 'User Email / UPN',            required: true  },
    { key: 'license_sku', label: 'License SKU',                 required: true  },
  ]},
  remove_license:          { label: 'Remove M365 License',            params: [
    { key: 'email',       label: 'User Email / UPN',            required: true  },
    { key: 'license_sku', label: 'License SKU to Remove',       required: true  },
  ]},
  update_user:             { label: 'Update User Profile',            params: [
    { key: 'email',           label: 'User Email / UPN',    required: true  },
    { key: 'job_title',       label: 'Job Title',           required: false },
    { key: 'department',      label: 'Department',          required: false },
    { key: 'office_location', label: 'Office Location',     required: false },
    { key: 'mobile_phone',    label: 'Mobile Phone',        required: false },
    { key: 'manager_email',   label: 'Manager Email / UPN', required: false },
  ]},
  reset_mfa:               { label: 'Reset MFA Methods',              params: [
    { key: 'email', label: 'User Email / UPN', required: true },
  ]},
  invite_guest:            { label: 'Invite Guest User (B2B)',         params: [
    { key: 'guest_email', label: 'Guest Email Address', required: true  },
    { key: 'guest_name',  label: 'Guest Display Name',  required: true  },
    { key: 'message',     label: 'Personal Message',    required: false },
  ]},
  add_email_alias:         { label: 'Add Email Alias',                 params: [
    { key: 'email', label: 'User Email / UPN',    required: true },
    { key: 'alias', label: 'Alias Email Address', required: true },
  ]},
  set_out_of_office:       { label: 'Set Out of Office / Auto-Reply',  params: [
    { key: 'email',      label: 'User Email / UPN',       required: true  },
    { key: 'message',    label: 'Auto-Reply Message',      required: true  },
    { key: 'start_date', label: 'Start Date (YYYY-MM-DD)', required: false },
    { key: 'end_date',   label: 'End Date (YYYY-MM-DD)',   required: false },
  ]},
  create_security_group:   { label: 'Create Security Group',           params: [
    { key: 'group_name',  label: 'Group Name',  required: true  },
    { key: 'description', label: 'Description', required: false },
  ]},
  assign_admin_role:       { label: 'Assign Admin Role',               params: [
    { key: 'email',     label: 'User Email / UPN', required: true },
    { key: 'role_name', label: 'Admin Role',        required: true },
  ]},
  remove_admin_role:       { label: 'Remove Admin Role',               params: [
    { key: 'email',     label: 'User Email / UPN', required: true },
    { key: 'role_name', label: 'Admin Role',        required: true },
  ]},
  convert_to_shared_mailbox: { label: 'Convert Mailbox to Shared',     params: [
    { key: 'email',          label: 'User Email / UPN',          required: true  },
    { key: 'delegate_email', label: 'Grant Access To (optional)', required: false },
  ]},
}

// ── Template helpers ──────────────────────────────────────────────────────────
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

function tf(type, id, label, opts = {}) {
  return {
    id, type, label,
    placeholder: opts.placeholder || '',
    helpText: opts.helpText || '',
    required: opts.required || false,
    layout: opts.layout || 'full',
    validation: { type: 'none', pattern: '', message: '' },
    options: opts.options || [],
    multi: opts.multi || false,
  }
}

const ADMIN_ROLES = [
  'Helpdesk Administrator',
  'License Administrator',
  'Groups Administrator',
  'User Administrator',
  'Exchange Administrator',
  'Teams Administrator',
  'SharePoint Administrator',
  'Security Administrator',
  'Compliance Administrator',
  'Password Administrator',
  'Global Administrator',
]

const LICENSE_SKUS = [
  { label: 'Microsoft 365 Business Basic',    value: 'O365_BUSINESS_ESSENTIALS' },
  { label: 'Microsoft 365 Business Standard', value: 'O365_BUSINESS_PREMIUM' },
  { label: 'Microsoft 365 Business Premium',  value: 'SPB' },
  { label: 'Microsoft 365 E3',                value: 'SPE_E3' },
  { label: 'Microsoft 365 E5',                value: 'SPE_E5' },
  { label: 'Microsoft Teams Essentials',      value: 'TEAMS_ESSENTIALS' },
  { label: 'Exchange Online Plan 1',          value: 'EXCHANGESTANDARD' },
  { label: 'Exchange Online Plan 2',          value: 'EXCHANGEENTERPRISE' },
]

const TEMPLATES = [
  {
    key: 'add_email_alias', icon: '📮', name: 'Add Email Alias',
    description: 'Add an additional email address (alias) to an existing staff member\'s mailbox.',
    tag: 'Add Email Alias',
    build: () => {
      const f = { email: uid(), alias: uid(), reason: uid() }
      return {
        name: 'Add Email Alias', icon: '📮', category: 'access_permissions',
        description: 'Add an alternate email address to a staff member\'s mailbox.',
        ticket_priority: 'low', ticket_category: 'access_permissions',
        ticket_subject_template: 'Add Email Alias — {{Staff Member}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the user to add an alias for' }),
          tf('text', f.alias, 'Alias Email Address', { required: true, placeholder: 'e.g. j.smith@yourdomain.com', helpText: 'The additional email address to add' }),
          tf('textarea', f.reason, 'Reason', { placeholder: 'e.g. Name change, role alias…' }),
        ],
        automation_action: { type: 'add_email_alias', field_map: { email: f.email, alias: f.alias }, fixed_values: {} },
      }
    },
  },
  {
    key: 'add_to_group', icon: '👥', name: 'Add Users to Group / Team',
    description: 'Add one or more staff members to an M365 Group or Teams channel.',
    tag: 'Add User to M365 Group',
    build: () => {
      const f = { group_name: uid(), users: uid(), notes: uid() }
      return {
        name: 'Add Users to Group / Team', icon: '👥', category: 'access_permissions',
        description: 'Add staff members to an M365 Group or Microsoft Teams channel.',
        ticket_priority: 'medium', ticket_category: 'access_permissions',
        ticket_subject_template: 'Add to Group — {{Group or Team Name}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('group_picker', f.group_name, 'Group or Team', { required: true, helpText: 'Select from your Entra ID groups and Teams' }),
          tf('user_picker', f.users, 'Users to Add', { required: true, multi: true, helpText: 'Select one or more staff members to add' }),
          tf('textarea', f.notes, 'Notes', { placeholder: 'Any additional context…' }),
        ],
        automation_action: { type: 'add_to_group', field_map: { group_name: f.group_name, user_email: f.users }, fixed_values: {} },
      }
    },
  },
  {
    key: 'assign_admin_role', icon: '🛡️', name: 'Assign Admin Role',
    description: 'Grant a staff member an administrative role in Entra ID / Microsoft 365.',
    tag: 'Assign Admin Role',
    build: () => {
      const f = { email: uid(), role: uid(), reason: uid() }
      return {
        name: 'Assign Admin Role', icon: '🛡️', category: 'access_permissions',
        description: 'Assign an Entra ID administrative role to a staff member.',
        ticket_priority: 'high', ticket_category: 'access_permissions',
        ticket_subject_template: 'Assign Admin Role — {{Staff Member}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the user to receive the admin role' }),
          tf('select', f.role, 'Admin Role', { required: true, options: ADMIN_ROLES.map(r => ({ label: r })), helpText: 'Select the role to assign. Global Administrator grants full tenant access.' }),
          tf('textarea', f.reason, 'Justification', { required: true, placeholder: 'Why does this person require admin access?' }),
        ],
        automation_action: { type: 'assign_admin_role', field_map: { email: f.email, role_name: f.role }, fixed_values: {} },
      }
    },
  },
  {
    key: 'assign_license', icon: '🪪', name: 'Assign M365 License',
    description: 'Assign a Microsoft 365 license to a staff member — for new accounts or upgrading an existing user.',
    tag: 'Assign M365 License',
    build: () => {
      const f = { email: uid(), license: uid(), notes: uid() }
      return {
        name: 'Assign M365 License', icon: '🪪', category: 'account_management',
        description: 'Assign a Microsoft 365 license to a staff member.',
        ticket_priority: 'medium', ticket_category: 'account_management',
        ticket_subject_template: 'Assign License — {{Staff Member}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the user to assign a license to' }),
          tf('select', f.license, 'License', { required: true, options: LICENSE_SKUS, helpText: 'Select the license to assign. SKU names may vary — check your M365 admin centre if unsure.' }),
          tf('textarea', f.notes, 'Notes', { placeholder: 'Any additional context…' }),
        ],
        automation_action: { type: 'assign_license', field_map: { email: f.email, license_sku: f.license }, fixed_values: {} },
      }
    },
  },
  {
    key: 'convert_to_shared_mailbox', icon: '🔄', name: 'Convert Mailbox to Shared',
    description: 'Convert a departing staff member\'s mailbox to a shared mailbox so the team can retain access.',
    tag: 'Convert Mailbox to Shared',
    build: () => {
      const f = { email: uid(), delegate: uid(), reason: uid() }
      return {
        name: 'Convert Mailbox to Shared', icon: '🔄', category: 'access_permissions',
        description: 'Convert a user mailbox to a shared mailbox and optionally delegate access.',
        ticket_priority: 'medium', ticket_category: 'access_permissions',
        ticket_subject_template: 'Convert Mailbox — {{Staff Member}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'The user whose mailbox should be converted to shared' }),
          tf('user_picker', f.delegate, 'Delegate Access To', { helpText: 'Optionally grant a team member access to the shared mailbox after conversion' }),
          tf('textarea', f.reason, 'Reason', { required: true, placeholder: 'e.g. Staff member has left, team needs to retain email access…' }),
        ],
        automation_action: { type: 'convert_to_shared_mailbox', field_map: { email: f.email, delegate_email: f.delegate }, fixed_values: {} },
      }
    },
  },
  {
    key: 'create_security_group', icon: '🔐', name: 'Create Security Group',
    description: 'Create a new Entra ID security group for access control, conditional access policies or app assignments.',
    tag: 'Create Security Group',
    build: () => {
      const f = { name: uid(), description: uid(), owner: uid() }
      return {
        name: 'Create Security Group', icon: '🔐', category: 'access_permissions',
        description: 'Create a new Entra ID security group.',
        ticket_priority: 'medium', ticket_category: 'access_permissions',
        ticket_subject_template: 'New Security Group — {{Group Name}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('text', f.name, 'Group Name', { required: true, placeholder: 'e.g. VPN Access — Auckland Office', helpText: 'Use a clear, descriptive name that explains the group\'s purpose' }),
          tf('textarea', f.description, 'Purpose / Description', { required: true, placeholder: 'What will this group be used for? Which resources will it control access to?' }),
          tf('user_picker', f.owner, 'Group Owner', { helpText: 'Optionally assign an owner who will manage membership' }),
        ],
        automation_action: { type: 'create_security_group', field_map: { group_name: f.name, description: f.description }, fixed_values: {} },
      }
    },
  },
  {
    key: 'create_shared_mailbox', icon: '📧', name: 'Create Shared Mailbox',
    description: 'Create a new shared mailbox in Exchange Online for a team or department.',
    tag: 'Create Shared Mailbox',
    build: () => {
      const f = { display_name: uid(), email: uid(), purpose: uid() }
      return {
        name: 'Create Shared Mailbox', icon: '📧', category: 'access_permissions',
        description: 'Request a new shared mailbox for a team, department or function.',
        ticket_priority: 'medium', ticket_category: 'access_permissions',
        ticket_subject_template: 'New Shared Mailbox — {{Mailbox Name}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('text', f.display_name, 'Mailbox Name', { required: true, layout: 'half', placeholder: 'e.g. Accounts Team', helpText: 'Display name shown in Outlook' }),
          tf('text', f.email, 'Email Address', { required: true, layout: 'half', placeholder: 'accounts@yourdomain.com' }),
          tf('textarea', f.purpose, 'Purpose / Description', { placeholder: 'What will this mailbox be used for?' }),
        ],
        automation_action: { type: 'create_shared_mailbox', field_map: { display_name: f.display_name, email: f.email }, fixed_values: {} },
      }
    },
  },
  {
    key: 'disable_account', icon: '🚫', name: 'Disable User Account',
    description: 'Disable an Entra ID account when a staff member leaves or goes on extended leave.',
    tag: 'Disable User Account',
    build: () => {
      const f = { email: uid(), last_day: uid(), reason: uid() }
      return {
        name: 'Disable User Account', icon: '🚫', category: 'account_management',
        description: 'Disable an Entra ID account for a departing or inactive staff member.',
        ticket_priority: 'high', ticket_category: 'account_management',
        ticket_subject_template: 'Disable Account — {{Staff Member}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the account to disable' }),
          tf('date', f.last_day, 'Last Working Day', { required: true, layout: 'half' }),
          tf('textarea', f.reason, 'Reason', { required: true, placeholder: 'e.g. Resignation, termination, extended leave…' }),
        ],
        automation_action: { type: 'disable_account', field_map: { email: f.email }, fixed_values: {} },
      }
    },
  },
  {
    key: 'add_mailbox_permission', icon: '📬', name: 'Grant Mailbox Access',
    description: 'Give a staff member FullAccess, SendAs or SendOnBehalf permissions to a shared or delegated mailbox.',
    tag: 'Add Mailbox Permission',
    build: () => {
      const f = { mailbox: uid(), user: uid(), permission: uid() }
      return {
        name: 'Grant Mailbox Access', icon: '📬', category: 'access_permissions',
        description: 'Grant a staff member access to a shared or delegated mailbox.',
        ticket_priority: 'medium', ticket_category: 'access_permissions',
        ticket_subject_template: 'Mailbox Access — {{Mailbox Email}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.mailbox, 'Mailbox', { required: true, helpText: 'Select the shared mailbox to grant access to' }),
          tf('user_picker', f.user, 'Grant Access To', { required: true, helpText: 'Select the staff member to receive access' }),
          tf('select', f.permission, 'What level of access do they need?', { required: true, options: [
            { label: 'Full Access — can read, manage and delete all mail in the mailbox', value: 'FullAccess' },
            { label: 'Send As — emails they send will appear to come from this mailbox', value: 'SendAs' },
            { label: 'Send On Behalf — emails show as sent on behalf of this mailbox', value: 'SendOnBehalf' },
          ]}),
        ],
        automation_action: { type: 'add_mailbox_permission', field_map: { mailbox_email: f.mailbox, user_email: f.user, permission_type: f.permission }, fixed_values: {} },
      }
    },
  },
  {
    key: 'invite_guest', icon: '🤝', name: 'Invite Guest User',
    description: 'Send a B2B guest invitation to an external collaborator so they can access your M365 environment.',
    tag: 'Invite Guest User (B2B)',
    build: () => {
      const f = { guest_email: uid(), guest_name: uid(), message: uid(), reason: uid() }
      return {
        name: 'Invite Guest User', icon: '🤝', category: 'access_permissions',
        description: 'Send a B2B guest invitation to an external collaborator.',
        ticket_priority: 'medium', ticket_category: 'access_permissions',
        ticket_subject_template: 'Guest Invitation — {{Guest Name}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('text', f.guest_name, 'Guest Name', { required: true, layout: 'half', placeholder: 'e.g. Jane Smith' }),
          tf('text', f.guest_email, 'Guest Email Address', { required: true, layout: 'half', placeholder: 'e.g. jane@externalcompany.com', helpText: 'Must be a valid external email address' }),
          tf('textarea', f.message, 'Personal Message', { placeholder: 'Optional welcome message to include in the invitation email…' }),
          tf('textarea', f.reason, 'Business Justification', { required: true, placeholder: 'Why does this person need access? Which resources will they use?' }),
        ],
        automation_action: { type: 'invite_guest', field_map: { guest_email: f.guest_email, guest_name: f.guest_name, message: f.message }, fixed_values: {} },
      }
    },
  },
  {
    key: 'new_staff', icon: '🧑‍💼', name: 'New Staff Member',
    description: 'Onboard a new staff member with an Entra ID account. Email is auto-generated from the submitter\'s organisation domain.',
    tag: 'Create Entra ID User',
    build: () => {
      const f = { fn: uid(), ln: uid(), jt: uid(), dept: uid(), sd: uid(), email: uid(), notes: uid() }
      return {
        name: 'New Staff Member', icon: '🧑‍💼', category: 'account_management',
        description: 'Request a new Entra ID user account for an incoming staff member.',
        ticket_priority: 'medium', ticket_category: 'account_management',
        ticket_subject_template: 'New Staff Account — {{First Name}} {{Last Name}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('text', f.fn, 'First Name', { required: true, layout: 'half', placeholder: 'e.g. Jane' }),
          tf('text', f.ln, 'Last Name',  { required: true, layout: 'half', placeholder: 'e.g. Smith' }),
          tf('text', f.jt, 'Job Title',  { layout: 'half', placeholder: 'e.g. Support Coordinator' }),
          tf('text', f.dept, 'Department', { layout: 'half', placeholder: 'e.g. Operations' }),
          tf('date', f.sd, 'Start Date', { required: true, layout: 'half' }),
          tf('text', f.email, 'Email Address', { layout: 'half', placeholder: 'Leave blank to auto-generate', helpText: 'Leave blank to auto-create as firstname@yourdomain' }),
          tf('textarea', f.notes, 'Additional Notes', { placeholder: 'Any extra details for the IT team…' }),
        ],
        automation_action: { type: 'create_user', field_map: { first_name: f.fn, last_name: f.ln, job_title: f.jt, department: f.dept, email: f.email }, fixed_values: {} },
      }
    },
  },
  {
    key: 'password_reset', icon: '🔑', name: 'Password Reset',
    description: 'Reset an Entra ID user\'s password. A temporary password is generated and the user must change it on next sign-in.',
    tag: 'Reset User Password',
    build: () => {
      const f = { email: uid(), reason: uid() }
      return {
        name: 'Password Reset', icon: '🔑', category: 'account_management',
        description: 'Reset an Entra ID account password for a locked-out or forgotten-password request.',
        ticket_priority: 'high', ticket_category: 'account_management',
        ticket_subject_template: 'Password Reset — {{Staff Member}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the user who needs their password reset' }),
          tf('textarea', f.reason, 'Reason', { required: true, placeholder: 'e.g. Forgot password, account locked out…' }),
        ],
        automation_action: { type: 'reset_password', field_map: { email: f.email }, fixed_values: {} },
      }
    },
  },
  {
    key: 'enable_account', icon: '✅', name: 'Reactivate User Account',
    description: 'Re-enable a previously disabled Entra ID account for a returning staff member.',
    tag: 'Enable User Account',
    build: () => {
      const f = { email: uid(), reason: uid() }
      return {
        name: 'Reactivate User Account', icon: '✅', category: 'account_management',
        description: 'Re-enable a previously disabled Entra ID account.',
        ticket_priority: 'medium', ticket_category: 'account_management',
        ticket_subject_template: 'Reactivate Account — {{Staff Member}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the account to reactivate' }),
          tf('textarea', f.reason, 'Reason', { required: true, placeholder: 'e.g. Returning from leave, contract renewed…' }),
        ],
        automation_action: { type: 'enable_account', field_map: { email: f.email }, fixed_values: {} },
      }
    },
  },
  {
    key: 'remove_admin_role', icon: '🛡️', name: 'Remove Admin Role',
    description: 'Remove an administrative role from a staff member in Entra ID / Microsoft 365.',
    tag: 'Remove Admin Role',
    build: () => {
      const f = { email: uid(), role: uid(), reason: uid() }
      return {
        name: 'Remove Admin Role', icon: '🛡️', category: 'access_permissions',
        description: 'Remove an Entra ID administrative role from a staff member.',
        ticket_priority: 'high', ticket_category: 'access_permissions',
        ticket_subject_template: 'Remove Admin Role — {{Staff Member}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the user to remove the admin role from' }),
          tf('select', f.role, 'Admin Role to Remove', { required: true, options: ADMIN_ROLES.map(r => ({ label: r })) }),
          tf('textarea', f.reason, 'Reason', { required: true, placeholder: 'e.g. Role change, no longer requires admin access…' }),
        ],
        automation_action: { type: 'remove_admin_role', field_map: { email: f.email, role_name: f.role }, fixed_values: {} },
      }
    },
  },
  {
    key: 'remove_license', icon: '🪪', name: 'Remove M365 License',
    description: 'Remove a Microsoft 365 license from a staff member — for departing staff or cost management.',
    tag: 'Remove M365 License',
    build: () => {
      const f = { email: uid(), license: uid(), reason: uid() }
      return {
        name: 'Remove M365 License', icon: '🪪', category: 'account_management',
        description: 'Remove a Microsoft 365 license from a staff member.',
        ticket_priority: 'medium', ticket_category: 'account_management',
        ticket_subject_template: 'Remove License — {{Staff Member}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the user to remove a license from' }),
          tf('select', f.license, 'License to Remove', { required: true, options: LICENSE_SKUS, helpText: 'Select the license to remove' }),
          tf('textarea', f.reason, 'Reason', { required: true, placeholder: 'e.g. Staff member left, downgrading plan…' }),
        ],
        automation_action: { type: 'remove_license', field_map: { email: f.email, license_sku: f.license }, fixed_values: {} },
      }
    },
  },
  {
    key: 'remove_mailbox_permission', icon: '🔓', name: 'Remove Mailbox Access',
    description: 'Revoke a staff member\'s access to a shared or delegated mailbox.',
    tag: 'Remove Mailbox Permission',
    build: () => {
      const f = { mailbox: uid(), user: uid(), permission: uid() }
      return {
        name: 'Remove Mailbox Access', icon: '🔓', category: 'access_permissions',
        description: 'Revoke a staff member\'s access to a shared or delegated mailbox.',
        ticket_priority: 'medium', ticket_category: 'access_permissions',
        ticket_subject_template: 'Remove Mailbox Access — {{Mailbox Email}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.mailbox, 'Mailbox', { required: true, helpText: 'Select the shared mailbox to remove access from' }),
          tf('user_picker', f.user, 'Remove Access From', { required: true, helpText: 'Select the staff member to remove' }),
          tf('select', f.permission, 'Which access should be removed?', { required: true, options: [
            { label: 'Full Access — read, manage and delete all mail', value: 'FullAccess' },
            { label: 'Send As — sending as the mailbox', value: 'SendAs' },
            { label: 'Send On Behalf — sending on behalf of the mailbox', value: 'SendOnBehalf' },
          ]}),
        ],
        automation_action: { type: 'remove_mailbox_permission', field_map: { mailbox_email: f.mailbox, user_email: f.user, permission_type: f.permission }, fixed_values: {} },
      }
    },
  },
  {
    key: 'remove_from_group', icon: '🚪', name: 'Remove Users from Group / Team',
    description: 'Remove one or more staff members from an M365 Group or Teams channel.',
    tag: 'Remove User from Group',
    build: () => {
      const f = { group_name: uid(), users: uid(), reason: uid() }
      return {
        name: 'Remove Users from Group / Team', icon: '🚪', category: 'access_permissions',
        description: 'Remove staff members from an M365 Group or Microsoft Teams channel.',
        ticket_priority: 'medium', ticket_category: 'access_permissions',
        ticket_subject_template: 'Remove from Group — {{Group or Team Name}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('group_picker', f.group_name, 'Group or Team', { required: true, helpText: 'Select from your Entra ID groups and Teams' }),
          tf('user_picker', f.users, 'Users to Remove', { required: true, multi: true, helpText: 'Select one or more staff members to remove' }),
          tf('textarea', f.reason, 'Reason', { placeholder: 'e.g. Role change, no longer requires access…' }),
        ],
        automation_action: { type: 'remove_from_group', field_map: { group_name: f.group_name, user_email: f.users }, fixed_values: {} },
      }
    },
  },
  {
    key: 'reset_mfa', icon: '📱', name: 'Reset MFA Methods',
    description: 'Clear all MFA authentication methods for a staff member so they can re-register — for new phones or locked-out accounts.',
    tag: 'Reset MFA Methods',
    build: () => {
      const f = { email: uid(), reason: uid() }
      return {
        name: 'Reset MFA Methods', icon: '📱', category: 'account_management',
        description: 'Remove all MFA methods so the staff member must re-register on next sign-in.',
        ticket_priority: 'high', ticket_category: 'account_management',
        ticket_subject_template: 'MFA Reset — {{Staff Member}}',
        requires_approval: true, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the user who needs MFA reset' }),
          tf('textarea', f.reason, 'Reason', { required: true, placeholder: 'e.g. New phone, lost device, unable to sign in…' }),
        ],
        automation_action: { type: 'reset_mfa', field_map: { email: f.email }, fixed_values: {} },
      }
    },
  },
  {
    key: 'set_out_of_office', icon: '🏖️', name: 'Set Out of Office',
    description: 'Configure an automatic email reply for a staff member who is away or on leave.',
    tag: 'Set Out of Office / Auto-Reply',
    build: () => {
      const f = { email: uid(), message: uid(), start: uid(), end: uid() }
      return {
        name: 'Set Out of Office', icon: '🏖️', category: 'account_management',
        description: 'Set an automatic out-of-office reply for a staff member.',
        ticket_priority: 'low', ticket_category: 'account_management',
        ticket_subject_template: 'Out of Office — {{Staff Member}}',
        requires_approval: false, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the user to configure auto-reply for' }),
          tf('date', f.start, 'Start Date', { required: true, layout: 'half' }),
          tf('date', f.end, 'End Date', { layout: 'half', helpText: 'Leave blank to keep active indefinitely' }),
          tf('textarea', f.message, 'Auto-Reply Message', { required: true, placeholder: 'e.g. I\'m out of office from [date] to [date]. For urgent matters please contact…' }),
        ],
        automation_action: { type: 'set_out_of_office', field_map: { email: f.email, message: f.message, start_date: f.start, end_date: f.end }, fixed_values: {} },
      }
    },
  },
  {
    key: 'update_user', icon: '✏️', name: 'Update User Profile',
    description: 'Update a staff member\'s job title, department, office location, phone number or manager in Entra ID.',
    tag: 'Update User Profile',
    build: () => {
      const f = { email: uid(), job_title: uid(), department: uid(), office: uid(), phone: uid(), manager: uid(), reason: uid() }
      return {
        name: 'Update User Profile', icon: '✏️', category: 'account_management',
        description: 'Update profile attributes for an existing Entra ID user.',
        ticket_priority: 'low', ticket_category: 'account_management',
        ticket_subject_template: 'Update Profile — {{Staff Member}}',
        requires_approval: false, enabled: true, sort_order: 0,
        fields: [
          tf('user_picker', f.email, 'Staff Member', { required: true, helpText: 'Select the user whose profile needs updating' }),
          tf('text', f.job_title, 'New Job Title', { layout: 'half', placeholder: 'Leave blank to keep unchanged' }),
          tf('text', f.department, 'New Department', { layout: 'half', placeholder: 'Leave blank to keep unchanged' }),
          tf('text', f.office, 'Office Location', { layout: 'half', placeholder: 'e.g. Auckland HQ' }),
          tf('text', f.phone, 'Mobile Phone', { layout: 'half', placeholder: 'e.g. +64 21 123 4567' }),
          tf('user_picker', f.manager, 'New Manager', { helpText: 'Select the new manager — leave blank to keep unchanged' }),
          tf('textarea', f.reason, 'Reason for Change', { required: true, placeholder: 'e.g. Promotion, internal transfer, name change…' }),
        ],
        automation_action: { type: 'update_user', field_map: { email: f.email, job_title: f.job_title, department: f.department, office_location: f.office, mobile_phone: f.phone, manager_email: f.manager }, fixed_values: {} },
      }
    },
  },
]

const ICONS = ['📋', '💻', '📧', '👤', '🔒', '🗂', '🖨', '📞', '🌐', '⚙️']
const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'access_permissions', label: 'Access & Permissions' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'software', label: 'Software' },
  { value: 'account_management', label: 'Account Management' },
  { value: 'network', label: 'Network' },
  { value: 'other', label: 'Other' },
]
const PRIORITIES = ['low', 'medium', 'high']
const TICKET_CATEGORIES = ['general', 'access_permissions', 'hardware', 'software', 'account_management', 'network', 'other']

const VALIDATION_TYPES = [
  { value: 'none',        label: 'None' },
  { value: 'email',       label: 'Email address',   pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',  message: 'Please enter a valid email address.' },
  { value: 'phone_nz',    label: 'NZ Phone number', pattern: '^(\\+64|0)[2-9]\\d{7,9}$',        message: 'Please enter a valid NZ phone number.' },
  { value: 'phone',       label: 'Phone number',    pattern: '^[\\+\\d\\s\\-\\(\\)]{7,20}$',    message: 'Please enter a valid phone number.' },
  { value: 'url',         label: 'URL',             pattern: '^https?:\\/\\/.+',                 message: 'Please enter a valid URL starting with http:// or https://.' },
  { value: 'postcode_nz', label: 'NZ Postcode',     pattern: '^\\d{4}$',                         message: 'Please enter a valid 4-digit NZ postcode.' },
  { value: 'custom',      label: 'Custom regex',    pattern: '',                                 message: '' },
]

const PALETTE_TYPES = [
  { type: 'text', label: 'Short Text', icon: '📝' },
  { type: 'textarea', label: 'Long Text', icon: '📄' },
  { type: 'checkbox', label: 'Checkbox', icon: '☑️' },
  { type: 'date', label: 'Date', icon: '📅' },
  { type: 'number', label: 'Number', icon: '🔢' },
  { type: 'select', label: 'Dropdown', icon: '🔽' },
  { type: 'radio', label: 'Radio Buttons', icon: '⚫' },
  { type: 'user_picker', label: 'User Picker (Entra)', icon: '👥' },
  { type: 'group_picker', label: 'Group Picker (Entra)', icon: '🏷️' },
]

function makeField(type) {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    type,
    label: PALETTE_TYPES.find(p => p.type === type)?.label || 'Field',
    placeholder: '',
    helpText: '',
    required: false,
    layout: 'full',
    validation: { type: 'none', pattern: '', message: '' },
    options: type === 'select' || type === 'radio' ? [{ label: 'Option 1' }] : [],
    multi: false,
  }
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── FormBuilder Modal ─────────────────────────────────────────────────────────
function FormBuilderModal({ form, onClose, onSave }) {
  const [name, setName] = useState(form?.name || '')
  const [description, setDescription] = useState(form?.description || '')
  const [icon, setIcon] = useState(form?.icon || '📋')
  const [category, setCategory] = useState(form?.category || 'general')
  const [fields, setFields] = useState(form?.fields || [])
  const [ticketPriority, setTicketPriority] = useState(form?.ticket_priority || 'medium')
  const [ticketCategory, setTicketCategory] = useState(form?.ticket_category || '')
  const [subjectTemplate, setSubjectTemplate] = useState(form?.ticket_subject_template || '')
  const [requiresApproval, setRequiresApproval] = useState(form?.requires_approval || false)
  const [automationAction, setAutomationAction] = useState(
    form?.automation_action || { type: 'none', field_map: {}, fixed_values: {} }
  )
  const [tenants, setTenants] = useState([])
  const [automationTenantId, setAutomationTenantId] = useState(form?.automation_tenant_id || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingFocus, setPendingFocus] = useState(null) // { fieldId, idx }

  // Load tenants for automation config
  useEffect(() => {
    apiFetch('/api/tenants').then(r => r.json()).then(d => setTenants(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // Auto-focus newly added options
  useEffect(() => {
    if (!pendingFocus) return
    const el = document.getElementById(`opt-${pendingFocus.fieldId}-${pendingFocus.idx}`)
    if (el) { el.focus(); el.select() }
    setPendingFocus(null)
  }, [pendingFocus, fields])

  // Drag state
  const dragSourceRef = useRef(null) // { source: 'palette'|'canvas', type?, index? }
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [canvasOver, setCanvasOver] = useState(false)

  function handlePaletteDragStart(e, type) {
    dragSourceRef.current = { source: 'palette', type }
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleFieldDragStart(e, index) {
    dragSourceRef.current = { source: 'canvas', index }
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleCanvasDragOver(e) {
    e.preventDefault()
    setCanvasOver(true)
  }

  function handleCanvasDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setCanvasOver(false)
      setDragOverIndex(null)
    }
  }

  function handleFieldDragOver(e, index) {
    e.preventDefault()
    e.stopPropagation()
    setDragOverIndex(index)
  }

  function handleCanvasDrop(e) {
    e.preventDefault()
    setCanvasOver(false)
    setDragOverIndex(null)
    const src = dragSourceRef.current
    if (!src) return

    if (src.source === 'palette') {
      setFields(prev => [...prev, makeField(src.type)])
    }
    dragSourceRef.current = null
  }

  function handleFieldDrop(e, dropIndex) {
    e.preventDefault()
    e.stopPropagation()
    setCanvasOver(false)
    setDragOverIndex(null)
    const src = dragSourceRef.current
    if (!src) return

    if (src.source === 'palette') {
      const newField = makeField(src.type)
      setFields(prev => {
        const next = [...prev]
        next.splice(dropIndex, 0, newField)
        return next
      })
    } else if (src.source === 'canvas' && src.index !== dropIndex) {
      setFields(prev => {
        const next = [...prev]
        const [moved] = next.splice(src.index, 1)
        const insertAt = src.index < dropIndex ? dropIndex - 1 : dropIndex
        next.splice(insertAt, 0, moved)
        return next
      })
    }
    dragSourceRef.current = null
  }

  function updateField(id, patch) {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  function deleteField(id) {
    setFields(prev => prev.filter(f => f.id !== id))
  }

  function addOption(fieldId) {
    setFields(prev => prev.map(f => f.id === fieldId
      ? { ...f, options: [...f.options, { label: `Option ${f.options.length + 1}` }] }
      : f
    ))
  }

  function updateOption(fieldId, optIdx, label) {
    setFields(prev => prev.map(f => {
      if (f.id !== fieldId) return f
      const options = f.options.map((o, i) => i === optIdx ? { label } : o)
      return { ...f, options }
    }))
  }

  function removeOption(fieldId, optIdx) {
    setFields(prev => prev.map(f => {
      if (f.id !== fieldId) return f
      return { ...f, options: f.options.filter((_, i) => i !== optIdx) }
    }))
  }

  async function handleSave() {
    if (!name.trim()) { setError('Form name is required.'); return }
    setSaving(true)
    setError('')
    try {
      const body = JSON.stringify({
        name, description, icon, category, fields,
        ticket_priority: ticketPriority,
        ticket_category: ticketCategory || null,
        ticket_subject_template: subjectTemplate || null,
        enabled: form?.enabled !== false,
        sort_order: form?.sort_order || 0,
        requires_approval: requiresApproval,
        automation_action: automationAction.type !== 'none' ? automationAction : null,
        automation_tenant_id: automationTenantId || null,
      })
      const url = form?.id ? `/api/service-catalog/${form.id}` : '/api/service-catalog'
      const method = form?.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed.'); return }
      onSave(data)
    } catch {
      setError('Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{form?.id ? 'Edit Form' : 'New Service Request Form'}</h2>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>

        <div className={styles.modalBody}>
          {/* Palette */}
          <div className={styles.palette}>
            <p className={styles.paletteTitle}>Add Fields</p>
            {PALETTE_TYPES.map(pt => (
              <div
                key={pt.type}
                className={styles.paletteItem}
                draggable
                onDragStart={e => handlePaletteDragStart(e, pt.type)}
                onClick={() => setFields(prev => [...prev, makeField(pt.type)])}
                title={`Click or drag to add ${pt.label}`}
              >
                <span>{pt.icon}</span>
                <span>{pt.label}</span>
              </div>
            ))}
          </div>

          {/* Canvas */}
          <div className={styles.canvas}>
            {/* Form metadata */}
            <div className={styles.canvasRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Form Name *</label>
                <input
                  className={styles.formInput}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. New Software Request"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Category</label>
                <select className={styles.formSelect} value={category} onChange={e => setCategory(e.target.value)}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            <div className={styles.canvasFullRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Description</label>
                <textarea className={styles.formTextarea} value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description shown on the catalog card" />
              </div>
            </div>

            <div className={styles.canvasFullRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Icon</label>
                <div className={styles.iconPicker}>
                  {ICONS.map(i => (
                    <button
                      key={i}
                      type="button"
                      className={`${styles.iconBtn} ${icon === i ? styles.iconBtnActive : ''}`}
                      onClick={() => setIcon(i)}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <hr className={styles.sectionDivider} />
            <p className={styles.sectionLabel}>Form Fields</p>

            <div
              className={`${styles.fieldsArea} ${canvasOver ? styles.fieldsAreaOver : ''}`}
              onDragOver={handleCanvasDragOver}
              onDragLeave={handleCanvasDragLeave}
              onDrop={handleCanvasDrop}
            >
              {fields.length === 0 && (
                <div className={styles.emptyFieldsHint}>
                  Click or drag fields from the left panel to add them here.
                </div>
              )}
              {fields.map((field, idx) => (
                <div
                  key={field.id}
                  className={`${styles.fieldCard} ${dragOverIndex === idx ? styles.fieldCardDragging : ''}`}
                  onDragOver={e => handleFieldDragOver(e, idx)}
                  onDrop={e => handleFieldDrop(e, idx)}
                >
                  <span
                    className={styles.dragHandle}
                    draggable
                    onDragStart={e => handleFieldDragStart(e, idx)}
                    title="Drag to reorder"
                  >
                    ⠿
                  </span>
                  <div className={styles.fieldCardBody}>
                    {/* Row 1: label | type badge | layout | required | delete */}
                    <div className={styles.fieldCardRow}>
                      <input
                        className={styles.fieldLabelInput}
                        value={field.label}
                        onChange={e => updateField(field.id, { label: e.target.value })}
                        placeholder="Field label"
                      />
                      <span className={styles.fieldTypeBadge}>
                        {PALETTE_TYPES.find(p => p.type === field.type)?.icon} {field.type}
                      </span>
                      <div className={styles.layoutToggle}>
                        <button type="button"
                          className={`${styles.layoutBtn} ${(field.layout || 'full') === 'full' ? styles.layoutBtnActive : ''}`}
                          onClick={() => updateField(field.id, { layout: 'full' })}
                          title="Full width">■ Full</button>
                        <button type="button"
                          className={`${styles.layoutBtn} ${field.layout === 'half' ? styles.layoutBtnActive : ''}`}
                          onClick={() => updateField(field.id, { layout: 'half' })}
                          title="Half width">▪▪ Half</button>
                      </div>
                      <label className={styles.requiredToggle}>
                        <input type="checkbox" checked={field.required}
                          onChange={e => updateField(field.id, { required: e.target.checked })} />
                        Req
                      </label>
                      <button type="button" className={styles.fieldDeleteBtn}
                        onClick={() => deleteField(field.id)} title="Remove">×</button>
                    </div>

                    {/* Row 2: placeholder + validation (text fields) */}
                    {(field.type === 'text' || field.type === 'textarea' || field.type === 'number') && (
                      <div className={styles.fieldCardRow}>
                        <input className={styles.fieldSmInput}
                          value={field.placeholder}
                          onChange={e => updateField(field.id, { placeholder: e.target.value })}
                          placeholder="Placeholder (optional)" />
                        <select className={styles.fieldSmSelect}
                          value={field.validation?.type || 'none'}
                          onChange={e => {
                            const vt = VALIDATION_TYPES.find(v => v.value === e.target.value)
                            updateField(field.id, { validation: {
                              type: e.target.value,
                              pattern: vt?.value !== 'custom' ? (vt?.pattern || '') : '',
                              message: vt?.value !== 'custom' ? (vt?.message || '') : '',
                            }})
                          }}>
                          {VALIDATION_TYPES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                        </select>
                      </div>
                    )}

                    {/* Row 3: custom regex pattern + error message */}
                    {(field.type === 'text' || field.type === 'textarea' || field.type === 'number') && field.validation?.type === 'custom' && (
                      <div className={styles.fieldCardRow}>
                        <input className={styles.fieldSmInput}
                          value={field.validation?.pattern || ''}
                          onChange={e => updateField(field.id, { validation: { ...field.validation, pattern: e.target.value } })}
                          placeholder="Regex, e.g. ^[A-Z]{3}\\d{4}$" />
                        <input className={styles.fieldSmInput}
                          value={field.validation?.message || ''}
                          onChange={e => updateField(field.id, { validation: { ...field.validation, message: e.target.value } })}
                          placeholder="Error message" />
                      </div>
                    )}

                    {/* Options list for select/radio */}
                    {(field.type === 'select' || field.type === 'radio') && (
                      <div className={styles.optionsList}>
                        {field.options.map((opt, oi) => (
                          <div key={oi} className={styles.optionRow}>
                            <input
                              id={`opt-${field.id}-${oi}`}
                              className={styles.optionInput}
                              value={opt.label}
                              onChange={e => updateOption(field.id, oi, e.target.value)}
                              placeholder={`Option ${oi + 1}`}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  addOption(field.id)
                                  setPendingFocus({ fieldId: field.id, idx: field.options.length })
                                }
                              }}
                            />
                            <button type="button" className={`${styles.btnXs} ${styles.btnXsDanger}`}
                              onClick={() => removeOption(field.id, oi)}>×</button>
                          </div>
                        ))}
                        <button type="button" className={styles.btnXs} onClick={() => {
                          addOption(field.id)
                          setPendingFocus({ fieldId: field.id, idx: field.options.length })
                        }}>
                          + Add option
                        </button>
                      </div>
                    )}

                    {/* User picker — multi toggle */}
                    {field.type === 'user_picker' && (
                      <div className={styles.fieldCardRow}>
                        <label className={styles.requiredToggle}>
                          <input type="checkbox" checked={field.multi || false}
                            onChange={e => updateField(field.id, { multi: e.target.checked })} />
                          Allow multiple selections
                        </label>
                        <span className={styles.userPickerNote}>Fetches live users from your connected Entra ID tenant</span>
                      </div>
                    )}

                    {/* Group picker — note */}
                    {field.type === 'group_picker' && (
                      <div className={styles.fieldCardRow}>
                        <span className={styles.userPickerNote}>Fetches live groups &amp; Teams from your connected Entra ID tenant — single select</span>
                      </div>
                    )}

                    {/* Help text — always last */}
                    <div className={styles.fieldCardRow}>
                      <input className={styles.fieldSmInput}
                        value={field.helpText}
                        onChange={e => updateField(field.id, { helpText: e.target.value })}
                        placeholder="Help text (optional)" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <hr className={styles.sectionDivider} />
            <p className={styles.sectionLabel}>Ticket Settings</p>

            <div className={styles.canvasRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Default Priority</label>
                <select className={styles.formSelect} value={ticketPriority} onChange={e => setTicketPriority(e.target.value)}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Ticket Category</label>
                <select className={styles.formSelect} value={ticketCategory} onChange={e => setTicketCategory(e.target.value)}>
                  <option value="">None</option>
                  {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </div>
            </div>

            <div className={styles.canvasFullRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Subject Template</label>
                <input
                  className={styles.formInput}
                  value={subjectTemplate}
                  onChange={e => setSubjectTemplate(e.target.value)}
                  placeholder="e.g. New request: {{Software Name}}"
                />
                <p className={styles.hintText}>Use {'{{Field Label}}'} to include field values in the subject.</p>
              </div>
            </div>

            <hr className={styles.sectionDivider} />
            <p className={styles.sectionLabel}>⚙️ M365 Automation</p>

            {/* Requires approval toggle */}
            <div className={styles.canvasFullRow} style={{ marginBottom: 12 }}>
              <label className={styles.approvalToggleRow}>
                <input
                  type="checkbox"
                  checked={requiresApproval}
                  onChange={e => setRequiresApproval(e.target.checked)}
                />
                <span>
                  <strong>Require admin approval before executing</strong>
                  <span className={styles.toggleHint}> — submission goes to Approval Queue; you review and click Approve to run the action.</span>
                </span>
              </label>
            </div>

            {/* Action type select */}
            <div className={styles.canvasRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Automation Action</label>
                <select
                  className={styles.formSelect}
                  value={automationAction.type}
                  onChange={e => setAutomationAction({ type: e.target.value, field_map: {}, fixed_values: {} })}
                >
                  {Object.entries(ACTION_TYPES).map(([key, def]) => (
                    <option key={key} value={key}>{def.label}</option>
                  ))}
                </select>
              </div>
              {tenants.length > 0 && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Execute on Tenant</label>
                  <select
                    className={styles.formSelect}
                    value={automationTenantId}
                    onChange={e => setAutomationTenantId(e.target.value)}
                  >
                    <option value="">First connected tenant</option>
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>{t.display_name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Parameter mapping — only when action selected */}
            {automationAction.type && automationAction.type !== 'none' && (
              <div className={styles.paramMapping}>
                <p className={styles.paramMappingTitle}>
                  Map form fields → action parameters
                </p>
                <p className={styles.paramMappingHint}>
                  For each parameter, choose a form field to use as the value, or enter a fixed value.
                </p>
                {ACTION_TYPES[automationAction.type]?.params.map(param => {
                  const mappedFieldId = automationAction.field_map?.[param.key] || ''
                  const fixedVal = automationAction.fixed_values?.[param.key] || ''
                  return (
                    <div key={param.key} className={styles.paramRow}>
                      <div className={styles.paramLabel}>
                        {param.label}
                        {param.required && <span className={styles.paramRequired}> *</span>}
                      </div>
                      <div className={styles.paramControls}>
                        <select
                          className={styles.paramSelect}
                          value={mappedFieldId}
                          onChange={e => setAutomationAction(prev => ({
                            ...prev,
                            field_map: { ...prev.field_map, [param.key]: e.target.value },
                          }))}
                        >
                          <option value="">— fixed value —</option>
                          {fields.map(f => (
                            <option key={f.id} value={f.id}>{f.label}</option>
                          ))}
                        </select>
                        {!mappedFieldId && (
                          <input
                            className={styles.paramFixed}
                            value={fixedVal}
                            onChange={e => setAutomationAction(prev => ({
                              ...prev,
                              fixed_values: { ...prev.fixed_values, [param.key]: e.target.value },
                            }))}
                            placeholder={`Fixed: ${param.label}`}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
                {tenants.length === 0 && (
                  <div className={styles.noTenantNote}>
                    🔌 No M365 tenant connected — actions will run in simulation mode.
                    <a href="/m365-tenants" target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6 }}>
                      Connect a tenant →
                    </a>
                  </div>
                )}
              </div>
            )}

            {error && <div style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: 8 }}>{error}</div>}
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Form'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Templates Modal ───────────────────────────────────────────────────────────
function TemplatesModal({ onClose, onImport }) {
  const [importing, setImporting] = useState(null)
  const [imported, setImported] = useState(new Set())
  const [error, setError] = useState('')

  async function handleImport(template) {
    setImporting(template.key)
    setError('')
    try {
      const data = template.build()
      const res = await apiFetch('/api/service-catalog', {
        method: 'POST',
        body: JSON.stringify({ ...data, automation_tenant_id: null }),
      })
      const saved = await res.json()
      if (!res.ok) { setError(saved.error || 'Import failed.'); return }
      setImported(prev => new Set([...prev, template.key]))
      onImport(saved)
    } catch {
      setError('Import failed. Please try again.')
    } finally {
      setImporting(null)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.templatesModal}>
        <div className={styles.modalHeader}>
          <div>
            <h2 className={styles.modalTitle}>M365 Templates</h2>
            <p className={styles.templatesSubtitle}>
              Pre-built Entra ID service request forms. All require approval by default — assign a tenant after importing.
            </p>
          </div>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.templatesGrid}>
          {TEMPLATES.map(t => (
            <div key={t.key} className={`${styles.templateCard} ${imported.has(t.key) ? styles.templateCardDone : ''}`}>
              <span className={styles.templateCardIcon}>{t.icon}</span>
              <div className={styles.templateCardBody}>
                <div className={styles.templateCardName}>{t.name}</div>
                <div className={styles.templateCardDesc}>{t.description}</div>
                <div className={styles.templateCardTag}>⚙️ {t.tag}</div>
              </div>
              <button
                className={`${styles.btnImport} ${imported.has(t.key) ? styles.btnImportDone : ''}`}
                onClick={() => !imported.has(t.key) && handleImport(t)}
                disabled={importing === t.key || imported.has(t.key)}
              >
                {importing === t.key ? 'Importing…' : imported.has(t.key) ? '✓ Imported' : 'Import'}
              </button>
            </div>
          ))}
        </div>
        {error && <p className={styles.templatesError}>{error}</p>}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ServiceCatalog() {
  const [forms, setForms] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('forms')
  const [editForm, setEditForm] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // form id to delete

  useEffect(() => {
    Promise.all([
      apiFetch('/api/service-catalog').then(r => r.json()),
      apiFetch('/api/service-catalog/submissions').then(r => r.json()),
    ]).then(([f, s]) => {
      setForms(Array.isArray(f) ? f : [])
      setSubmissions(Array.isArray(s) ? s : [])
    }).finally(() => setLoading(false))
  }, [])

  function openNew() {
    setEditForm({})
    setShowModal(true)
  }

  function openEdit(form) {
    setEditForm(form)
    setShowModal(true)
  }

  function handleSave(saved) {
    setForms(prev => {
      const exists = prev.find(f => f.id === saved.id)
      return exists ? prev.map(f => f.id === saved.id ? saved : f) : [...prev, saved]
    })
    setShowModal(false)
  }

  async function handleDelete(id) {
    await apiFetch(`/api/service-catalog/${id}`, { method: 'DELETE' })
    setForms(prev => prev.filter(f => f.id !== id))
  }

  async function handleToggle(id) {
    const res = await apiFetch(`/api/service-catalog/${id}/toggle`, { method: 'PATCH' })
    const data = await res.json()
    setForms(prev => prev.map(f => f.id === id ? data : f))
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Service Catalog</h1>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={() => setShowTemplates(true)}>⚡ Templates</button>
          <button className={styles.btnPrimary} onClick={openNew}>+ New Form</button>
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'forms' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('forms')}
        >
          Forms
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'submissions' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('submissions')}
        >
          Submissions
        </button>
      </div>

      {loading ? (
        <div className={styles.emptyState}>Loading…</div>
      ) : activeTab === 'forms' ? (
        forms.length === 0 ? (
          <div className={styles.emptyState}>No forms yet. Create one with "New Form".</div>
        ) : (
          <div className={styles.formsGrid}>
            {forms.map(f => (
              <div key={f.id} className={styles.formCard}>
                <div className={styles.formCardHeader}>
                  <span className={styles.formIcon}>{f.icon || '📋'}</span>
                  <div className={styles.formMeta}>
                    <p className={styles.formName}>{f.name}</p>
                    {f.description && <p className={styles.formDesc}>{f.description}</p>}
                  </div>
                </div>
                <div className={styles.formCardFooter}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={`${styles.badge} ${f.enabled ? styles.badgeEnabled : styles.badgeDisabled}`}>
                      {f.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <span className={styles.fieldCount}>
                      {Array.isArray(f.fields) ? f.fields.length : 0} fields
                    </span>
                    {f.automation_action?.type && f.automation_action.type !== 'none' && (
                      <span className={styles.automationBadge} title={`Auto: ${f.automation_action.type.replace(/_/g, ' ')}`}>
                        ⚙️ {f.automation_action.type.replace(/_/g, ' ')}
                      </span>
                    )}
                    {f.requires_approval && (
                      <span className={styles.approvalBadge}>⏳ Approval</span>
                    )}
                  </div>
                  <div className={styles.formCardActions}>
                    <button className={styles.btnIconSm} onClick={() => handleToggle(f.id)}>
                      {f.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button className={styles.btnIconSm} onClick={() => openEdit(f)}>Edit</button>
                    <button className={`${styles.btnIconSm} ${styles.btnDanger}`} onClick={() => setConfirmDelete(f.id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        submissions.length === 0 ? (
          <div className={styles.emptyState}>No submissions yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Form</th>
                <th>Ticket</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map(s => (
                <tr key={s.id}>
                  <td>{s.contact_name || '—'}</td>
                  <td>{s.form_name || '—'}</td>
                  <td>
                    {s.ticket_reference
                      ? <span className={styles.ticketRef}>{s.ticket_reference}</span>
                      : '—'}
                  </td>
                  <td>{s.ticket_status || '—'}</td>
                  <td>{formatDate(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {showModal && (
        <FormBuilderModal
          form={editForm}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}

      {showTemplates && (
        <TemplatesModal
          onClose={() => setShowTemplates(false)}
          onImport={saved => setForms(prev => [...prev, saved])}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete form?"
          message="This will permanently delete the form and all its configuration. Submitted requests already linked to tickets won't be affected."
          confirmLabel="Delete form"
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

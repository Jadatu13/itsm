/**
 * Idempotent schema migrations.
 *
 * Runs on every boot. Each step is independently idempotent (CREATE … IF NOT
 * EXISTS / ADD COLUMN IF NOT EXISTS) and individually wrapped, so a single
 * failure is reported with its step name and ABORTS startup (fail-loud) rather
 * than silently leaving a half-migrated schema. Steps are ordered by dependency
 * so the module is self-sufficient even against a completely empty database.
 */

const STEPS = [
  // ── Enum types ────────────────────────────────────────────────────────────
  ['types', `
    DO $$ BEGIN
      CREATE TYPE ticket_status AS ENUM ('open','in_progress','on_hold','resolved');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE ticket_priority AS ENUM ('low','medium','high');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `],

  // ── Core tables ─────────────────────────────────────────────────────────────
  ['organisations', `
    CREATE TABLE IF NOT EXISTS organisations (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`],

  ['organisation_domains', `
    CREATE TABLE IF NOT EXISTS organisation_domains (
      id              SERIAL PRIMARY KEY,
      organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      domain          VARCHAR NOT NULL UNIQUE
    )`],

  ['contacts', `
    CREATE TABLE IF NOT EXISTS contacts (
      id              SERIAL PRIMARY KEY,
      first_name      VARCHAR NOT NULL,
      last_name       VARCHAR NOT NULL,
      email           VARCHAR UNIQUE NOT NULL,
      organisation_id INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
      phone           VARCHAR,
      notes           TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )`],
  ['contacts.phone', `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone VARCHAR`],
  ['contacts.notes', `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notes TEXT`],

  ['agents', `
    CREATE TABLE IF NOT EXISTS agents (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR NOT NULL,
      email         VARCHAR UNIQUE NOT NULL,
      password_hash VARCHAR NOT NULL,
      role          VARCHAR NOT NULL DEFAULT 'agent',
      totp_secret   TEXT,
      totp_enabled  BOOLEAN DEFAULT false,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )`],
  ['agents.totp_secret',  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS totp_secret TEXT`],
  ['agents.totp_enabled', `ALTER TABLE agents ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false`],

  ['settings', `
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )`],

  ['tickets', `
    CREATE TABLE IF NOT EXISTS tickets (
      id          SERIAL PRIMARY KEY,
      reference   VARCHAR UNIQUE,
      subject     VARCHAR NOT NULL,
      description TEXT NOT NULL,
      status      ticket_status   NOT NULL DEFAULT 'open',
      priority    ticket_priority NOT NULL DEFAULT 'medium',
      contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      assigned_to INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      category    VARCHAR,
      source      VARCHAR DEFAULT 'manual',
      sla_due_at  TIMESTAMPTZ,
      sla_alerted BOOLEAN DEFAULT false,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )`],
  ['tickets.assigned_to', `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES agents(id) ON DELETE SET NULL`],
  ['tickets.category',    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category VARCHAR`],
  ['tickets.source',      `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual'`],
  ['tickets.sla_due_at',  `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ`],
  ['tickets.sla_alerted', `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_alerted BOOLEAN DEFAULT false`],

  // Reference auto-generation (AFTER INSERT so id exists)
  ['ticket_reference_trigger', `
    CREATE OR REPLACE FUNCTION generate_ticket_reference()
    RETURNS TRIGGER AS $fn$
    BEGIN
      UPDATE tickets SET reference = 'TKT-' || LPAD(NEW.id::TEXT, 4, '0') WHERE id = NEW.id;
      RETURN NULL;
    END;
    $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS set_ticket_reference ON tickets;
    CREATE TRIGGER set_ticket_reference AFTER INSERT ON tickets
      FOR EACH ROW EXECUTE FUNCTION generate_ticket_reference();
  `],

  ['ticket_replies', `
    CREATE TABLE IF NOT EXISTS ticket_replies (
      id             SERIAL PRIMARY KEY,
      ticket_id      INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      body           TEXT NOT NULL,
      is_agent_reply BOOLEAN DEFAULT false,
      is_internal    BOOLEAN DEFAULT false,
      sender_name    TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )`],
  ['ticket_replies.is_internal', `ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT false`],
  ['ticket_replies.sender_name', `ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS sender_name TEXT`],

  ['ticket_updated_at_trigger', `
    CREATE OR REPLACE FUNCTION update_ticket_updated_at()
    RETURNS TRIGGER AS $fn$
    BEGIN
      UPDATE tickets SET updated_at = NOW() WHERE id = NEW.ticket_id;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS ticket_reply_updates_ticket ON ticket_replies;
    CREATE TRIGGER ticket_reply_updates_ticket AFTER INSERT ON ticket_replies
      FOR EACH ROW EXECUTE FUNCTION update_ticket_updated_at();
  `],

  // ── Knowledge base ──────────────────────────────────────────────────────────
  ['kb_folders', `
    CREATE TABLE IF NOT EXISTS kb_folders (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      icon       TEXT DEFAULT '📁',
      sort_order INT  DEFAULT 0,
      parent_id  INT REFERENCES kb_folders(id) ON DELETE SET NULL,
      org_id     INT REFERENCES organisations(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`],
  ['kb_folders.parent_id', `ALTER TABLE kb_folders ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES kb_folders(id) ON DELETE SET NULL`],
  ['kb_folders.org_id',    `ALTER TABLE kb_folders ADD COLUMN IF NOT EXISTS org_id INT REFERENCES organisations(id) ON DELETE CASCADE`],

  ['kb_articles', `
    CREATE TABLE IF NOT EXISTS kb_articles (
      id         SERIAL PRIMARY KEY,
      title      TEXT NOT NULL,
      body       TEXT,
      folder_id  INT REFERENCES kb_folders(id) ON DELETE SET NULL,
      published  BOOLEAN DEFAULT false,
      visibility TEXT NOT NULL DEFAULT 'internal',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`],
  ['kb_articles.folder_id',  `ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS folder_id INT REFERENCES kb_folders(id) ON DELETE SET NULL`],
  ['kb_articles.visibility', `ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'`],

  ['canned_responses', `
    CREATE TABLE IF NOT EXISTS canned_responses (
      id         SERIAL PRIMARY KEY,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`],

  // ── Service catalog ─────────────────────────────────────────────────────────
  ['service_request_forms', `
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
      automation_action       JSONB,
      automation_tenant_id    INT,
      requires_approval       BOOLEAN DEFAULT false,
      enabled         BOOLEAN DEFAULT true,
      sort_order      INT DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )`],
  ['service_request_forms.automation_action',    `ALTER TABLE service_request_forms ADD COLUMN IF NOT EXISTS automation_action JSONB`],
  ['service_request_forms.automation_tenant_id', `ALTER TABLE service_request_forms ADD COLUMN IF NOT EXISTS automation_tenant_id INT`],
  ['service_request_forms.requires_approval',    `ALTER TABLE service_request_forms ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false`],

  ['service_requests', `
    CREATE TABLE IF NOT EXISTS service_requests (
      id              SERIAL PRIMARY KEY,
      form_id         INT REFERENCES service_request_forms(id) ON DELETE SET NULL,
      contact_id      INT REFERENCES contacts(id) ON DELETE SET NULL,
      ticket_id       INT REFERENCES tickets(id) ON DELETE SET NULL,
      form_name       TEXT,
      field_values    JSONB NOT NULL DEFAULT '{}',
      approval_status  TEXT DEFAULT 'not_required',
      approved_by      INT REFERENCES agents(id) ON DELETE SET NULL,
      approved_at      TIMESTAMPTZ,
      rejection_reason TEXT,
      execution_status TEXT,
      execution_log    JSONB,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )`],
  ['service_requests.approval_status',  `ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'not_required'`],
  ['service_requests.approved_by',      `ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS approved_by INT REFERENCES agents(id) ON DELETE SET NULL`],
  ['service_requests.approved_at',      `ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`],
  ['service_requests.rejection_reason', `ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT`],
  ['service_requests.execution_status', `ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS execution_status TEXT`],
  ['service_requests.execution_log',    `ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS execution_log JSONB`],

  ['automations', `
    CREATE TABLE IF NOT EXISTS automations (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      match_all    BOOLEAN DEFAULT true,
      conditions   JSONB NOT NULL DEFAULT '[]',
      actions      JSONB NOT NULL DEFAULT '[]',
      enabled      BOOLEAN DEFAULT true,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )`],

  ['portal_branding', `
    CREATE TABLE IF NOT EXISTS portal_branding (
      id              INT PRIMARY KEY DEFAULT 1,
      brand_name      TEXT,
      logo_url        TEXT,
      primary_color   TEXT,
      nav_bg          TEXT,
      nav_text        TEXT,
      nav_active_bg   TEXT,
      nav_active_text TEXT,
      page_bg         TEXT,
      button_bg       TEXT,
      button_text     TEXT,
      login_title     TEXT,
      login_subtitle  TEXT,
      footer_text     TEXT,
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )`],

  // ── M365 ────────────────────────────────────────────────────────────────────
  ['m365_tenants', `
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
      organisation_id  INT REFERENCES organisations(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )`],

  ['tenant_group_aliases', `
    CREATE TABLE IF NOT EXISTS tenant_group_aliases (
      id         SERIAL PRIMARY KEY,
      tenant_id  INT  NOT NULL REFERENCES m365_tenants(id) ON DELETE CASCADE,
      alias      TEXT NOT NULL,
      group_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (tenant_id, alias)
    )`],

  // ── Attachments, custom fields, time tracking ───────────────────────────────
  ['ticket_attachments', `
    CREATE TABLE IF NOT EXISTS ticket_attachments (
      id            SERIAL PRIMARY KEY,
      ticket_id     INT  REFERENCES tickets(id)        ON DELETE CASCADE,
      reply_id      INT  REFERENCES ticket_replies(id) ON DELETE SET NULL,
      filename      TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type     TEXT,
      size_bytes    INT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )`],

  ['ticket_custom_fields', `
    CREATE TABLE IF NOT EXISTS ticket_custom_fields (
      id         SERIAL PRIMARY KEY,
      label      TEXT NOT NULL,
      field_key  TEXT NOT NULL UNIQUE,
      field_type TEXT NOT NULL DEFAULT 'text',
      options    JSONB DEFAULT '[]',
      required   BOOLEAN DEFAULT false,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`],

  ['ticket_field_values', `
    CREATE TABLE IF NOT EXISTS ticket_field_values (
      ticket_id INT REFERENCES tickets(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      value     TEXT,
      PRIMARY KEY (ticket_id, field_key)
    )`],

  ['ticket_time_entries', `
    CREATE TABLE IF NOT EXISTS ticket_time_entries (
      id         SERIAL PRIMARY KEY,
      ticket_id  INT REFERENCES tickets(id) ON DELETE CASCADE,
      agent_id   INT REFERENCES agents(id) ON DELETE SET NULL,
      minutes    INT NOT NULL,
      note       TEXT,
      logged_at  TIMESTAMPTZ DEFAULT NOW()
    )`],

  // ── Audit log ───────────────────────────────────────────────────────────────
  ['audit_log', `
    CREATE TABLE IF NOT EXISTS audit_log (
      id          BIGSERIAL PRIMARY KEY,
      agent_id    INT REFERENCES agents(id) ON DELETE SET NULL,
      agent_name  TEXT,
      action      TEXT NOT NULL,
      entity_type TEXT,
      entity_id   INT,
      old_value   JSONB,
      new_value   JSONB,
      ip_address  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )`],

  // ── Indexes (performance — FK / filter columns) ─────────────────────────────
  ['indexes', `
    CREATE INDEX IF NOT EXISTS idx_tickets_contact_id     ON tickets(contact_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to    ON tickets(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_tickets_status         ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_sla_due_at     ON tickets(sla_due_at) WHERE status <> 'resolved';
    CREATE INDEX IF NOT EXISTS idx_replies_ticket_id      ON ticket_replies(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_ticket_id  ON ticket_attachments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_reply_id   ON ticket_attachments(reply_id);
    CREATE INDEX IF NOT EXISTS idx_service_requests_contact ON service_requests(contact_id);
    CREATE INDEX IF NOT EXISTS idx_service_requests_ticket  ON service_requests(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_kb_articles_folder      ON kb_articles(folder_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity        ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created       ON audit_log(created_at DESC);
  `],
];

async function runMigrations(db) {
  for (const [name, sql] of STEPS) {
    try {
      await db.query(sql);
    } catch (err) {
      // Fail loud — do not continue serving on a half-migrated schema.
      throw new Error(`[migrate] step "${name}" failed: ${err.message}`);
    }
  }
  console.log(`[db] Migrations applied (${STEPS.length} steps)`);
}

module.exports = { runMigrations };

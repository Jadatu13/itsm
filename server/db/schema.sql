-- ─────────────────────────────────────────────────────────────────────────────
-- Bootstrap schema (run once by the Postgres docker-entrypoint on first init,
-- before seed.sql). It creates the base tables the seed data needs.
--
-- The COMPLETE, authoritative schema lives in server/db/migrate.js, which runs
-- idempotently on every application boot and creates/updates every table,
-- column, trigger and index. This file is intentionally minimal and uses
-- IF NOT EXISTS / no destructive DROPs so it is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'on_hold', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS organisations (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organisation_domains (
  id              SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  domain          VARCHAR NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS contacts (
  id              SERIAL PRIMARY KEY,
  first_name      VARCHAR NOT NULL,
  last_name       VARCHAR NOT NULL,
  email           VARCHAR UNIQUE NOT NULL,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
  phone           VARCHAR,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets (
  id          SERIAL PRIMARY KEY,
  reference   VARCHAR UNIQUE,
  subject     VARCHAR NOT NULL,
  description TEXT NOT NULL,
  status      ticket_status   NOT NULL DEFAULT 'open',
  priority    ticket_priority NOT NULL DEFAULT 'medium',
  contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION generate_ticket_reference()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tickets SET reference = 'TKT-' || LPAD(NEW.id::TEXT, 4, '0') WHERE id = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_ticket_reference ON tickets;
CREATE TRIGGER set_ticket_reference
AFTER INSERT ON tickets
FOR EACH ROW
EXECUTE FUNCTION generate_ticket_reference();

CREATE TABLE IF NOT EXISTS ticket_replies (
  id             SERIAL PRIMARY KEY,
  ticket_id      INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  is_agent_reply BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_ticket_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tickets SET updated_at = NOW() WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ticket_reply_updates_ticket ON ticket_replies;
CREATE TRIGGER ticket_reply_updates_ticket
AFTER INSERT ON ticket_replies
FOR EACH ROW
EXECUTE FUNCTION update_ticket_updated_at();

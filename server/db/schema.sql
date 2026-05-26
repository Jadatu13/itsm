-- Drop existing types and tables if re-running
DROP TABLE IF EXISTS ticket_replies CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS organisation_domains CASCADE;
DROP TABLE IF EXISTS organisations CASCADE;
DROP TYPE IF EXISTS ticket_status CASCADE;
DROP TYPE IF EXISTS ticket_priority CASCADE;

CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'on_hold', 'resolved');
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high');

CREATE TABLE organisations (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE organisation_domains (
  id              SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  domain          VARCHAR NOT NULL,
  UNIQUE (domain)
);

CREATE TABLE contacts (
  id              SERIAL PRIMARY KEY,
  first_name      VARCHAR NOT NULL,
  last_name       VARCHAR NOT NULL,
  email           VARCHAR UNIQUE NOT NULL,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE tickets (
  id          SERIAL PRIMARY KEY,
  reference   VARCHAR UNIQUE,
  subject     VARCHAR NOT NULL,
  description TEXT NOT NULL,
  status      ticket_status NOT NULL DEFAULT 'open',
  priority    ticket_priority NOT NULL DEFAULT 'medium',
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Auto-generate reference in format TKT-0001
CREATE OR REPLACE FUNCTION generate_ticket_reference()
RETURNS TRIGGER AS $$
BEGIN
  NEW.reference := 'TKT-' || LPAD(NEW.id::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_ticket_reference
BEFORE INSERT ON tickets
FOR EACH ROW
EXECUTE FUNCTION generate_ticket_reference();

-- However, the trigger runs BEFORE INSERT but id is assigned during INSERT.
-- Use a two-step approach: insert first, then update reference.
-- Drop the above trigger and recreate as AFTER INSERT.
DROP TRIGGER IF EXISTS set_ticket_reference ON tickets;

CREATE OR REPLACE FUNCTION generate_ticket_reference()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tickets SET reference = 'TKT-' || LPAD(NEW.id::TEXT, 4, '0') WHERE id = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_ticket_reference
AFTER INSERT ON tickets
FOR EACH ROW
EXECUTE FUNCTION generate_ticket_reference();

CREATE TABLE ticket_replies (
  id            SERIAL PRIMARY KEY,
  ticket_id     INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  is_agent_reply BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Update updated_at on tickets when a reply is added
CREATE OR REPLACE FUNCTION update_ticket_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tickets SET updated_at = NOW() WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_reply_updates_ticket
AFTER INSERT ON ticket_replies
FOR EACH ROW
EXECUTE FUNCTION update_ticket_updated_at();

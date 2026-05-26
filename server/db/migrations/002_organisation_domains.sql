-- Run this if you already have a database and want to add domain support
-- without dropping your existing data.
CREATE TABLE IF NOT EXISTS organisation_domains (
  id              SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  domain          VARCHAR NOT NULL,
  UNIQUE (domain)
);

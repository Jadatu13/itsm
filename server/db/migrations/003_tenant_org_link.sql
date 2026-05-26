-- Link M365 tenants to organisations so portal submissions use the right tenant
ALTER TABLE m365_tenants
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id) ON DELETE SET NULL;

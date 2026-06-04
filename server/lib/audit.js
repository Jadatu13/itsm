/*
 * SQL to run once (add to server/index.js migrations):
 *
 * CREATE TABLE IF NOT EXISTS audit_log (
 *   id          BIGSERIAL PRIMARY KEY,
 *   agent_id    INT REFERENCES agents(id) ON DELETE SET NULL,
 *   agent_name  TEXT,
 *   action      TEXT NOT NULL,
 *   entity_type TEXT,
 *   entity_id   INT,
 *   old_value   JSONB,
 *   new_value   JSONB,
 *   ip_address  TEXT,
 *   created_at  TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log(entity_type, entity_id);
 * CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log(created_at DESC);
 */

const db = require('../db');

async function logAudit({ req, action, entityType, entityId, oldValue, newValue }) {
  try {
    await db.query(
      `INSERT INTO audit_log (agent_id, agent_name, action, entity_type, entity_id, old_value, new_value, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.agent?.id || null,
        req.agent?.name || 'System',
        action,
        entityType || null,
        entityId || null,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        req.ip || null,
      ]
    );
  } catch (err) {
    // Never let audit logging crash the request
    console.error('[audit]', err.message);
  }
}

module.exports = { logAudit };

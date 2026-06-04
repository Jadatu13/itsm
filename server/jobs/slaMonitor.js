/**
 * SLA Monitor — polling job that runs every 5 minutes.
 *
 * Required SQL migrations (add to server/index.js startup block):
 *   ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_alerted BOOLEAN DEFAULT false;
 *
 * Wire up in server/index.js:
 *   const { startSlaMonitor } = require('./jobs/slaMonitor');
 *   // inside app.listen callback, after startPoller():
 *   startSlaMonitor();
 */

const db                  = require('../db');
const { sendSlaBreachAlert } = require('../email');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function agentEmailEnabled() {
  try {
    const r = await db.query(`SELECT value FROM settings WHERE key = 'notifications_agent_email'`);
    if (!r.rows.length) return true;
    return r.rows[0].value !== 'false';
  } catch { return true; }
}

async function getRecipients(assignedTo) {
  if (assignedTo) {
    const r = await db.query('SELECT name, email FROM agents WHERE id = $1', [assignedTo]);
    return r.rows.length ? [{ name: r.rows[0].name, email: r.rows[0].email }] : [];
  }
  const r = await db.query(`SELECT name, email FROM agents WHERE role = 'admin' AND email IS NOT NULL`);
  return r.rows.map(a => ({ name: a.name, email: a.email }));
}

async function checkBreaches() {
  const enabled = await agentEmailEnabled();
  if (!enabled) return;

  const result = await db.query(
    `SELECT
       t.id, t.reference, t.subject, t.sla_due_at, t.assigned_to,
       c.first_name || ' ' || c.last_name AS contact_name
     FROM tickets t
     JOIN contacts c ON c.id = t.contact_id
     WHERE t.status NOT IN ('resolved')
       AND t.sla_due_at IS NOT NULL
       AND t.sla_due_at < NOW()
       AND t.sla_alerted = false`
  );

  if (!result.rows.length) return;

  console.log(`[slaMonitor] ${result.rows.length} SLA breach(es) found`);

  for (const ticket of result.rows) {
    try {
      const recipients = await getRecipients(ticket.assigned_to);
      for (const rec of recipients) {
        await sendSlaBreachAlert({
          to:            rec.email,
          agentName:     rec.name,
          reference:     ticket.reference,
          ticketId:      ticket.id,
          ticketSubject: ticket.subject,
          contactName:   ticket.contact_name,
          slaBreachedAt: ticket.sla_due_at,
        });
      }
      await db.query('UPDATE tickets SET sla_alerted = true WHERE id = $1', [ticket.id]);
      console.log(`[slaMonitor] Alerted for ${ticket.reference}`);
    } catch (err) {
      console.error(`[slaMonitor] Error processing ${ticket.reference}:`, err.message);
    }
  }
}

let _timer = null;

async function tick() {
  try {
    await checkBreaches();
  } catch (err) {
    console.error('[slaMonitor] Poll failed:', err.message);
  }
  _timer = setTimeout(tick, POLL_INTERVAL_MS);
}

function startSlaMonitor() {
  // Delay first run 30 s after startup
  _timer = setTimeout(tick, 30_000);
  console.log('[slaMonitor] SLA monitor started (first check in 30 s)');
}

module.exports = { startSlaMonitor };

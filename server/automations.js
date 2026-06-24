/**
 * Automation engine.
 * runAutomations(ticket, trigger, context) evaluates all enabled rules
 * for the given trigger and executes matched actions.
 */

const db = require('./db');

// ─── Condition evaluation ─────────────────────────────────────────────────────

const FIELD_MAP = {
  priority:    'priority',
  status:      'status',
  category:    'category',
  source:      'source',
  subject:     'subject',
  assigned_to: 'assigned_to',
  org_id:      'org_id',
};

function evaluate(condition, ticket) {
  const col = FIELD_MAP[condition.field];
  if (!col) return false;

  const raw = ticket[col];
  const val = raw === null || raw === undefined ? '' : String(raw).toLowerCase();
  const cmp = condition.value === null || condition.value === undefined
    ? ''
    : String(condition.value).toLowerCase();

  switch (condition.operator) {
    case 'equals':       return val === cmp;
    case 'not_equals':   return val !== cmp;
    case 'contains':     return val.includes(cmp);
    case 'is_empty':     return raw === null || raw === undefined || String(raw).trim() === '';
    case 'is_not_empty': return raw !== null && raw !== undefined && String(raw).trim() !== '';
    default:             return false;
  }
}

function matchesConditions(automation, ticket) {
  const { conditions, match_all } = automation;
  if (!conditions || conditions.length === 0) return true;

  if (match_all) {
    return conditions.every(c => evaluate(c, ticket));
  } else {
    return conditions.some(c => evaluate(c, ticket));
  }
}

// ─── Action execution ─────────────────────────────────────────────────────────

async function executeAction(action, ticket, conn) {
  const id = ticket.id;

  switch (action.type) {
    case 'set_status':
      await conn.query(
        `UPDATE tickets SET status = $1::ticket_status, updated_at = NOW() WHERE id = $2`,
        [action.value, id]
      );
      break;

    case 'assign_to': {
      const assignedTo = action.value ? parseInt(action.value, 10) || null : null;
      await conn.query(
        `UPDATE tickets SET assigned_to = $1, updated_at = NOW() WHERE id = $2`,
        [assignedTo, id]
      );
      break;
    }

    case 'set_priority':
      await conn.query(
        `UPDATE tickets SET priority = $1::ticket_priority, updated_at = NOW() WHERE id = $2`,
        [action.value, id]
      );
      break;

    case 'add_note':
      await conn.query(
        `INSERT INTO ticket_replies (ticket_id, body, is_internal, is_agent_reply, sender_name)
         VALUES ($1, $2, true, true, 'Automation')`,
        [id, action.value]
      );
      break;

    case 'send_canned': {
      const canned = await conn.query(
        `SELECT body FROM canned_responses WHERE id = $1`,
        [parseInt(action.value, 10)]
      );
      if (canned.rows.length) {
        await conn.query(
          `INSERT INTO ticket_replies (ticket_id, body, is_internal, is_agent_reply, sender_name)
           VALUES ($1, $2, false, true, 'Automation')`,
          [id, canned.rows[0].body]
        );
      }
      break;
    }

    default:
      console.warn(`[automation] Unknown action type: ${action.type}`);
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function runAutomations(ticket, trigger, context = {}) {
  const conn = context.db || db;

  // Tickets relate to an organisation only via their contact. Enrich the ticket
  // with org_id so org-based automation conditions can actually match.
  if (ticket && ticket.org_id === undefined && ticket.contact_id) {
    try {
      const r = await conn.query('SELECT organisation_id FROM contacts WHERE id = $1', [ticket.contact_id]);
      ticket = { ...ticket, org_id: r.rows[0]?.organisation_id ?? null };
    } catch { /* non-fatal — org conditions just won't match */ }
  }

  let automations;
  try {
    const result = await conn.query(
      `SELECT * FROM automations WHERE enabled = true AND trigger_type = $1 ORDER BY created_at ASC`,
      [trigger]
    );
    automations = result.rows;
  } catch (err) {
    console.error('[automation] Failed to load automations:', err.message);
    return;
  }

  for (const automation of automations) {
    try {
      if (!matchesConditions(automation, ticket)) continue;

      console.log(`[automation] Running rule "${automation.name}"`);

      const actions = automation.actions || [];
      for (const action of actions) {
        await executeAction(action, ticket, conn);
      }
    } catch (err) {
      console.error(`[automation] Error in rule "${automation.name}":`, err.message);
    }
  }
}

module.exports = { runAutomations };

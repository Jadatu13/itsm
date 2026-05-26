const express = require('express');
const router = express.Router();
const db = require('../db');
const { executeAutomation } = require('../graphExecutor');

// GET / — list all forms (admin)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.*, t.display_name AS tenant_name
       FROM service_request_forms f
       LEFT JOIN m365_tenants t ON t.id = f.automation_tenant_id
       ORDER BY f.sort_order, f.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch forms' });
  }
});

// GET /submissions — all submissions with approval state
router.get('/submissions', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT sr.*,
              sf.name AS form_name, sf.icon AS form_icon,
              sf.automation_action, sf.fields AS form_fields,
              sf.requires_approval,
              c.first_name || ' ' || c.last_name AS contact_name,
              c.email AS contact_email,
              t.reference AS ticket_reference, t.status AS ticket_status,
              ag.name AS approved_by_name
       FROM service_requests sr
       LEFT JOIN service_request_forms sf ON sf.id = sr.form_id
       LEFT JOIN contacts c ON c.id = sr.contact_id
       LEFT JOIN tickets t ON t.id = sr.ticket_id
       LEFT JOIN agents ag ON ag.id = sr.approved_by
       ORDER BY sr.created_at DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// GET /submissions/pending-count — count for badge
router.get('/submissions/pending-count', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT COUNT(*) AS count FROM service_requests WHERE approval_status = 'pending'`
    );
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    res.json({ count: 0 });
  }
});

// GET /:id
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.*, t.display_name AS tenant_name
       FROM service_request_forms f
       LEFT JOIN m365_tenants t ON t.id = f.automation_tenant_id
       WHERE f.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Form not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch form' });
  }
});

// POST /
router.post('/', async (req, res) => {
  const {
    name, description, icon, category, fields,
    ticket_priority, ticket_category, ticket_subject_template,
    enabled, sort_order, requires_approval, automation_action, automation_tenant_id,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await db.query(
      `INSERT INTO service_request_forms
         (name, description, icon, category, fields, ticket_priority, ticket_category,
          ticket_subject_template, enabled, sort_order, requires_approval, automation_action, automation_tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        name,
        description || null,
        icon || '📋',
        category || 'general',
        JSON.stringify(fields || []),
        ticket_priority || 'medium',
        ticket_category || null,
        ticket_subject_template || null,
        enabled !== false,
        sort_order || 0,
        requires_approval || false,
        automation_action ? JSON.stringify(automation_action) : null,
        automation_tenant_id || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// PUT /:id
router.put('/:id', async (req, res) => {
  const {
    name, description, icon, category, fields,
    ticket_priority, ticket_category, ticket_subject_template,
    enabled, sort_order, requires_approval, automation_action, automation_tenant_id,
  } = req.body;
  try {
    const result = await db.query(
      `UPDATE service_request_forms SET
         name=$1, description=$2, icon=$3, category=$4, fields=$5,
         ticket_priority=$6, ticket_category=$7, ticket_subject_template=$8,
         enabled=$9, sort_order=$10, requires_approval=$11,
         automation_action=$12, automation_tenant_id=$13, updated_at=NOW()
       WHERE id=$14
       RETURNING *`,
      [
        name,
        description || null,
        icon || '📋',
        category || 'general',
        JSON.stringify(fields || []),
        ticket_priority || 'medium',
        ticket_category || null,
        ticket_subject_template || null,
        enabled !== false,
        sort_order || 0,
        requires_approval || false,
        automation_action ? JSON.stringify(automation_action) : null,
        automation_tenant_id || null,
        req.params.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Form not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM service_request_forms WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete form' });
  }
});

// PATCH /:id/toggle
router.patch('/:id/toggle', async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE service_request_forms SET enabled = NOT enabled, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Form not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to toggle form' });
  }
});

// ── Approval workflow ─────────────────────────────────────────────────────────

// POST /submissions/:id/approve
router.post('/submissions/:id/approve', async (req, res) => {
  const agentId = req.agent?.id;
  try {
    // Mark approved
    const sr = await db.query(
      `UPDATE service_requests
       SET approval_status = 'approved', approved_by = $1, approved_at = NOW(), execution_status = 'executing'
       WHERE id = $2
       RETURNING *`,
      [agentId, req.params.id]
    );
    if (!sr.rows.length) return res.status(404).json({ error: 'Request not found' });
    const serviceRequest = sr.rows[0];

    // Add note to ticket
    if (serviceRequest.ticket_id) {
      const agentResult = await db.query('SELECT name FROM agents WHERE id = $1', [agentId]);
      const approverName = agentResult.rows[0]?.name || 'Admin';
      await db.query(
        `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal, sender_name)
         VALUES ($1, $2, true, true, $3)`,
        [serviceRequest.ticket_id, `✅ Service request approved by ${approverName}. Executing automation action…`, approverName]
      );
    }

    // Execute automation in background (non-blocking response)
    res.json({ ...serviceRequest, execution_status: 'executing' });

    // Run executor
    try {
      const formResult = await db.query('SELECT * FROM service_request_forms WHERE id = $1', [serviceRequest.form_id]);
      const form = formResult.rows[0];
      const result = await executeAutomation(serviceRequest, form);

      const finalStatus = result.noTenant ? 'no_tenant' : result.success ? 'completed' : 'failed';
      await db.query(
        `UPDATE service_requests SET execution_status = $1, execution_log = $2 WHERE id = $3`,
        [finalStatus, JSON.stringify(result.log), serviceRequest.id]
      );

      // Post execution summary to ticket
      if (serviceRequest.ticket_id) {
        const successLines = result.log.filter(l => l.level === 'success').map(l => l.message).join('\n');
        let summary;
        if (result.noTenant) {
          summary = `📋 No M365 tenant is configured for this organisation — this ticket has been logged for manual handling.`;
        } else if (result.success) {
          summary = `✅ Automation executed successfully.\n${successLines}`;
        } else {
          summary = `❌ Automation failed: ${result.error}\nCheck the execution log for details.`;
        }

        const agentResult = await db.query('SELECT name FROM agents WHERE id = $1', [agentId]);
        await db.query(
          `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal, sender_name)
           VALUES ($1, $2, true, true, $3)`,
          [serviceRequest.ticket_id, summary, agentResult.rows[0]?.name || 'Automation']
        );

        // Close ticket only on successful live automation — leave open for manual handling otherwise
        if (result.success && !result.noTenant) {
          await db.query(
            `UPDATE tickets SET status = 'resolved', updated_at = NOW() WHERE id = $1`,
            [serviceRequest.ticket_id]
          );
        }
      }
    } catch (execErr) {
      console.error('[automation] Execution error:', execErr);
      await db.query(
        `UPDATE service_requests SET execution_status = 'failed', execution_log = $1 WHERE id = $2`,
        [JSON.stringify([{ level: 'error', message: execErr.message, time: new Date().toISOString() }]), serviceRequest.id]
      );
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

// POST /submissions/:id/rerun — re-execute a failed automation
router.post('/submissions/:id/rerun', async (req, res) => {
  const agentId = req.agent?.id;
  try {
    const r = await db.query('SELECT * FROM service_requests WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Request not found' });
    const serviceRequest = r.rows[0];

    if (serviceRequest.execution_status !== 'failed') {
      return res.status(400).json({ error: 'Only failed executions can be rerun.' });
    }

    const agentResult = await db.query('SELECT name FROM agents WHERE id = $1', [agentId]);
    const agentName = agentResult.rows[0]?.name || 'Admin';

    const rerunEntry = [{ level: 'info', message: `↩ Rerun requested by ${agentName}`, time: new Date().toISOString() }];

    const sr = await db.query(
      `UPDATE service_requests
       SET execution_status = 'executing', execution_log = execution_log || $1::jsonb
       WHERE id = $2 RETURNING *`,
      [JSON.stringify(rerunEntry), req.params.id]
    );

    if (serviceRequest.ticket_id) {
      await db.query(
        `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal, sender_name)
         VALUES ($1, $2, true, true, $3)`,
        [serviceRequest.ticket_id, `↩ Automation rerun requested by ${agentName}.`, agentName]
      );
    }

    res.json({ ...sr.rows[0] });

    try {
      const formResult = await db.query('SELECT * FROM service_request_forms WHERE id = $1', [serviceRequest.form_id]);
      const form = formResult.rows[0];
      const result = await executeAutomation(serviceRequest, form);

      const finalStatus = result.noTenant ? 'no_tenant' : result.success ? 'completed' : 'failed';
      await db.query(
        `UPDATE service_requests
         SET execution_status = $1, execution_log = execution_log || $2::jsonb
         WHERE id = $3`,
        [finalStatus, JSON.stringify(result.log), serviceRequest.id]
      );

      if (serviceRequest.ticket_id) {
        const successLines = result.log.filter(l => l.level === 'success').map(l => l.message).join('\n');
        let summary;
        if (result.noTenant) {
          summary = `📋 No M365 tenant configured for this organisation — ticket remains open for manual handling.`;
        } else if (result.success) {
          summary = `✅ Automation rerun succeeded.\n${successLines}`;
        } else {
          summary = `❌ Automation rerun failed: ${result.error}\nCheck the execution log for details.`;
        }
        await db.query(
          `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal, sender_name)
           VALUES ($1, $2, true, true, $3)`,
          [serviceRequest.ticket_id, summary, agentName]
        );
        if (result.success && !result.noTenant) {
          await db.query(
            `UPDATE tickets SET status = 'resolved', updated_at = NOW() WHERE id = $1`,
            [serviceRequest.ticket_id]
          );
        }
      }
    } catch (execErr) {
      console.error('[rerun] Execution error:', execErr);
      const errEntry = [{ level: 'error', message: execErr.message, time: new Date().toISOString() }];
      await db.query(
        `UPDATE service_requests SET execution_status = 'failed', execution_log = execution_log || $1::jsonb WHERE id = $2`,
        [JSON.stringify(errEntry), serviceRequest.id]
      );
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to rerun request' });
  }
});

// POST /submissions/:id/reject
router.post('/submissions/:id/reject', async (req, res) => {
  const { reason } = req.body;
  const agentId = req.agent?.id;
  try {
    const sr = await db.query(
      `UPDATE service_requests
       SET approval_status = 'rejected', approved_by = $1, approved_at = NOW(), rejection_reason = $2
       WHERE id = $3
       RETURNING *`,
      [agentId, reason || null, req.params.id]
    );
    if (!sr.rows.length) return res.status(404).json({ error: 'Request not found' });
    const serviceRequest = sr.rows[0];

    // Add note to ticket
    if (serviceRequest.ticket_id) {
      const agentResult = await db.query('SELECT name FROM agents WHERE id = $1', [agentId]);
      const approverName = agentResult.rows[0]?.name || 'Admin';
      const body = reason
        ? `❌ Service request rejected by ${approverName}.\nReason: ${reason}`
        : `❌ Service request rejected by ${approverName}.`;
      await db.query(
        `INSERT INTO ticket_replies (ticket_id, body, is_agent_reply, is_internal, sender_name)
         VALUES ($1, $2, true, true, $3)`,
        [serviceRequest.ticket_id, body, approverName]
      );
      await db.query(
        `UPDATE tickets SET status = 'resolved', updated_at = NOW() WHERE id = $1`,
        [serviceRequest.ticket_id]
      );
    }

    res.json(serviceRequest);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

module.exports = router;

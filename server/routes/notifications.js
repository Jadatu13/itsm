const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/notifications/counts
router.get('/counts', async (req, res) => {
  try {
    const [approvals, awaitingReply, unassigned] = await Promise.all([

      // Pending service-request approvals
      db.query(`
        SELECT COUNT(*) AS count
        FROM service_requests
        WHERE approval_status = 'pending'
      `),

      // Open tickets where the last non-internal reply came from the contact
      // (i.e. agent hasn't responded yet — "needs reply")
      db.query(`
        SELECT COUNT(DISTINCT t.id) AS count
        FROM tickets t
        WHERE t.status NOT IN ('resolved')
          AND (
            -- last non-internal reply was from the contact
            (SELECT r.is_agent_reply
               FROM ticket_replies r
              WHERE r.ticket_id = t.id AND r.is_internal = false
              ORDER BY r.created_at DESC LIMIT 1) = false
            OR
            -- brand-new ticket with no replies at all
            NOT EXISTS (
              SELECT 1 FROM ticket_replies r
               WHERE r.ticket_id = t.id AND r.is_internal = false
            )
          )
      `),

      // Open tickets with no assigned agent
      db.query(`
        SELECT COUNT(*) AS count
        FROM tickets
        WHERE status NOT IN ('resolved') AND assigned_to IS NULL
      `),

    ]);

    res.json({
      pending_approvals: parseInt(approvals.rows[0].count,    10),
      awaiting_reply:    parseInt(awaitingReply.rows[0].count, 10),
      unassigned:        parseInt(unassigned.rows[0].count,    10),
    });
  } catch (err) {
    console.error('[notifications]', err.message);
    res.status(500).json({ error: 'Failed to fetch notification counts' });
  }
});

module.exports = router;

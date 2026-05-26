const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/reports/overview
router.get('/overview', async (req, res) => {
  try {
    const [totals, byPriority, byCategory, bySource, avgResolution] = await Promise.all([
      // Total counts by status
      db.query(`
        SELECT
          COUNT(*)                                                    AS total,
          COUNT(*) FILTER (WHERE status = 'open')                    AS open,
          COUNT(*) FILTER (WHERE status = 'in_progress')             AS in_progress,
          COUNT(*) FILTER (WHERE status = 'on_hold')                 AS on_hold,
          COUNT(*) FILTER (WHERE status = 'resolved')                AS resolved,
          COUNT(*) FILTER (WHERE status != 'resolved')               AS active,
          COUNT(*) FILTER (WHERE assigned_to IS NULL AND status != 'resolved') AS unassigned
        FROM tickets
      `),
      // By priority (active only)
      db.query(`
        SELECT priority, COUNT(*) AS count
        FROM tickets WHERE status != 'resolved'
        GROUP BY priority ORDER BY
          CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
      `),
      // By category (active only)
      db.query(`
        SELECT COALESCE(category, 'uncategorised') AS category, COUNT(*) AS count
        FROM tickets WHERE status != 'resolved'
        GROUP BY category ORDER BY count DESC
      `),
      // By source (all time)
      db.query(`
        SELECT COALESCE(source, 'manual') AS source, COUNT(*) AS count
        FROM tickets GROUP BY source ORDER BY count DESC
      `),
      // Average resolution time in hours (last 90 days)
      db.query(`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600)::numeric, 1) AS avg_hours
        FROM tickets
        WHERE status = 'resolved' AND updated_at >= NOW() - INTERVAL '90 days'
      `),
    ]);

    res.json({
      totals:        totals.rows[0],
      byPriority:    byPriority.rows,
      byCategory:    byCategory.rows,
      bySource:      bySource.rows,
      avgResolutionHours: avgResolution.rows[0]?.avg_hours ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch report data' });
  }
});

// GET /api/reports/volume?days=30
router.get('/volume', async (req, res) => {
  const days = Math.min(parseInt(req.query.days || '30', 10), 365);
  try {
    const result = await db.query(`
      SELECT
        DATE(created_at) AS date,
        COUNT(*)         AS created,
        COUNT(*) FILTER (WHERE status = 'resolved' AND DATE(updated_at) = DATE(created_at)) AS resolved_same_day
      FROM tickets
      WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [days]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch volume data' });
  }
});

// GET /api/reports/agents
router.get('/agents', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        a.id, a.name,
        COUNT(t.id)                                        AS total_assigned,
        COUNT(t.id) FILTER (WHERE t.status != 'resolved') AS open_tickets,
        COUNT(t.id) FILTER (WHERE t.status = 'resolved')  AS resolved_tickets,
        ROUND(AVG(
          CASE WHEN t.status = 'resolved'
               THEN EXTRACT(EPOCH FROM (t.updated_at - t.created_at)) / 3600
          END
        )::numeric, 1) AS avg_resolution_hours
      FROM agents a
      LEFT JOIN tickets t ON t.assigned_to = a.id
      GROUP BY a.id, a.name
      ORDER BY a.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch agent report' });
  }
});

module.exports = router;

const express      = require('express');
const router       = express.Router();
const db           = require('../db');
const requireAdmin = require('../middleware/requireAdmin');

// GET /api/audit — admin only
// Optional query params: ?entity_type=ticket&entity_id=42&limit=50
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { entity_type, entity_id, limit } = req.query;
    const params = [];
    const conditions = [];

    if (entity_type) {
      params.push(entity_type);
      conditions.push(`al.entity_type = $${params.length}`);
    }
    if (entity_id) {
      params.push(parseInt(entity_id, 10));
      conditions.push(`al.entity_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const maxLimit = Math.min(parseInt(limit || '50', 10), 500);
    params.push(maxLimit);

    const result = await db.query(
      `SELECT
         al.id, al.agent_id, al.agent_name, al.action,
         al.entity_type, al.entity_id,
         al.old_value, al.new_value,
         al.ip_address, al.created_at
       FROM audit_log al
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

module.exports = router;

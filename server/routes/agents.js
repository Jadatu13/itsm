const express       = require('express');
const router        = express.Router();
const bcrypt        = require('bcrypt');
const db            = require('../db');
const requireAdmin  = require('../middleware/requireAdmin');
const { logAudit }  = require('../lib/audit');

// GET /api/agents — any authenticated agent can list
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, email, role, created_at FROM agents ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// All write operations require admin
router.use(requireAdmin);

// POST /api/agents
router.post('/', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  try {
    const hash   = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO agents (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at`,
      [name, email, hash, role || 'agent']
    );
    const newAgent = result.rows[0];
    await logAudit({ req, action: 'agent.created', entityType: 'agent', entityId: newAgent.id,
      newValue: { name: newAgent.name, email: newAgent.email, role: newAgent.role } });
    res.status(201).json(newAgent);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// PUT /api/agents/:id
router.put('/:id', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  try {
    // Fetch current for audit diff
    const before = await db.query('SELECT id, name, email, role FROM agents WHERE id=$1', [req.params.id]);
    const oldAgent = before.rows[0];

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await db.query(
        `UPDATE agents SET name=$1, email=$2, password_hash=$3, role=$4 WHERE id=$5`,
        [name, email, hash, role || 'agent', req.params.id]
      );
    } else {
      await db.query(
        `UPDATE agents SET name=$1, email=$2, role=$3 WHERE id=$4`,
        [name, email, role || 'agent', req.params.id]
      );
    }
    const result = await db.query(
      'SELECT id, name, email, role, created_at FROM agents WHERE id=$1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Agent not found' });
    const updated = result.rows[0];

    // Log role change if role changed
    if (oldAgent && oldAgent.role !== updated.role) {
      await logAudit({ req, action: 'agent.role_changed', entityType: 'agent', entityId: updated.id,
        oldValue: { role: oldAgent.role }, newValue: { role: updated.role } });
    }

    res.json(updated);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// DELETE /api/agents/:id
router.delete('/:id', async (req, res) => {
  try {
    // Fetch before deleting for audit
    const before = await db.query('SELECT id, name, email, role FROM agents WHERE id=$1', [req.params.id]);
    const oldAgent = before.rows[0];

    // Unassign tickets before deleting
    await db.query('UPDATE tickets SET assigned_to = NULL WHERE assigned_to = $1', [req.params.id]);
    const result = await db.query('DELETE FROM agents WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Agent not found' });

    if (oldAgent) {
      await logAudit({ req, action: 'agent.deleted', entityType: 'agent', entityId: oldAgent.id,
        oldValue: { name: oldAgent.name, email: oldAgent.email, role: oldAgent.role } });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

module.exports = router;

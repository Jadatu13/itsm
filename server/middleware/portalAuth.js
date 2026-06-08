const { verify } = require('../lib/secret');
const db = require('../db');

module.exports = async function portalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  try {
    const payload = verify(header.slice(7));
    if (payload.type !== 'portal') {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    const result = await db.query(
      'SELECT id, first_name, last_name, email, organisation_id FROM contacts WHERE id = $1',
      [payload.contact_id]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    req.contact = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorised' });
  }
};

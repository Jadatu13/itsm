const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'itsm-dev-secret-change-in-production';

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  try {
    req.agent = jwt.verify(header.slice(7), SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorised' });
  }
};

const { verify } = require('../lib/secret');

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  try {
    const payload = verify(header.slice(7));
    // Reject portal-scoped tokens on agent endpoints — they are signed with the
    // same secret but must never grant access to the agent-side API.
    if (payload.type === 'portal') {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    // Reject 2FA-pending temp tokens — they are only valid for the 2FA challenge.
    if (payload._2fa_pending) {
      return res.status(401).json({ error: 'Two-factor authentication not completed' });
    }
    req.agent = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorised' });
  }
};

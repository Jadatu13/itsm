module.exports = function requireAdmin(req, res, next) {
  if (req.agent?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

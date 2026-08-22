function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, message: 'Not authenticated.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ ok: false, message: 'Admin access required.' });
  }
  next();
}

function requireAdvertiser(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'advertiser') {
    return res.status(403).json({ ok: false, message: 'Advertiser access required.' });
  }
  next();
}

// Admin can do everything an advertiser can (e.g. uploading advertisements
// from the Admin panel), in addition to advertiser-only actions.
function requireAdvertiserOrAdmin(req, res, next) {
  const role = req.session && req.session.user && req.session.user.role;
  if (role !== 'advertiser' && role !== 'admin') {
    return res.status(403).json({ ok: false, message: 'Advertiser or admin access required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireAdvertiser, requireAdvertiserOrAdmin };

const db = require('../config/db');
const { currentTimeLabel } = require('../services/date.util');

function get(req, res) {
  res.json({
    ok: true,
    versions: db.getVersions(),
    serverTime: currentTimeLabel()
  });
}

module.exports = { get };

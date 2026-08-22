const analyticsService = require('../services/analytics.service');

async function get(req, res, next) {
  try {
    const data = await analyticsService.summary();
    res.json({ ok: true, analytics: data });
  } catch (err) {
    next(err);
  }
}

module.exports = { get };

const settingsService = require('../services/settings.service');

async function get(req, res, next) {
  try {
    const settings = await settingsService.get();
    res.json({ ok: true, settings });
  } catch (err) {
    next(err);
  }
}

async function updatePricing(req, res, next) {
  try {
    const settings = await settingsService.updatePricing(req.body);
    res.json({ ok: true, settings });
  } catch (err) {
    next(err);
  }
}

module.exports = { get, updatePricing };

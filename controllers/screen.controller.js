const screenService = require('../services/screen.service');
const adService = require('../services/ad.service');
const { slotAvailability } = require('../services/slots.service');

async function list(req, res, next) {
  try {
    const screens = await screenService.list();
    const ads = await adService.listAll();
    const refDuration = Number(req.query.duration) || 10;
    const withAvailability = screens.map(s => ({ ...s, availability: slotAvailability(s, ads, refDuration) }));
    res.json({ ok: true, screens: withAvailability });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const screen = await screenService.get(req.params.id.toUpperCase());
    if (!screen) return res.status(404).json({ ok: false, message: 'Screen not found.' });
    const ads = await adService.listAll();
    const availability = slotAvailability(screen, ads, Number(req.query.duration) || 10);
    res.json({ ok: true, screen: { ...screen, availability } });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const result = await screenService.create(req.body);
    if (!result.ok) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const result = await screenService.update(req.params.id.toUpperCase(), req.body);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const result = await screenService.remove(req.params.id.toUpperCase());
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, create, update, remove };

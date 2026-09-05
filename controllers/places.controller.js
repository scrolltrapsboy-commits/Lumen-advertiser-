const screenService = require('../services/screen.service');
const placesService = require('../services/places.service');

/**
 * GET /api/places/nearby?screenId=SCREEN001&query=abc
 * Advertiser-only (see routes/places.routes.js - requireAdvertiser). The
 * screen's own registered lat/lng is the primary search origin, per the
 * spec - the advertiser's phone GPS is never the sole source of location
 * for this endpoint.
 */
async function nearby(req, res, next) {
  try {
    const screenId = String(req.query.screenId || '').toUpperCase();
    if (!screenId) return res.status(400).json({ ok: false, message: 'screenId is required.' });

    const screen = await screenService.get(screenId);
    if (!screen) return res.status(404).json({ ok: false, message: 'Screen not found.' });

    if (typeof screen.lat !== 'number' || typeof screen.lng !== 'number') {
      return res.status(409).json({
        ok: false,
        code: 'SCREEN_LOCATION_NOT_CONFIGURED',
        message: 'This screen does not have a registered location yet. An admin needs to add its coordinates before nearby-business search can work.'
      });
    }

    const query = String(req.query.query || '').trim();
    const results = await placesService.searchNearbyBusinesses(screen.lat, screen.lng, query);
    res.json({ ok: true, screen: { id: screen.id, place: screen.place }, results });
  } catch (err) {
    if (err.code === 'PLACES_NOT_CONFIGURED') {
      return res.status(503).json({ ok: false, code: err.code, message: 'Nearby business search is temporarily unavailable.' });
    }
    if (err.code === 'PLACES_REQUEST_FAILED') {
      return res.status(502).json({ ok: false, code: err.code, message: 'Nearby business search is temporarily unavailable.' });
    }
    next(err);
  }
}

module.exports = { nearby };

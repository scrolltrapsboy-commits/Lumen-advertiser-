const screenService = require('../services/screen.service');
const weatherService = require('../services/weather.service');

/**
 * GET /api/weather/:screenId
 *
 * Public (same trust level as GET /api/display/:screenId - both are read
 * by the unauthenticated Big Display page itself, not an admin session).
 *
 * Location priority (see weather.service.js):
 *   1. The screen's OWN registered lat/lng (screenService.get) - always
 *      wins when present.
 *   2. Optional ?lat=&lng= query params - the Big Display page's own
 *      browser-Geolocation fallback (see display.js resolveGeolocationOnce()),
 *      sent by the CLIENT that owns this exact screen, not some other
 *      viewer's device. Only consulted when #1 is missing.
 * There is still no server-side geolocation call of any kind here - the
 * server only ever proxies whichever coordinates it was given.
 */
async function forScreen(req, res, next) {
  try {
    const screenId = String(req.params.screenId || '').toUpperCase();
    const screen = await screenService.get(screenId);
    if (!screen) {
      return res.status(404).json({ ok: false, code: 'SCREEN_NOT_FOUND', message: `No display is registered with ID "${screenId}".` });
    }

    // Fallback coordinates ONLY: getWeatherForScreen still prefers
    // screen.lat/screen.lng whenever those are already configured (see
    // weather.service.js) - these are never used to override a real
    // configured location, only to fill in when one is missing.
    let fallbackCoords = null;
    const rawLat = req.query.lat;
    const rawLng = req.query.lng;
    if (rawLat !== undefined && rawLng !== undefined) {
      const lat = Number(rawLat);
      const lng = Number(rawLng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        fallbackCoords = { lat, lng };
      }
    }

    const weather = await weatherService.getWeatherForScreen(screen, fallbackCoords);
    res.json({ ok: true, weather, refreshMs: weatherService.REFRESH_MS, rainProbabilityThreshold: weatherService.RAIN_PROBABILITY_THRESHOLD });
  } catch (err) {
    if (err.code === 'WEATHER_NOT_CONFIGURED') {
      // Not a server error - this is the expected, common case for any
      // screen an admin hasn't given coordinates to yet AND whose
      // browser hasn't resolved (or was denied) a geolocation fallback
      // yet. 200, not 4xx/5xx, so the frontend's normal JSON-parsing
      // path handles it without a separate error branch; ok:false +
      // code tells it to try the geolocation fallback (see display.js)
      // or, if that's already been tried, just not show a weather block.
      return res.json({ ok: false, code: err.code, message: err.message });
    }
    if (err.code === 'WEATHER_REQUEST_FAILED') {
      return res.status(502).json({ ok: false, code: err.code, message: 'Weather is temporarily unavailable.' });
    }
    next(err);
  }
}

module.exports = { forScreen };

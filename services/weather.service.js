/**
 * Server-side weather lookup for the Big Display's liquid-glass clock
 * overlay. Uses Open-Meteo (https://open-meteo.com), which requires no
 * API key at all for this kind of non-commercial forecast lookup - so
 * there is no secret to manage or accidentally leak to the frontend, and
 * no separate key-configuration step for whoever deploys this. The
 * frontend never calls Open-Meteo directly; it only calls this backend's
 * own /api/weather/:screenId endpoint (see weather.controller.js /
 * weather.routes.js), matching the same server-side-proxy pattern already
 * used for Google Places in places.service.js.
 *
 * UNTESTED AGAINST THE LIVE API: this sandbox's network egress is
 * restricted to a small allowlist (npm/pypi/github/etc.) and does not
 * include api.open-meteo.com, so this has not been exercised against the
 * real endpoint from here - same caveat places.service.js already
 * documents for the Google Places API it calls. The request/response
 * shape below follows Open-Meteo's documented, stable "Forecast API"
 * contract (current + hourly variables, `timezone=auto`) as of this
 * writing; verify against https://open-meteo.com/en/docs before relying
 * on it in case their API surface has changed.
 */
const https = require('https');

/*
 * WMO weather-code -> { label, category } mapping. Open-Meteo's
 * `weather_code` field follows the WMO code table (the same one used by
 * most national weather services), so this mapping is not
 * Open-Meteo-specific trivia - it's a standard, stable table.
 *
 * `category` drives which animated icon the frontend shows. Keep this in
 * sync with the CSS/JS icon set in pages.css / display.js
 * (clear, partly-cloudy, cloudy, fog, rain, heavy-rain, snow, thunderstorm).
 */
const WMO_CONDITIONS = {
  0: { label: 'Clear', category: 'clear' },
  1: { label: 'Mainly Clear', category: 'partly-cloudy' },
  2: { label: 'Partly Cloudy', category: 'partly-cloudy' },
  3: { label: 'Overcast', category: 'cloudy' },
  45: { label: 'Fog', category: 'fog' },
  48: { label: 'Fog', category: 'fog' },
  51: { label: 'Light Drizzle', category: 'rain' },
  53: { label: 'Drizzle', category: 'rain' },
  55: { label: 'Dense Drizzle', category: 'rain' },
  56: { label: 'Freezing Drizzle', category: 'rain' },
  57: { label: 'Freezing Drizzle', category: 'rain' },
  61: { label: 'Light Rain', category: 'rain' },
  63: { label: 'Rain', category: 'rain' },
  65: { label: 'Heavy Rain', category: 'heavy-rain' },
  66: { label: 'Freezing Rain', category: 'rain' },
  67: { label: 'Heavy Freezing Rain', category: 'heavy-rain' },
  71: { label: 'Light Snow', category: 'snow' },
  73: { label: 'Snow', category: 'snow' },
  75: { label: 'Heavy Snow', category: 'snow' },
  77: { label: 'Snow Grains', category: 'snow' },
  80: { label: 'Rain Showers', category: 'rain' },
  81: { label: 'Rain Showers', category: 'rain' },
  82: { label: 'Violent Rain Showers', category: 'heavy-rain' },
  85: { label: 'Snow Showers', category: 'snow' },
  86: { label: 'Heavy Snow Showers', category: 'snow' },
  95: { label: 'Thunderstorm', category: 'thunderstorm' },
  96: { label: 'Thunderstorm (Hail)', category: 'thunderstorm' },
  99: { label: 'Severe Thunderstorm', category: 'thunderstorm' }
};

/*
 * Configurable via env, with the exact defaults called out in the spec:
 * a 10-30 minute refresh window and a 60% rain-probability threshold.
 * Neither is hardcoded in the sense of "impossible to change" - both are
 * one env var away from being tuned per deployment.
 */
const REFRESH_MS =
  Number(process.env.WEATHER_REFRESH_MS) || 15 * 60 * 1000; // 15 minutes

const RAIN_PROBABILITY_THRESHOLD =
  Number(process.env.WEATHER_RAIN_PROBABILITY_THRESHOLD) || 60;

// screenId -> { data, expiresAt } - one cache entry per screen, so a
// screen with no traffic never triggers a fetch, and a screen being
// polled every few seconds by a stuck client still can't exceed one
// upstream request per REFRESH_MS.
const cache = new Map();

// screenId -> in-flight Promise, so two nearly-simultaneous requests for
// the same screen (e.g. a page reload racing the poll timer) share one
// upstream fetch instead of firing two.
const inFlight = new Map();

function httpsGetJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (err) {
          const parseErr = new Error('Weather API returned a non-JSON response');
          parseErr.code = 'WEATHER_REQUEST_FAILED';
          reject(parseErr);
        }
      });
    });
    req.on('timeout', () => {
      const timeoutErr = new Error('Weather API request timed out');
      timeoutErr.code = 'WEATHER_REQUEST_FAILED';
      req.destroy(timeoutErr);
    });
    req.on('error', (err) => {
      if (!err.code || !String(err.code).startsWith('WEATHER_')) {
        err.code = 'WEATHER_REQUEST_FAILED';
      }
      reject(err);
    });
  });
}

/**
 * @param {{id:string, lat?:number, lng?:number}} screen
 * @param {{lat:number, lng:number}|null} [fallbackCoords] - only used when
 *   the screen itself has no configured lat/lng. Typically the Big
 *   Display page's own browser-Geolocation reading (see display.js) -
 *   never used to override an already-configured screen location.
 * @returns {Promise<{tempC:number|null, condition:string, category:string, precipitationProbability:number|null, isDay:boolean, updatedAt:number}>}
 */
async function getWeatherForScreen(screen, fallbackCoords) {
  let lat = screen && typeof screen.lat === 'number' ? screen.lat : null;
  let lng = screen && typeof screen.lng === 'number' ? screen.lng : null;
  // screen.lat/lng - PRIORITY 1 - always wins when present. Only fall
  // back to the caller-supplied coordinates (PRIORITY 2, e.g. the
  // display's own browser geolocation) when the screen has none.
  let usingFallback = false;
  if (lat === null || lng === null) {
    if (fallbackCoords && typeof fallbackCoords.lat === 'number' && typeof fallbackCoords.lng === 'number') {
      lat = fallbackCoords.lat;
      lng = fallbackCoords.lng;
      usingFallback = true;
    }
  }

  if (lat === null || lng === null) {
    const err = new Error('This display has no configured location (lat/lng) - weather is not available.');
    err.code = 'WEATHER_NOT_CONFIGURED';
    throw err;
  }

  // Cache key must reflect WHICH coordinates are actually being used -
  // a screen-configured location caches under its stable screen.id alone
  // (as before), but a geolocation-fallback reading caches under a
  // coordinate-specific key so a different resolved position (e.g. the
  // display's browser resolves a slightly different fix on a later
  // reload) can't serve a stale reading for a completely different spot,
  // and so two different un-configured screens on the same page don't
  // collide. Rounded to ~1km to avoid GPS jitter fragmenting the cache.
  const cacheKey = usingFallback
    ? `${screen.id}:geo:${lat.toFixed(2)},${lng.toFixed(2)}`
    : screen.id;

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const existingFetch = inFlight.get(cacheKey);
  if (existingFetch) {
    return existingFetch;
  }

  const fetchPromise = (async () => {
    try {
      const url =
        'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${encodeURIComponent(lat)}` +
        `&longitude=${encodeURIComponent(lng)}` +
        '&current=temperature_2m,weather_code,is_day' +
        '&hourly=precipitation_probability' +
        '&forecast_days=1' +
        '&timezone=auto';

      const { status, body } = await httpsGetJSON(url);
      if (status !== 200 || !body || !body.current) {
        const err = new Error((body && body.reason) || 'Weather API request failed.');
        err.code = 'WEATHER_REQUEST_FAILED';
        throw err;
      }

      const weatherCode = body.current.weather_code;
      const condition = WMO_CONDITIONS[weatherCode] || { label: 'Unknown', category: 'cloudy' };
      const tempRaw = body.current.temperature_2m;
      const tempC = typeof tempRaw === 'number' ? Math.round(tempRaw) : null;
      const isDay = body.current.is_day !== 0;

      // Match the current hour's precipitation probability using
      // Open-Meteo's own already-localized `current.time` (with
      // timezone=auto both `current.time` and every `hourly.time` entry
      // are in the SCREEN's local time, not the server's) - this avoids
      // this service needing any timezone-conversion logic of its own.
      let precipitationProbability = null;
      const currentTimeLocal = body.current.time; // e.g. "2026-08-30T14:00"
      if (
        typeof currentTimeLocal === 'string' &&
        body.hourly &&
        Array.isArray(body.hourly.time) &&
        Array.isArray(body.hourly.precipitation_probability)
      ) {
        const currentHourPrefix = currentTimeLocal.slice(0, 13); // "YYYY-MM-DDTHH"
        const idx = body.hourly.time.findIndex((t) => typeof t === 'string' && t.startsWith(currentHourPrefix));
        if (idx !== -1) {
          const p = body.hourly.precipitation_probability[idx];
          precipitationProbability = typeof p === 'number' ? p : null;
        }
      }

      // Requirement: a high rain-probability forecast should visually
      // communicate rain even if the current instantaneous weather_code
      // itself isn't already a rain code (e.g. "partly cloudy" right now,
      // but the forecast says rain is very likely this hour). Never
      // downgrade an already-worse category (heavy-rain/thunderstorm).
      let category = condition.category;
      if (
        typeof precipitationProbability === 'number' &&
        precipitationProbability >= RAIN_PROBABILITY_THRESHOLD &&
        category !== 'thunderstorm' &&
        category !== 'heavy-rain'
      ) {
        category = 'rain';
      }

      const data = {
        tempC,
        condition: condition.label,
        category,
        precipitationProbability,
        isDay,
        updatedAt: Date.now()
      };

      cache.set(cacheKey, { data, expiresAt: Date.now() + REFRESH_MS });
      return data;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, fetchPromise);
  return fetchPromise;
}

module.exports = {
  getWeatherForScreen,
  REFRESH_MS,
  RAIN_PROBABILITY_THRESHOLD
};

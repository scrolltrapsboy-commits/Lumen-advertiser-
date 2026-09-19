/**
 * Server-side proxy for Google Places Nearby Search. The API key lives
 * only in process.env.GOOGLE_MAPS_API_KEY (server-side) and is never sent
 * to the browser - the frontend calls /api/places/nearby on this backend,
 * never Google directly.
 *
 * UNTESTED: this sandbox has no network egress, so this has not been
 * exercised against the real Google Places API. The request/response
 * shapes below follow Google's documented Places API (New) Nearby Search
 * contract as of this writing; verify against current docs before relying
 * on it, since Google's API surface does change.
 */
const https = require('https');

const DEFAULT_RADIUS_M = Number(process.env.NEARBY_BUSINESS_RADIUS_M) || 3000;

function httpsPostJSON(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (err) {
            reject(new Error('Places API returned a non-JSON response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * @param {number} lat - screen's registered latitude (the primary location
 *   for nearby search - see screen.service.js; the advertiser's own GPS is
 *   never the sole source per the spec).
 * @param {number} lng
 * @param {string} query - business name/keyword search text.
 * @param {number} [radiusM]
 * @returns {Promise<Array<{id:string,name:string,address:string,distanceM:number,types:string[]}>>}
 */
async function searchNearbyBusinesses(lat, lng, query, radiusM = DEFAULT_RADIUS_M) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    const err = new Error('Nearby business search is not configured (missing GOOGLE_MAPS_API_KEY).');
    err.code = 'PLACES_NOT_CONFIGURED';
    throw err;
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error('A valid screen location is required for nearby business search.');
  }

  const body = {
    textQuery: query || '',
    locationBias: {
      circle: { center: { latitude: lat, longitude: lng }, radius: radiusM }
    },
    maxResultCount: 20
  };

  const { status, body: result } = await httpsPostJSON(
    'places.googleapis.com',
    '/v1/places:searchText',
    {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types'
    },
    body
  );

  if (status !== 200) {
    const err = new Error((result && result.error && result.error.message) || 'Places API request failed.');
    err.code = 'PLACES_REQUEST_FAILED';
    throw err;
  }

  const haversineMeters = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  return (result.places || [])
    .map((p) => ({
      id: p.id,
      name: p.displayName && p.displayName.text,
      address: p.formattedAddress || '',
      types: p.types || [],
      distanceM: p.location ? Math.round(haversineMeters(lat, lng, p.location.latitude, p.location.longitude)) : null
    }))
    // Belt-and-suspenders: locationBias alone doesn't guarantee every
    // result is inside the radius, so filter explicitly per the spec's
    // "business name/search match AND distance <= configured radius" rule.
    .filter((p) => p.distanceM === null || p.distanceM <= radiusM)
    .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
}

module.exports = { searchNearbyBusinesses };

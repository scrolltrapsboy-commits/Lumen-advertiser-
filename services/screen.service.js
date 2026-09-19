const db = require('../config/db');
const { timeToMinutes } = require('./date.util');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeTime(value, fallback) {
  const str = String(value || '').trim();
  return TIME_RE.test(str) ? str : fallback;
}

async function list() {
  return db.read('screens.json');
}

async function get(id) {
  const screens = await list();
  return screens.find(s => s.id === id) || null;
}

async function create({ id, place, address, description, status, activeState, openTime, closeTime, lat, lng }) {
  if (!place || !String(place).trim()) return { ok: false, message: 'Place name is required.' };

  const open = normalizeTime(openTime, null);
  const close = normalizeTime(closeTime, null);
  if (!open || !close) {
    return { ok: false, message: 'Enter valid opening and closing times (HH:MM).' };
  }
  if (timeToMinutes(open) === timeToMinutes(close)) {
    return { ok: false, message: 'Opening and closing time cannot be the same.' };
  }

  // lat/lng are optional (existing screens created before this field
  // existed have neither) - the nearby-business search endpoint checks for
  // their presence itself and returns a clear "not configured" error
  // rather than silently searching from (0, 0) or crashing.
  const parsedLat = lat !== undefined && lat !== null && lat !== '' ? Number(lat) : null;
  const parsedLng = lng !== undefined && lng !== null && lng !== '' ? Number(lng) : null;
  if ((parsedLat !== null && Number.isNaN(parsedLat)) || (parsedLng !== null && Number.isNaN(parsedLng))) {
    return { ok: false, message: 'Latitude/longitude must be valid numbers.' };
  }

  // Atomic: ID assignment/uniqueness check and the write happen as one
  // queued operation, so two concurrent creates can't collide on the same
  // auto-generated or manually-entered screen ID.
  return db.update('screens.json', (screens) => {
    const screenId = id && String(id).trim() ? String(id).trim().toUpperCase() : `SCREEN${String(screens.length + 1).padStart(3, '0')}`;
    if (screens.some(s => s.id === screenId)) {
      return { data: screens, result: { ok: false, message: 'A screen with this ID already exists.' } };
    }
    const screen = {
      id: screenId,
      place: String(place).trim(),
      address: String(address || '').trim(),
      description: String(description || '').trim(),
      status: status || 'offline',
      activeState: activeState || 'active',
      openTime: open,
      closeTime: close,
      lat: parsedLat,
      lng: parsedLng,
      createdAt: Date.now()
    };
    screens.push(screen);
    return { data: screens, result: { ok: true, screen } };
  });
}

async function update(id, patch) {
  const screens = await list();
  const idx = screens.findIndex(s => s.id === id);
  if (idx === -1) return { ok: false, message: 'Screen not found.' };

  const next = { ...screens[idx] };
  if (patch.place !== undefined) next.place = String(patch.place).trim();
  if (patch.address !== undefined) next.address = String(patch.address).trim();
  if (patch.description !== undefined) next.description = String(patch.description).trim();
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.activeState !== undefined) next.activeState = patch.activeState;
  if (patch.openTime !== undefined) {
    const open = normalizeTime(patch.openTime, next.openTime);
    next.openTime = open;
  }
  if (patch.closeTime !== undefined) {
    const close = normalizeTime(patch.closeTime, next.closeTime);
    next.closeTime = close;
  }
  if (patch.lat !== undefined) {
    const parsedLat = patch.lat === null || patch.lat === '' ? null : Number(patch.lat);
    if (parsedLat !== null && Number.isNaN(parsedLat)) return { ok: false, message: 'Latitude must be a valid number.' };
    next.lat = parsedLat;
  }
  if (patch.lng !== undefined) {
    const parsedLng = patch.lng === null || patch.lng === '' ? null : Number(patch.lng);
    if (parsedLng !== null && Number.isNaN(parsedLng)) return { ok: false, message: 'Longitude must be a valid number.' };
    next.lng = parsedLng;
  }
  if (timeToMinutes(next.openTime) === timeToMinutes(next.closeTime)) {
    return { ok: false, message: 'Opening and closing time cannot be the same.' };
  }

  screens[idx] = next;
  await db.write('screens.json', screens);
  return { ok: true, screen: screens[idx] };
}

async function remove(id) {
  const screens = await list();
  const next = screens.filter(s => s.id !== id);
  await db.write('screens.json', next);
  return { ok: true };
}

module.exports = { list, get, create, update, remove };

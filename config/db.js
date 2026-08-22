const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const DEFAULTS = {
  'users.json': [],
  'screens.json': [
    { id: 'SCREEN001', place: 'Lulu Mall Food Court', address: 'NH66, Edappally, Kochi', description: 'High footfall food court entrance', status: 'online', activeState: 'active', openTime: '08:00', closeTime: '19:00', createdAt: Date.now() },
    { id: 'SCREEN002', place: 'Mall Entrance \u2013 Gate 2', address: 'MG Road, Kochi', description: 'Main entrance display', status: 'online', activeState: 'active', openTime: '08:00', closeTime: '19:00', createdAt: Date.now() },
    { id: 'SCREEN003', place: 'Metro Station Concourse', address: 'Kaloor Metro Station, Kochi', description: 'Commuter walkway screen', status: 'offline', activeState: 'active', openTime: '06:00', closeTime: '23:00', createdAt: Date.now() },
    { id: 'SCREEN004', place: 'City Multiplex Lobby', address: 'Forum Mall, Kochi', description: 'Cinema lobby waiting area', status: 'online', activeState: 'disabled', openTime: '10:00', closeTime: '23:00', createdAt: Date.now() }
  ],
  'ads.json': [],
  'settings.json': {
    appName: 'Lumen',
    tagline: 'Local Digital Advertising Platform',
    pricing: { photo: 2000, video: 4000 },
    currency: '\u20b9',
    durations: [5, 6, 7, 8, 9, 10],
    dayOptions: [1, 3, 7, 15, 30, 90, 180, 365],
    maxVideoSeconds: 60,
    allowedImageTypes: ['image/png', 'image/jpeg', 'image/webp'],
    allowedVideoTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
    maxImageMB: 10,
    maxVideoMB: 500,
    timezone: 'Asia/Kolkata',
    logoCycleSeconds: 30,
    logoVisibleSeconds: 5,
    qrCycleSeconds: 30,
    qrVisibleSeconds: 5,
    transitionMs: 1000,
    transitionStyles: ['fade', 'zoom', 'glass-blur', 'crossfade'],
    siteUrl: process.env.SITE_URL || 'https://lumen.example.com',
    defaultVideoDuration: 10,
    pricingTiers: {
      image: [
        { minDuration: 1, maxDuration: 5, pricePerDay: 100 },
        { minDuration: 6, maxDuration: 10, pricePerDay: 150 }
      ],
      video: [
        { minDuration: 1, maxDuration: 15, pricePerDay: 200 },
        { minDuration: 16, maxDuration: 30, pricePerDay: 300 },
        { minDuration: 31, maxDuration: 45, pricePerDay: 400 },
        { minDuration: 46, maxDuration: 60, pricePerDay: 500 }
      ]
    }
  },
  'analytics.json': { events: [] }
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureFile(name) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, name);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(DEFAULTS[name], null, 2), 'utf8');
  }
  return filePath;
}

// Simple in-process write queue per file to avoid concurrent write corruption
const queues = {};

function queued(name, fn) {
  const prev = queues[name] || Promise.resolve();
  const next = prev.then(fn, fn);
  queues[name] = next.catch(() => {});
  return next;
}

// In-memory version stamps, bumped on every successful write. Polled by the
// frontend (GET /api/meta) so pages can detect changes cheaply without
// re-fetching full collections every second.
const versions = {};
Object.keys(DEFAULTS).forEach(name => { versions[name] = Date.now(); });

function bump(name) {
  versions[name] = Date.now();
}

function getVersions() {
  return { ...versions };
}

function readSync(name) {
  const filePath = ensureFile(name);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : DEFAULTS[name];
  } catch (err) {
    console.error(`Failed to read ${name}, restoring defaults:`, err.message);
    fs.writeFileSync(filePath, JSON.stringify(DEFAULTS[name], null, 2), 'utf8');
    return DEFAULTS[name];
  }
}

function writeSync(name, data) {
  const filePath = ensureFile(name);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
  bump(name);
  return data;
}

function read(name) {
  return queued(name, () => readSync(name));
}

function write(name, data) {
  return queued(name, () => writeSync(name, data));
}

/**
 * Atomic read-modify-write. `fn(data)` receives the current contents of
 * `name` and must return `{ data, result }` — `data` is what gets persisted
 * (may be the same array, mutated in place, or a new one e.g. from
 * .filter()), `result` is handed back to the caller. Runs as a single task
 * on the file's write queue, so no other read or write for this file can
 * interleave between the check and the write — this is what prevents
 * lost updates and duplicate-record races (e.g. two concurrent signups
 * with the same email both passing an "email taken?" check before either
 * writes).
 */
function update(name, fn) {
  return queued(name, async () => {
    const data = readSync(name);
    const outcome = await fn(data);
    const nextData = outcome && Object.prototype.hasOwnProperty.call(outcome, 'data') ? outcome.data : data;
    writeSync(name, nextData);
    return outcome ? outcome.result : undefined;
  });
}

// Initialize all data files on module load
Object.keys(DEFAULTS).forEach(ensureFile);

module.exports = { read, write, update, readSync, writeSync, getVersions, DATA_DIR };

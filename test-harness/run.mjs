import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('public');

const html = fs.readFileSync(path.join(ROOT, 'display.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost/display.html?id=SCREEN001',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});

const { window } = dom;
global.window = window;
global.document = window.document;
global.CustomEvent = window.CustomEvent;
global.EventTarget = window.EventTarget;
global.URL = window.URL;
global.URLSearchParams = window.URLSearchParams;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.Image = window.Image;
window.requestFullscreen = undefined;
document.documentElement.requestFullscreen = undefined;

// ---- Mock ad state we can mutate mid-test ----
const state = {
  ads: [],  // start with NO ads, like "before upload"
  screen: { id: 'SCREEN001', place: 'Test Place' },
  status: { isOpen: true },
  config: { siteUrl: 'http://localhost' },
};

function buildFeed() {
  return {
    screen: state.screen,
    ads: state.ads,
    status: state.status,
    config: state.config,
  };
}

window.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/api/display/')) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => buildFeed(),
    };
  }
  if (u.includes('/api/meta')) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ versions: { 'ads.json': state._adsVersion || 0 } }),
    };
  }
  // images / videos requested by <img>/<video> src assignment don't go through fetch()
  return { ok: false, status: 404, headers: { get: () => 'text/plain' }, json: async () => ({}) };
};
global.fetch = window.fetch;

// jsdom doesn't implement Image loading (network), so <img> never fires load/error.
// That's fine for this harness: we only inspect DOM structure/classes/inline styles,
// which is what actually determines visibility - not whether the pixels decoded.

function snapshotLayer(id) {
  const el = document.getElementById(id);
  if (!el) return { exists: false };
  return {
    exists: true,
    classes: [...el.classList],
    innerHTMLLen: el.innerHTML.length,
    hasImg: !!el.querySelector('img.player-foreground-media'),
    imgSrc: el.querySelector('img.player-foreground-media')?.src || null,
    inlineStyle: el.getAttribute('style') || '',
  };
}

function snapshotStatusOverlay() {
  const el = document.getElementById('status-overlay');
  if (!el) return { exists: false };
  return { exists: true, display: el.style.display, text: el.textContent.slice(0, 60) };
}

async function main() {
  console.log('=== STEP 0: import display.js (module executes init() immediately) ===');
  await import('../public/assets/js/pages/display.js');

  // init() does async work (apiFetch). Give the microtask/timer queue a chance to run.
  await new Promise((r) => setTimeout(r, 50));

  console.log('--- After initial load, 0 ads ---');
  console.log('layer-a:', snapshotLayer('layer-a'));
  console.log('layer-b:', snapshotLayer('layer-b'));
  console.log('status-overlay:', snapshotStatusOverlay());

  // Now simulate "ad gets uploaded" - the exact user-reported trigger.
  state.ads = [{
    id: 'ad-1',
    userEmail: 'lumen@gmail.com',
    mediaType: 'image',
    mediaUrl: 'http://localhost/uploads/test.png',
    fileName: 'test.png',
    duration: 5,
    days: 7,
    screenId: 'all',
    price: 700,
    sourceType: 'ADMIN',
    status: 'active',
  }];
  state._adsVersion = 1;

  console.log('\n=== STEP 1: ad uploaded (ads.length now 1) ===');
  console.log('Waiting for the display\'s own poll/timeout loop to pick it up (up to ~5-10s in real code, we just wait a bit and manually trigger what watchLive would trigger)...');

  // In the real app, watchLive polls /api/meta every 2s and, on seeing ads.json's
  // version change, calls the registered handler => refreshFeed() (NOT showFrame()).
  // We can't easily reach into runLoop's closures from here (they're private), so
  // instead we just wait for the natural timers already running inside display.js
  // (the "ads.length === 0" branch sets a 5000ms timer that itself calls
  // refreshFeed() + showFrame()). Advance fake time isn't available without
  // fake timers, so we really wait.
  await new Promise((r) => setTimeout(r, 5300));

  console.log('--- After ~5.3s (single-ad branch should have rendered) ---');
  console.log('layer-a:', snapshotLayer('layer-a'));
  console.log('layer-b:', snapshotLayer('layer-b'));
  console.log('status-overlay:', snapshotStatusOverlay());

  process.exit(0);
}

main().catch((err) => {
  console.error('HARNESS ERROR', err);
  process.exit(1);
});

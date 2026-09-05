import { apiFetch } from '../core/api.js';
import { qs, qsa, escapeHTML, formatScreenLabel } from '../core/helpers.js';
import { watchLive } from '../core/live.js';
import { showLoader, hideLoader } from '../components/loader.js';
import { runParticleTransition } from '../components/particle-transition.js';
import { runTurbulentDissolve } from '../components/turbulent-dissolve.js';
import { initQRVideoWalker } from '../components/qr-video-walker.js';
import { generateQRSvgMarkup } from '../components/qr-code.js';

/* =====================================================================
 * QR ADVERTISEMENT / QR VIDEO-WALKER CONFIG
 * =====================================================================
 * Both settings below are deliberately at the very top of this file so
 * they're easy to find without hunting through mountPlayerShell().
 *
 * QR_VIDEO_DEMO_MODE:
 *   The QR advertisement itself and the video walker are already
 *   mounted once per screen connection from mountPlayerShell(), which
 *   runs unconditionally (see the `mountPlayerShell(config, screen);`
 *   call below) - BEFORE the ad-fetch logic decides whether to show
 *   "Waiting For Advertisements". So the QR card always renders
 *   regardless of campaign state already. This flag specifically gates
 *   only the video walker (see its use just above
 *   `initQRVideoWalker(...)` further down): true (default) = walker
 *   always runs, letting you test/demo the place/pickup sequence with
 *   zero active campaigns; false = walker is disabled outright (the QR
 *   card itself still renders either way). This is a test aid only -
 *   it does not replace or alter the normal campaign system.
 *
 * QR_DESTINATION_URL:
 *   What the QR actually encodes. Defaults to the screen's own
 *   `config.siteUrl` (same source the old API-generated QR used) so
 *   behavior doesn't change out of the box - override the string below
 *   to point the QR somewhere else.
 */
const QR_VIDEO_DEMO_MODE = true;
const QR_DESTINATION_URL = null; // null = fall back to config.siteUrl at mount time

/**
 * Runs the falling-page transition. No longer used for ad-to-ad rotation
 * on the big display (see particle-transition.js) - kept only in case a
 * separate screen-change transition needs it later, per the requirement
 * not to delete transition code that might still be wanted elsewhere.
/**
 * Explicitly stops any <video> inside a layer before it's torn down.
 * Removing a media element from the DOM (via innerHTML='') has no spec
 * guarantee of immediately halting its audio track - some browsers keep
 * decoding/playing briefly until garbage collection actually reclaims the
 * element. Calling pause() + clearing src() here makes the stop
 * deterministic instead of relying on GC timing, so an outgoing video's
 * audio can never bleed into the next slide (image or video).
 */
function stopLayerMedia(layer) {
  if (!layer) return;
  layer.querySelectorAll('video').forEach((v) => {
    try {
      v.pause();
      v.removeAttribute('src');
      v.load();
    } catch (e) {
      // Best-effort cleanup - never let this block the transition.
    }
  });
}

async function runFallTransition({ currentLayer, nextLayer, durationMs = 900 }) {
  // Nothing to transition from (e.g., very first ad shown) - just reveal.
  if (!currentLayer || !nextLayer) {
    nextLayer.classList.add('active');
    nextLayer.style.display = 'flex';
    return;
  }

  // Ensure both layers have the base classes for the transition
  currentLayer.classList.add('lumen-player-page');
  nextLayer.classList.add('lumen-player-page');

  // 1. Prepare next layer: reveal it underneath immediately (painter's order)
  // This ensures the next ad is visible during the entire transition.
  nextLayer.classList.add('no-anim', 'active');
  nextLayer.style.zIndex = '1'; // underneath current layer (which gets z-index: 2 via .lumen-player-page-fall)
  nextLayer.style.display = 'flex';
  void nextLayer.offsetWidth; // force reflow
  nextLayer.classList.remove('no-anim');

  // 2. Run the fall animation on both pages simultaneously
  // Outgoing falls away (lumen-player-page-fall), incoming settles in (lumen-player-page-fall-in)
  return new Promise((resolve) => {
    // Add the animation classes
    currentLayer.classList.add('lumen-player-page-fall');
    nextLayer.classList.add('lumen-player-page-fall-in');

    // Handle animation end on the OUTGOING page (it determines when transition is complete)
    const handler = () => {
      currentLayer.removeEventListener('animationend', handler);
      currentLayer.classList.remove('lumen-player-page-fall');
      currentLayer.classList.remove('no-anim');
      currentLayer.classList.remove('active');

      // Clean up outgoing page. Explicitly pause/detach any <video> before
      // wiping innerHTML - removing a video element from the DOM does not
      // reliably stop its audio track immediately in every browser (no
      // spec guarantee; timing depends on GC), so without this an outgoing
      // video's audio could keep playing briefly under the next slide.
      stopLayerMedia(currentLayer);
      currentLayer.style.display = 'none';
      currentLayer.style.zIndex = '';
      currentLayer.innerHTML = '';

      // Finalize incoming page
      nextLayer.classList.remove('lumen-player-page-fall-in');
      nextLayer.classList.remove('no-anim');
      nextLayer.style.zIndex = '';
      nextLayer.classList.add('active');
      void nextLayer.offsetWidth;

      resolve();
    };

    currentLayer.addEventListener('animationend', handler);

    // Safety timeout in case animationend doesn't fire
    setTimeout(() => {
      if (currentLayer.classList.contains('lumen-player-page-fall')) {
        // Force completion
        currentLayer.classList.remove('lumen-player-page-fall');
        currentLayer.classList.remove('no-anim');
        currentLayer.classList.remove('active');
        stopLayerMedia(currentLayer);
        currentLayer.style.display = 'none';
        currentLayer.style.zIndex = '';
        currentLayer.innerHTML = '';

        nextLayer.classList.remove('lumen-player-page-fall-in');
        nextLayer.classList.remove('no-anim');
        nextLayer.style.zIndex = '';
        nextLayer.classList.add('active');
        void nextLayer.offsetWidth;

        resolve();
      }
    }, 900 + 200); // duration + buffer
  });
}

/**
 * Diagnostic-only overlay (only ever shown when ?debug=1 AND a media load
 * actually failed). Never replaces normal playback - it renders on top of
 * whatever's already there so a black display always has an explanation
 * instead of nothing.
 */
function renderMediaDebugOverlay({ screenId, adsCount, ad, mediaUrl, httpState, error }) {
  let panel = document.getElementById('lumen-debug-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'lumen-debug-panel';
    panel.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9999;max-width:520px;background:rgba(0,0,0,0.88);color:#7CFFB2;font:12px/1.5 monospace;padding:14px 16px;border-radius:8px;border:1px solid rgba(124,255,178,0.35);white-space:pre-wrap;pointer-events:none;';
    document.body.appendChild(panel);
  }
  panel.textContent =
`BIG DISPLAY DEBUG
Screen: ${screenId}
Ads returned: ${adsCount}
Ad ID: ${ad ? ad.id : '-'}
Status: ${ad ? ad.status : '-'}
Media type: ${ad ? ad.mediaType : '-'}
Media URL: ${mediaUrl || '-'}
HTTP URL: ${httpState || 'UNKNOWN'}
Media: ERROR
HTTP error: ${error || '-'}`;
}

/**
 * Absolute last-resort fail-safe. Bypasses the animation classes entirely
 * and makes `layer` visible via inline styles, which always win the CSS
 * cascade regardless of what class-based state the transition left behind.
 * Called only when prepareMediaElement()/runFallTransition() throw, so a
 * bug anywhere in the media/transition pipeline can never leave the big
 * display permanently black - the incoming layer is always forced visible
 * even if it has to skip the fall animation to do it.
 */
function forceShowLayer(layer, otherLayer) {
  if (!layer) return;
  layer.classList.remove('lumen-player-page-fall', 'lumen-player-page-fall-in', 'no-anim');
  layer.classList.add('lumen-player-page', 'active');
  layer.style.display = 'flex';
  layer.style.opacity = '1';
  layer.style.zIndex = '2';
  if (otherLayer && otherLayer !== layer) {
    stopLayerMedia(otherLayer);
    otherLayer.classList.remove('active', 'lumen-player-page-fall', 'lumen-player-page-fall-in', 'no-anim');
    otherLayer.style.display = 'none';
    otherLayer.style.opacity = '0';
    otherLayer.style.zIndex = '';
  }
  // FOUND BUG (root cause of the reported black screen): forceShowLayer only
  // forces the CONTAINER's own inline styles (display/opacity/z-index) to be
  // visible. It does nothing about what's *inside* the container. Every
  // caller assumed the media fragment had already been appended before
  // forceShowLayer runs - but on the single-ad path, and on the deepest
  // fallback branch of the multi-ad path, forceShowLayer can be reached
  // AFTER prepareMediaElement() threw and BEFORE anything was ever
  // appended. The layer is then "visible" (display:flex, opacity:1,
  // z-index:2) but structurally empty, and since .player-media-layer's own
  // background is #000, a technically-visible-but-empty layer is *visually
  // indistinguishable from a black screen*. That is the bug: not a
  // transition/z-index defect, but a fail-safe that verifies the container
  // is shown without ever verifying the container has content to show.
  if (!layer.querySelector('img, video')) {
    layer.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#ffffffcc;font:15px/1.4 -apple-system,sans-serif;text-align:center;padding:24px;">
        <div style="width:34px;height:34px;border-radius:50%;border:2px solid rgba(255,255,255,0.25);border-top-color:#ff6a3d;animation:lumen-fallback-spin 0.9s linear infinite;"></div>
        <div>Loading advertisement…</div>
      </div>
      <style>@keyframes lumen-fallback-spin{to{transform:rotate(360deg);}}</style>`;
    console.warn('[BIG DISPLAY] forceShowLayer called with no media in the layer - inserted a visible fallback so the screen is never a silent black box.');
  }
}

/**
 * Item 2/8 from the debugging runbook: dump the exact DOM/computed-style
 * state for a render, and self-heal if BOTH layers are ever simultaneously
 * hidden (the literal "black screen" condition). Runs on every frame when
 * ?debug=1 is set; the invariant check itself always runs (cheap), only the
 * verbose logging is gated behind DEBUG.
 */
function logRenderDiagnostics(dlog, { ad, currentLayer, nextLayer, currentLayerId, nextLayerId }) {
  const describe = (el) => {
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    const media = el.querySelector('img, video');
    const rect = el.getBoundingClientRect();
    return {
      tagName: el.tagName,
      className: el.className,
      inlineDisplay: el.style.display,
      inlineOpacity: el.style.opacity,
      inlineVisibility: el.style.visibility,
      inlineZIndex: el.style.zIndex,
      computedDisplay: cs.display,
      computedOpacity: cs.opacity,
      computedVisibility: cs.visibility,
      computedZIndex: cs.zIndex,
      rect: { w: rect.width, h: rect.height },
      mediaTag: media ? media.tagName : null,
      mediaSrc: media ? media.currentSrc || media.src : null,
    };
  };

  dlog('[BIG DISPLAY]', {
    adId: ad && ad.id,
    mediaType: ad && ad.mediaType,
    mediaUrl: ad && ad.mediaUrl,
    duration: ad && ad.duration,
    screenId: ad && ad.screenId,
    sourceType: ad && ad.sourceType,
    currentLayer: currentLayerId,
    nextLayer: nextLayerId,
  });
  dlog('[BIG DISPLAY DOM] current=', describe(currentLayer), 'next=', describe(nextLayer));
  try {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    dlog('[BIG DISPLAY] elementFromPoint(center) =', document.elementFromPoint(cx, cy)?.outerHTML?.slice(0, 120));
  } catch (e) { /* not fatal - diagnostics only */ }

  // Emergency invariant: the screen must never end up with every layer
  // hidden at once. If it ever does, log it loudly and force the layer
  // that actually has media (or the given "next"/current layer as a
  // last resort) back onto the screen immediately instead of leaving a
  // black frame up indefinitely.
  const layerA = document.getElementById('layer-a');
  const layerB = document.getElementById('layer-b');
  const isHidden = (el) => {
    if (!el) return true;
    const cs = window.getComputedStyle(el);
    return cs.display === 'none' || cs.opacity === '0' || cs.visibility === 'hidden';
  };
  if (isHidden(layerA) && isHidden(layerB)) {
    console.error('[BIG DISPLAY FATAL] BOTH LAYERS HIDDEN - self-healing now.');
    const target = (nextLayer && nextLayer.querySelector('img, video')) ? nextLayer
      : (currentLayer && currentLayer.querySelector('img, video')) ? currentLayer
      : (nextLayer || currentLayer || layerA);
    const other = target === layerA ? layerB : layerA;
    forceShowLayer(target, other);
  }
}

(async function init() {
  showLoader('Connecting Display');

  // Shared across the whole player session: browsers block unmuted
  // autoplay until the user has interacted with the page. Once that
  // interaction happens (tap on the sound control), every subsequent
  // video advertisement starts unmuted directly. Until then, video plays
  // muted so playback itself is never blocked.
  const audioState = { unlocked: false, current: null };

  function showSoundToggle() {
    const btn = document.getElementById('player-sound-toggle');
    if (btn) btn.style.display = 'inline-flex';
  }
  function hideSoundToggle() {
    const btn = document.getElementById('player-sound-toggle');
    if (btn) btn.style.display = 'none';
  }
  function wireSoundToggle() {
    const btn = document.getElementById('player-sound-toggle');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      audioState.unlocked = true;
      if (audioState.current) {
        audioState.current.muted = false;
        audioState.current.play().catch(() => {});
      }
      hideSoundToggle();
    });
  }

  const params = new URLSearchParams(window.location.search);
  const idFromURL = params.get('id');
  // Opt-in diagnostic logging for tracing a black/empty display: append
  // &debug=1 to the display URL. Off by default so normal operation stays
  // console-clean; nothing here is required for playback to work.
  const DEBUG = params.get('debug') === '1';
  const dlog = (...args) => { if (DEBUG) console.log(...args); };
  // Diagnostic-only: skips the fall animation and shows the first playable
  // ad's media immediately at full opacity/z-index. Never required for
  // normal playback - only useful to isolate "is this a media/URL problem
  // or a transition problem" per the debug runbook.
  const NO_TRANSITION = params.get('noTransition') === '1';

  const connectView = qs('#connect-view');
  const playerView = qs('#player-view');

  hideLoader();

  if (idFromURL) {
    startPlayer(idFromURL.toUpperCase());
  } else {
    connectView.style.display = 'flex';
  }

  qs('#connect-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = qs('#screen-id-input').value.trim().toUpperCase();
    if (!id) return;
    const errorEl = qs('#connect-error');
    try {
      await apiFetch(`/api/screens/${id}`);
    } catch (err) {
      if (errorEl) { errorEl.textContent = 'Invalid Screen ID'; errorEl.style.display = 'block'; }
      return;
    }
    window.location.search = `?id=${encodeURIComponent(id)}`;
  });

  async function startPlayer(screenId) {
    connectView.style.display = 'none';
    playerView.style.display = 'block';
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    dlog('[DISPLAY INIT] screenId =', screenId);

    let feed;
    try {
      feed = await apiFetch(`/api/display/${screenId}`);
    } catch (err) {
      renderStatus('Invalid Screen ID', err.message || `No display is registered with ID "${screenId}".`, 'error');
      return;
    }

    dlog('[DISPLAY ADS] count =', (feed.ads || []).length);
    (feed.ads || []).forEach((ad) => dlog('[DISPLAY AD]', {
      id: ad.id, screenId: ad.screenId, status: ad.status, sourceType: ad.sourceType,
      mediaType: ad.mediaType, mediaUrl: ad.mediaUrl, duration: ad.duration
    }));

    document.documentElement.requestFullscreen?.().catch(() => {});
    runLoop(feed);
  }

  function renderStatus(title, subtitle, variant = 'glass') {
    const layer = document.getElementById('status-overlay');
    const shell = document.getElementById('player-shell-root');
    const extra = variant === 'closed' ? `
      <div class="status-time-row">
        <div class="status-time-chip"><span class="status-time-label">Current Time</span><span class="status-time-value" id="status-current-time">${subtitle.currentTime || ''}</span></div>
        <div class="status-time-chip"><span class="status-time-label">Next Opening</span><span class="status-time-value" id="status-next-open">${subtitle.nextOpening || ''}</span></div>
      </div>
    ` : `<p>${subtitle}</p>`;
    const markup = `
      <div class="player-status">
        <div class="status-glass-orb">
          <div class="status-glass-ring"></div>
          <div class="status-glass-ring ring-2"></div>
          <div class="brand-mark"></div>
        </div>
        <h1 style="font-size:1.8rem;color:#ffffff;">${escapeHTML(title)}</h1>
        ${extra}
      </div>`;

    // If the persistent player shell exists, overlay the status on top of it
    // instead of tearing down the mounted overlay DOM (LIVE badge / QR).
    if (layer && shell) {
      layer.innerHTML = markup;
      layer.style.display = 'flex';
      shell.classList.add('status-active');
    } else {
      playerView.innerHTML = markup;
    }
  }

  function clearStatus() {
    const layer = document.getElementById('status-overlay');
    const shell = document.getElementById('player-shell-root');
    if (layer) { layer.style.display = 'none'; layer.innerHTML = ''; }
    if (shell) shell.classList.remove('status-active');
  }

  /**
   * =========================================================
   * CLOCK / WEATHER (Big Display liquid-glass overlay)
   * =========================================================
   *
   * Mounted exactly once per screen connection, from mountPlayerShell -
   * never from showFrame()/showFrameInner()/prepareMediaElement() or any
   * transition function, and never rebuilt on ad rotation. This state
   * object is what makes that safe to call more than once defensively:
   * initClockAndWeather() below always clears any interval it already
   * owns before creating a new one, so even if something upstream ever
   * called mountPlayerShell() twice for the same screen, this can't leak
   * a second ticking interval.
   */
  const clockWeatherState = {
    clockIntervalId: null,
    weatherIntervalId: null,
    initializedForScreenId: null,
    lastGoodWeather: null,
    // Browser-geolocation fallback (see resolveGeolocationOnce()) -
    // ONLY consulted when the screen itself has no configured lat/lng.
    // Resolved (or definitively failed) at most ONCE per page session -
    // never re-prompted on every ad transition or every poll.
    geoAttempted: false,
    geoCoords: null
  };

  /**
   * Browser-Geolocation fallback for weather location - PRIORITY 2,
   * after the screen's own configured lat/lng (PRIORITY 1, checked
   * server-side in weather.service.js). Called at most once per page
   * session, only when the server has just told us this screen has no
   * configured location (WEATHER_NOT_CONFIGURED) - never called
   * speculatively up front, so a screen that DOES have a configured
   * location never triggers a permission prompt at all.
   */
  function resolveGeolocationOnce() {
    if (clockWeatherState.geoAttempted) {
      return Promise.resolve(clockWeatherState.geoCoords);
    }
    clockWeatherState.geoAttempted = true;
    if (!('geolocation' in navigator)) {
      dlog('[BIG DISPLAY WEATHER] navigator.geolocation unavailable');
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clockWeatherState.geoCoords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          };
          dlog('[BIG DISPLAY WEATHER] resolved location via browser geolocation');
          resolve(clockWeatherState.geoCoords);
        },
        (err) => {
          // Permission denied, timeout, or position unavailable - all
          // handled the same way: no coords this session, weather block
          // just stays hidden (clock/ads/QR/transitions are all
          // completely unaffected either way).
          dlog('[BIG DISPLAY WEATHER] browser geolocation failed/denied', err && err.message);
          clockWeatherState.geoCoords = null;
          resolve(null);
        },
        { timeout: 10000, maximumAge: 30 * 60 * 1000 }
      );
    });
  }

  /*
   * One small inline SVG per animation category. Kept intentionally
   * tiny/subtle per the spec ("no excessive glow", "compact") - these are
   * meant to read at a glance, not compete with the advertisement for
   * attention. All animation is done with CSS (see pages.css
   * .player-liquid-clock-weather-icon[data-condition="..."] rules) so
   * swapping the icon is just an innerHTML + data-condition write, no
   * per-frame JS.
   */
  const WEATHER_ICONS = {
    clear: `
      <svg viewBox="0 0 24 24" class="wx-icon wx-icon--clear">
        <circle class="wx-sun-core" cx="12" cy="12" r="5" fill="#ffd166"/>
        <g class="wx-sun-rays" stroke="#ffd166" stroke-width="1.6" stroke-linecap="round">
          <line x1="12" y1="1.5" x2="12" y2="4.2"/>
          <line x1="12" y1="19.8" x2="12" y2="22.5"/>
          <line x1="1.5" y1="12" x2="4.2" y2="12"/>
          <line x1="19.8" y1="12" x2="22.5" y2="12"/>
          <line x1="4.4" y1="4.4" x2="6.3" y2="6.3"/>
          <line x1="17.7" y1="17.7" x2="19.6" y2="19.6"/>
          <line x1="4.4" y1="19.6" x2="6.3" y2="17.7"/>
          <line x1="17.7" y1="6.3" x2="19.6" y2="4.4"/>
        </g>
      </svg>`,
    'partly-cloudy': `
      <svg viewBox="0 0 24 24" class="wx-icon wx-icon--partly-cloudy">
        <circle class="wx-sun-core" cx="9" cy="9" r="4.2" fill="#ffd166"/>
        <path class="wx-cloud" d="M7 20a4.2 4.2 0 01-.6-8.36A5 5 0 0116.9 9.9 3.8 3.8 0 0116.2 20H7z" fill="#e7edf5"/>
      </svg>`,
    cloudy: `
      <svg viewBox="0 0 24 24" class="wx-icon wx-icon--cloudy">
        <path class="wx-cloud wx-cloud--back" d="M4 18.5a3.6 3.6 0 01.4-7.18 4.6 4.6 0 018.9-1.9 3.5 3.5 0 014.4 3.38 3.6 3.6 0 01-.4 7.2z" fill="#cbd5e1" opacity="0.85"/>
        <path class="wx-cloud" d="M6 20a4 4 0 01-.4-7.98A4.8 4.8 0 0115 10.4a3.6 3.6 0 013.6 3.6A4 4 0 0118 20z" fill="#eef2f7"/>
      </svg>`,
    fog: `
      <svg viewBox="0 0 24 24" class="wx-icon wx-icon--fog">
        <path class="wx-cloud" d="M6 12.5a3.6 3.6 0 01.4-7.16A4.6 4.6 0 0115.8 6.5a3.5 3.5 0 013 3.42 3.6 3.6 0 01-.4 2.58z" fill="#cbd5e1" opacity="0.8"/>
        <line class="wx-fog-band wx-fog-band--1" x1="3" y1="15.5" x2="21" y2="15.5" stroke="#e2e8f0" stroke-width="1.8" stroke-linecap="round"/>
        <line class="wx-fog-band wx-fog-band--2" x1="3" y1="19" x2="21" y2="19" stroke="#e2e8f0" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`,
    rain: `
      <svg viewBox="0 0 24 24" class="wx-icon wx-icon--rain">
        <path class="wx-cloud" d="M6 13a3.6 3.6 0 01.4-7.16A4.6 4.6 0 0115.8 7a3.5 3.5 0 013 3.42A3.6 3.6 0 0118.4 17H6.4z" fill="#cbd5e1"/>
        <g class="wx-rain-drops" stroke="#7cc4ff" stroke-width="1.7" stroke-linecap="round">
          <line class="wx-drop wx-drop--1" x1="8" y1="17" x2="7" y2="21"/>
          <line class="wx-drop wx-drop--2" x1="12" y1="17" x2="11" y2="21"/>
          <line class="wx-drop wx-drop--3" x1="16" y1="17" x2="15" y2="21"/>
        </g>
      </svg>`,
    'heavy-rain': `
      <svg viewBox="0 0 24 24" class="wx-icon wx-icon--heavy-rain">
        <path class="wx-cloud" d="M5 12.5a3.6 3.6 0 01.4-7.16A4.6 4.6 0 0114.8 6.5a3.5 3.5 0 013 3.42A3.6 3.6 0 0117.4 16.5H5.4z" fill="#b9c4d1"/>
        <g class="wx-rain-drops wx-rain-drops--heavy" stroke="#4fa3f0" stroke-width="1.8" stroke-linecap="round">
          <line class="wx-drop wx-drop--1" x1="6.5" y1="16.5" x2="5.2" y2="21.5"/>
          <line class="wx-drop wx-drop--2" x1="10" y1="16.5" x2="8.7" y2="21.5"/>
          <line class="wx-drop wx-drop--3" x1="13.5" y1="16.5" x2="12.2" y2="21.5"/>
          <line class="wx-drop wx-drop--4" x1="17" y1="16.5" x2="15.7" y2="21.5"/>
        </g>
      </svg>`,
    thunderstorm: `
      <svg viewBox="0 0 24 24" class="wx-icon wx-icon--thunderstorm">
        <path class="wx-cloud" d="M5 12a3.6 3.6 0 01.4-7.16A4.6 4.6 0 0114.8 6a3.5 3.5 0 013 3.42A3.6 3.6 0 0117.4 16H5.4z" fill="#9aa7b6"/>
        <g class="wx-rain-drops" stroke="#6fb3f2" stroke-width="1.6" stroke-linecap="round">
          <line class="wx-drop wx-drop--1" x1="7" y1="16" x2="6" y2="19.5"/>
          <line class="wx-drop wx-drop--3" x1="15" y1="16" x2="14" y2="19.5"/>
        </g>
        <path class="wx-bolt" d="M12.6 13.2l-3 5.2h2.1l-1.1 4.6 3.7-5.8h-2.1z" fill="#ffe066"/>
      </svg>`,
    snow: `
      <svg viewBox="0 0 24 24" class="wx-icon wx-icon--snow">
        <path class="wx-cloud" d="M6 13a3.6 3.6 0 01.4-7.16A4.6 4.6 0 0115.8 7a3.5 3.5 0 013 3.42A3.6 3.6 0 0118.4 17H6.4z" fill="#dce4ee"/>
        <g class="wx-snow-flakes" fill="#f4f9ff">
          <circle class="wx-flake wx-flake--1" cx="8" cy="18" r="1.15"/>
          <circle class="wx-flake wx-flake--2" cx="12.5" cy="19.5" r="1.15"/>
          <circle class="wx-flake wx-flake--3" cx="16" cy="18" r="1.15"/>
        </g>
      </svg>`
  };

  function renderClock() {
    const timeEl = document.getElementById('player-liquid-clock-time');
    const dateEl = document.getElementById('player-liquid-clock-date');
    if (!timeEl) return;
    // Intentionally the BROWSER's own local time, not a server-side
    // timezone lookup: the Big Display's browser runs physically on the
    // device sitting at that location, so its local clock/timezone IS the
    // display's true local time - reading it needs no location plumbing
    // at all and, unlike a single app-wide admin "timezone" setting
    // (see settings.json), it's automatically correct even for a
    // multi-city fleet of screens where each one is somewhere different.
    const now = new Date();
    const label = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (timeEl.textContent !== label) timeEl.textContent = label;
    if (dateEl) {
      // e.g. "Thu, 03 Sep 2026" - date only needs updating once a minute
      // in practice, but this runs on the same 1s tick as the time for
      // simplicity; the textContent check below keeps it a no-op DOM
      // write for 59 out of every 60 calls.
      const day = now.toLocaleDateString([], { weekday: 'short' });
      const dom = String(now.getDate()).padStart(2, '0');
      const month = now.toLocaleDateString([], { month: 'short' });
      const year = now.getFullYear();
      const dateLabel = `${day}, ${dom} ${month} ${year}`;
      if (dateEl.textContent !== dateLabel) dateEl.textContent = dateLabel;
    }
  }

  function renderWeather(weather) {
    const wrap = document.getElementById('player-liquid-clock-weather');
    const iconEl = document.getElementById('player-liquid-clock-weather-icon');
    const tempEl = document.getElementById('player-liquid-clock-weather-temp');
    const labelEl = document.getElementById('player-liquid-clock-weather-label');
    if (!wrap || !iconEl || !tempEl || !labelEl) return;

    if (!weather || typeof weather.tempC !== 'number' || !weather.category) {
      // No valid reading yet (e.g. this screen has no lat/lng configured,
      // or the very first fetch hasn't resolved) - never show
      // undefined/NaN/null, just keep the compact clock-only state.
      wrap.hidden = true;
      return;
    }

    if (iconEl.dataset.condition !== weather.category) {
      iconEl.dataset.condition = weather.category;
      iconEl.innerHTML = WEATHER_ICONS[weather.category] || WEATHER_ICONS.cloudy;
    }
    tempEl.textContent = `${weather.tempC}\u00b0C`;
    labelEl.textContent = weather.condition || '';
    wrap.hidden = false;
  }

  async function fetchWeatherOnce(screenId, isGeoRetry = false) {
    try {
      // apiFetch throws on non-2xx (404/502 from weather.controller.js);
      // the WEATHER_NOT_CONFIGURED case is a 200 with ok:false instead
      // (see weather.controller.js), so both paths are handled here.
      let url = `/api/weather/${encodeURIComponent(screenId)}`;
      if (clockWeatherState.geoCoords) {
        // Only ever a FALLBACK - weather.service.js still prefers the
        // screen's own configured lat/lng over this when present.
        url += `?lat=${encodeURIComponent(clockWeatherState.geoCoords.lat)}&lng=${encodeURIComponent(clockWeatherState.geoCoords.lng)}`;
      }
      const data = await apiFetch(url);
      if (data && data.ok && data.weather) {
        clockWeatherState.lastGoodWeather = data.weather;
        renderWeather(data.weather);
        if (typeof data.refreshMs === 'number' && data.refreshMs > 0) {
          scheduleWeatherPoll(screenId, data.refreshMs);
        }
        return;
      }

      if (data && data.code === 'WEATHER_NOT_CONFIGURED' && !isGeoRetry && !clockWeatherState.geoAttempted) {
        // PRIORITY 2: this screen has no configured location - try the
        // browser's own geolocation exactly once this session, then
        // retry the fetch a single time with whatever it resolved (or
        // gives up gracefully if permission is denied/unavailable).
        const coords = await resolveGeolocationOnce();
        if (coords) {
          await fetchWeatherOnce(screenId, true);
          return;
        }
      }

      // WEATHER_NOT_CONFIGURED with no geolocation available either, or
      // any other explicit ok:false - keep showing whatever we already
      // had (possibly nothing yet). Never blocks the clock/ads/QR.
      renderWeather(clockWeatherState.lastGoodWeather);
    } catch (err) {
      // Network/5xx failure - never blank the display or show broken
      // data; keep the last known-good reading exactly as-is.
      dlog('[BIG DISPLAY WEATHER] fetch failed, keeping last known value', err);
      renderWeather(clockWeatherState.lastGoodWeather);
    }
  }

  function scheduleWeatherPoll(screenId, intervalMs) {
    if (clockWeatherState.weatherIntervalId) {
      clearInterval(clockWeatherState.weatherIntervalId);
    }
    clockWeatherState.weatherIntervalId = setInterval(() => fetchWeatherOnce(screenId), intervalMs);
  }

  /** Mounted once from mountPlayerShell(); safe to call defensively more than once. */
  function initClockAndWeather(screen) {
    if (clockWeatherState.clockIntervalId) {
      clearInterval(clockWeatherState.clockIntervalId);
    }
    renderClock();
    clockWeatherState.clockIntervalId = setInterval(renderClock, 1000);

    const screenId = screen ? screen.id : null;
    if (!screenId) return;

    if (clockWeatherState.initializedForScreenId === screenId && clockWeatherState.weatherIntervalId) {
      // Already polling weather for this exact screen - don't start a
      // second independent poll loop on top of it.
      return;
    }
    clockWeatherState.initializedForScreenId = screenId;
    fetchWeatherOnce(screenId);
    // Fallback cadence until the first real response tells us the
    // server's configured refresh interval (scheduleWeatherPoll above
    // reschedules to that value once known).
    scheduleWeatherPoll(screenId, 15 * 60 * 1000);
  }

  /**
   * Mounted exactly once per screen connection. The LIVE badge, brand,
   * place text, and QR code live here permanently — subsequent state
   * changes (closed/open, ads arriving/emptying, place renamed) update
   * this DOM in place and never rebuild it, so the overlay never flickers
   * or disappears while the player is running.
   */
  function mountPlayerShell(config, screen) {
    const place = screen ? screen.place : '';
    // QR_VIDEO_DEMO_MODE / QR_DESTINATION_URL are declared at the top of
    // this file. Resolve the actual destination once per mount and
    // generate a REAL, scannable QR (see qr-code.js - vendored,
    // client-side, no screenshot/PNG-API/placeholder) fresh from it.
    const qrDestination = QR_DESTINATION_URL || config.siteUrl || window.location.origin;
    let qrSvgMarkup = '';
    try {
      qrSvgMarkup = generateQRSvgMarkup(qrDestination);
    } catch (err) {
      dlog('[QR WALKER] QR generation failed', err);
    }
    playerView.innerHTML = `
      <div class="player-shell" id="player-shell-root">
        <div class="lumen-player-perspective">
        <div class="player-media-layer lumen-player-page active" id="layer-a"></div>
        <div class="player-media-layer lumen-player-page" id="layer-b"></div>
        </div>
        <div class="player-transition-canvas" id="bas-canvas-container"></div>
        <div class="player-transition-veil" id="veil"></div>

        <!-- Minimal TV-safe overlay (Top-Left): mounted once, never rebuilt -->
        <div class="player-header" id="player-header">
          <span class="player-live-badge"><span class="player-live-dot"></span>LIVE</span>
          <span class="player-header-divider"></span>
          <span class="player-header-brand">LUMEN DIGITAL ADS</span>
          <span class="player-header-divider" id="player-header-place-divider" style="${place ? '' : 'display:none;'}"></span>
          <span class="player-header-place" id="player-header-place" title="${escapeHTML(place)}" style="${place ? '' : 'display:none;'}">${place ? '\u{1F4CD} ' + escapeHTML(place) : ''}</span>
        </div>

        <!-- Liquid-glass clock/weather (Top-Right): mounted once, never
             rebuilt by ad rotation. Sibling to the media layers/transition
             canvas, not inside them, so it never participates in any
             transition and can never be covered by one (see z-index in
             pages.css - this sits above .player-transition-canvas). -->
        <div class="player-liquid-clock" id="player-liquid-clock">
          <div class="player-liquid-clock-card">
            <div class="player-liquid-clock-time" id="player-liquid-clock-time">--:--</div>
            <div class="player-liquid-clock-date" id="player-liquid-clock-date"></div>
            <div class="player-liquid-clock-weather" id="player-liquid-clock-weather" hidden>
              <span class="player-liquid-clock-weather-icon" id="player-liquid-clock-weather-icon" aria-hidden="true"></span>
              <span class="player-liquid-clock-weather-temp" id="player-liquid-clock-weather-temp"></span>
              <span class="player-liquid-clock-weather-label" id="player-liquid-clock-weather-label"></span>
            </div>
          </div>
        </div>

        <!-- QR video walker (place/pickup): mounted once as a sibling
             of the QR card, never rebuilt. Two <video> elements are
             injected into this container by qr-video-walker.js; it
             never touches the QR card's own DOM. -->
        <div class="qr-video-overlay" id="qr-video-overlay" aria-hidden="true"></div>

        <!-- QR advertisement (Bottom-Right): mounted once, never rebuilt.
             Design matches the supplied reference screenshot: dark card,
             green->blue gradient-framed QR on the left, "Learn more
             about us." heading + green "scan here" CTA on the right.
             The QR itself is real, scannable SVG (see qr-code.js), not
             a screenshot or API-fetched PNG. -->
<div class="player-qr" id="player-qr">
  <div class="player-qr-card">
    <div class="player-qr-code" id="player-qr-code">${qrSvgMarkup}</div>
    <div class="player-qr-info">
      <p class="player-qr-heading">Learn more<br>about us.</p>
      <div class="player-qr-cta"><span class="player-qr-cta-arrow" aria-hidden="true">&#8592;</span><span>scan here</span></div>
    </div>
  </div>
</div>

        <!-- Sound unlock control: browsers block unmuted autoplay without a
             user gesture. Hidden by default; shown only when a video
             advertisement actually attempted and failed unmuted playback,
             so we never claim audio works when it doesn't. -->
        <button type="button" class="player-sound-toggle" id="player-sound-toggle" style="display:none;" aria-label="Enable advertisement audio">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M17 8a5 5 0 010 8M19.5 5.5a9 9 0 010 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          Tap for sound
        </button>

        <!-- Status layer: shown/hidden on top of the persistent shell, never replaces it -->
        <div class="status-overlay" id="status-overlay" style="display:none;"></div>
      </div>`;
    wireSoundToggle();
    initClockAndWeather(screen);
    const walkerEl = document.getElementById('qr-video-overlay');
    // QR_VIDEO_DEMO_MODE (declared at the top of this file) gates the
    // walker itself here so the flag actually does something concrete:
    // true (default) = always run, exactly like today; flip to false to
    // disable the walker outright (the QR card itself still renders
    // either way - only the video overlay is gated).
    if (walkerEl && QR_VIDEO_DEMO_MODE) initQRVideoWalker(walkerEl, { qrDestination });
  }

  /** Updates the place text in place without touching any other overlay DOM. */
  function updateHeaderPlace(place) {
    const textEl = document.getElementById('player-header-place');
    const dividerEl = document.getElementById('player-header-place-divider');
    if (!textEl || !dividerEl) return;
    const next = place ? `\u{1F4CD} ${place}` : '';
    if (textEl.textContent !== next) {
      textEl.textContent = next;
      textEl.title = place || '';
    }
    textEl.style.display = place ? '' : 'none';
    dividerEl.style.display = place ? '' : 'none';
  }

  /**
   * Builds the media DOM for an ad and returns it immediately (synchronous
   * except for the browser's own decode/network work, which continues in
   * the background). Callers append the fragment to the next layer and
   * start the existing transition right away — media readiness happens
   * *during* that transition instead of being awaited before it, so no
   * extra visible delay is ever inserted and the transition's own
   * duration is never touched.
   */
  function prepareMediaElement(ad) {
    const fragment = document.createElement('div');
    fragment.style.width = '100%';
    fragment.style.height = '100%';
    fragment.style.position = 'relative';

    // Reset the (single, shared, not-per-ad) sound toggle for every new ad
    // up front. It's re-shown below only if THIS ad's own audio actually
    // needs it - otherwise a video->video pair where the earlier ad had
    // blocked autoplay (toggle showing) but the new one autoplays fine
    // would leave a stale "Tap for sound" button sitting over it.
    hideSoundToggle();

    const backdrop = document.createElement('div');
    backdrop.className = 'player-backdrop';

    const overlay = document.createElement('div');
    overlay.className = 'player-backdrop-overlay';

    const content = document.createElement('div');
    content.className = 'player-media-content';

    // Resolve to an absolute URL against the page's own origin. The API
    // already returns an absolute http(s) mediaUrl (see resolveMediaUrl on
    // the backend), but resolving again here is a free safety net if that
    // ever regresses to a root-relative path.
    const resolvedUrl = new URL(ad.mediaUrl, window.location.origin).href;

    if (ad.mediaType === 'image') {
      const bgImg = new Image();
      bgImg.className = 'player-backdrop-media';
      // Backdrop starts invisible and fades in only once genuinely decoded
      // - this is a structural guarantee, independent of any transition
      // engine's own timing/wait logic, that the backdrop can never show a
      // stale previous-ad color: worst case it's briefly transparent
      // (revealing the neutral dark player-shell background) instead of
      // visibly wrong, then fades to the correct backdrop the instant it's
      // ready. Real recorded evidence showed a second, independently-
      // decoding backdrop <img> can lag the sharp foreground by several
      // hundred ms even for the same URL; this makes that lag invisible
      // instead of trying to out-guess its timing with a longer wait.
      bgImg.style.opacity = '0';
      bgImg.style.transition = 'opacity 220ms ease';
      bgImg.addEventListener('load', () => { bgImg.style.opacity = '1'; });
      // NOTE: deliberately no crossOrigin attribute. This media is same-
      // origin (mediaUrl always resolves to this same host - see
      // resolveMediaUrl on the backend), so WebGL texture uploads for the
      // particle transition (particle-transition.js) work without CORS
      // configuration. Setting crossorigin="anonymous" here would only add
      // a way for the image to fail to load (any redirect hop or proxy
      // that doesn't echo back an exact Access-Control-Allow-Origin match
      // silently blanks the <img>) for zero benefit on a same-origin URL.
      bgImg.src = resolvedUrl;

      const fgImg = new Image();
      fgImg.className = 'player-foreground-media';
      fgImg.src = resolvedUrl;
      fgImg.alt = formatScreenLabel(ad.screenId) || 'Advertisement';
      // Previously no error handler existed at all here - a broken/404
      // mediaUrl would fail completely silently: no console output, no
      // visual indicator, just an empty transparent <img> sitting in an
      // otherwise-correctly-visible layer, which looks exactly like "ads
      // not showing" with no clue why.
      fgImg.addEventListener('load', () => dlog('[BIG DISPLAY IMAGE LOADED]', { adId: ad.id, url: fgImg.currentSrc || fgImg.src, width: fgImg.naturalWidth, height: fgImg.naturalHeight }));
      fgImg.addEventListener('error', (event) => {
        console.error('[BIG DISPLAY IMAGE ERROR]', { adId: ad.id, url: resolvedUrl, event });
        if (DEBUG) {
          fetch(resolvedUrl, { method: 'HEAD' })
            .then((r) => renderMediaDebugOverlay({ screenId: ad.screenId, adsCount: '?', ad, mediaUrl: resolvedUrl, httpState: `${r.status} ${r.ok ? 'VALID' : 'INVALID'}`, error: 'image failed to decode/load in <img>' }))
            .catch((e) => renderMediaDebugOverlay({ screenId: ad.screenId, adsCount: '?', ad, mediaUrl: resolvedUrl, httpState: 'INVALID (fetch failed)', error: String(e) }));
        }
      });
      // Decoding happens in the background; we don't wait on it. Most ad
      // images are already warm in the browser cache from a prior round.
      if (fgImg.decode) fgImg.decode().catch(() => {});

      backdrop.appendChild(bgImg);
      backdrop.appendChild(overlay);
      content.appendChild(fgImg);
      fragment.appendChild(backdrop);
      fragment.appendChild(content);

      audioState.current = null;
      return { fragment, type: 'image' };
    }

    const bgVideo = document.createElement('video');
    bgVideo.className = 'player-backdrop-media';
    // Same structural guarantee as the image branch above: never show a
    // stale-colored backdrop, ever - start transparent, fade in once this
    // specific video element has actually decoded a frame.
    bgVideo.style.opacity = '0';
    bgVideo.style.transition = 'opacity 220ms ease';
    bgVideo.addEventListener('loadeddata', () => { bgVideo.style.opacity = '1'; });
    bgVideo.muted = true; // backdrop is a decorative blurred duplicate — always silent
    bgVideo.playsInline = true;
    bgVideo.preload = 'auto';

    const fgVideo = document.createElement('video');
    fgVideo.className = 'player-foreground-media';
    fgVideo.src = resolvedUrl;
    // Same as the image case above - previously silent on failure. A
    // broken/unreachable video URL, wrong MIME type, or unsupported codec
    // would otherwise fail with zero feedback anywhere.
    fgVideo.addEventListener('loadeddata', () => dlog('[BIG DISPLAY VIDEO LOADED]', { adId: ad.id, url: fgVideo.currentSrc || fgVideo.src, duration: fgVideo.duration }));
    fgVideo.addEventListener('error', () => {
      console.error('[BIG DISPLAY VIDEO ERROR]', { url: resolvedUrl, adId: ad.id, type: 'video', error: fgVideo.error });
      if (DEBUG) {
        fetch(resolvedUrl, { method: 'HEAD' })
          .then((r) => renderMediaDebugOverlay({ screenId: ad.screenId, adsCount: '?', ad, mediaUrl: resolvedUrl, httpState: `${r.status} ${r.ok ? 'VALID' : 'INVALID'}`, error: fgVideo.error ? `code ${fgVideo.error.code}` : 'unknown' }))
          .catch((e) => renderMediaDebugOverlay({ screenId: ad.screenId, adsCount: '?', ad, mediaUrl: resolvedUrl, httpState: 'INVALID (fetch failed)', error: String(e) }));
      }
    });
    fgVideo.playsInline = true;
    fgVideo.preload = 'auto';
    audioState.current = fgVideo;

    /*
     * FOUND BUG ("video lag" - confirmed against the uploaded recording
     * with freezedetect/scene-score: multi-second runs of pixel-identical
     * frames well outside any transition window):
     *
     * bgVideo and fgVideo used to each carry their own
     * `src = resolvedUrl`. That's two independent <video> elements each
     * opening their own network fetch and running their own decode
     * pipeline for the *same* video, playing at the same time, for every
     * single video ad. On constrained bandwidth or modest signage
     * hardware that's roughly double the network/decode cost of what's
     * actually needed to show one video - a very plausible, and here
     * measured, source of mid-playback stalling.
     *
     * Fix: only fgVideo actually fetches/decodes the source.
     * captureStream() exposes its already-decoded frames as a
     * MediaStream, and bgVideo just mirrors that stream instead of
     * decoding a second independent copy. This is standard in
     * Chromium-based browsers (what signage/kiosk displays almost always
     * run), so it's used whenever available, with the previous dual-src
     * behavior kept as a fallback for browsers without captureStream.
     */
    let backdropMirrorsForeground = false;
    if (typeof fgVideo.captureStream === 'function') {
      try {
        const sharedStream = fgVideo.captureStream();
        bgVideo.srcObject = sharedStream;
        backdropMirrorsForeground = true;
      } catch (err) {
        dlog('[BIG DISPLAY VIDEO] captureStream backdrop-sharing failed, falling back to dual-src', err);
      }
    }
    if (!backdropMirrorsForeground) {
      bgVideo.src = resolvedUrl;
    }

    // Keep backdrop video in sync with foreground video.
    fgVideo.addEventListener('play', () => bgVideo.play().catch(() => {}));
    fgVideo.addEventListener('pause', () => bgVideo.pause());
    if (!backdropMirrorsForeground) {
      // Only meaningful when bgVideo is decoding its own independent copy
      // of the source - a MediaStream-backed <video> has no seekable
      // timeline of its own to re-sync (it just mirrors whatever frames
      // fgVideo is currently decoding), so setting currentTime on it in
      // that mode would be a no-op at best.
      fgVideo.addEventListener('seeking', () => { bgVideo.currentTime = fgVideo.currentTime; });
    }

    backdrop.appendChild(bgVideo);
    backdrop.appendChild(overlay);
    content.appendChild(fgVideo);
    fragment.appendChild(backdrop);
    fragment.appendChild(content);

    // Audio strategy: genuinely attempt unmuted autoplay first (not muted-
    // then-unmute) - if the kiosk browser's autoplay policy allows sound
    // without a user gesture, audio starts immediately with no click. If
    // the browser rejects it (the common case for a fresh, un-interacted
    // page), fall back to muted playback so the video still displays -
    // audio failure must never block or hide the video itself.
    fgVideo.volume = 1;
    fgVideo.muted = false;
    const attemptAudio = async () => {
      dlog('[BIG DISPLAY AUDIO] attempting unmuted autoplay');
      try {
        await fgVideo.play();
        dlog('[BIG DISPLAY AUDIO] unmuted autoplay SUCCESS');
      } catch (error) {
        console.warn('[BIG DISPLAY AUDIO] unmuted autoplay BLOCKED', error);
        fgVideo.muted = true;
        try {
          await fgVideo.play();
        } catch (fallbackError) {
          console.error('[BIG DISPLAY AUDIO] muted playback FAILED', fallbackError);
          // fgVideo.play() is async and can resolve/reject well after this
          // exact ad has already been superseded by a later one (video ads
          // can be short, and this whole chain can take a beat on a slow
          // autoplay-policy check). Without this guard, a late rejection
          // here could call showSoundToggle() - a single element shared by
          // the whole player, not recreated per ad - and leave a "Tap for
          // sound" button floating on top of whatever unrelated ad (image
          // or video) is on screen by the time this microtask finally runs.
          if (fgVideo.isConnected) showSoundToggle();
          return;
        }
        // Muted playback succeeded - offer a one-tap way to turn sound on,
        // since the browser only blocked the *automatic* unmuted attempt,
        // not sound entirely. Same staleness guard as above.
        if (fgVideo.isConnected) showSoundToggle();
      }
    };
    // Fired before/during the transition, not after - matches "prepare the
    // next video during the transition" rather than waiting for it to end.
    attemptAudio();
    bgVideo.play().catch(() => {});

    return { fragment, type: 'video', mainVideo: fgVideo, bgVideo };
  }

  function runLoop(initialFeed) {
    let screen = initialFeed.screen;
    let ads = initialFeed.ads || [];
    let status = initialFeed.status || { isOpen: true };
    let config = initialFeed.config || {};

    let index = 0;
    let introPending = true; // show the Lumen brand intro at the start of every round
    let activeLayer = 'a'; // 'a' or 'b'
    let mediaTimer = null;
    let closedMode = false;
    let stopWatch = null;
    let currentSingleAdId = null;
    let lastAdMediaType = null; // tracks what's currently showing, for transition routing

    mountPlayerShell(config, screen);
    let lastPlace = screen ? screen.place : '';

    // Warm cache for all ads
    function preloadAll() {
      ads.forEach(ad => {
        if (ad.mediaType === 'image') {
          const img = new Image();
          img.src = ad.mediaUrl;
        } else {
          const vid = document.createElement('video');
          vid.preload = 'auto';
          vid.src = ad.mediaUrl;
        }
      });
    }
    preloadAll();

    async function refreshFeed() {
      try {
        const fresh = await apiFetch(`/api/display/${screen.id}`);
        screen = fresh.screen;
        ads = fresh.ads || [];
        status = fresh.status || { isOpen: true };
        config = fresh.config || {};
        const nextPlace = screen ? screen.place : '';
        if (nextPlace !== lastPlace) {
          lastPlace = nextPlace;
          updateHeaderPlace(nextPlace);
        }
      } catch (err) {
        // Keep playing cached ads if network dips briefly
      }
    }

    async function showFrame() {
      try {
        await showFrameInner();
      } catch (err) {
        // Nothing inside showFrameInner should be able to throw uncaught
        // (see the try/catch around the transition pipeline above), but
        // this outer guard exists so that IF something unforeseen does
        // throw, the loop retries instead of silently dying and leaving
        // whatever was on screen frozen forever.
        console.error('[DISPLAY] showFrame failed unexpectedly, retrying shortly', err);
        clearTimeout(mediaTimer);
        mediaTimer = setTimeout(() => { refreshFeed().then(showFrame); }, 3000);
      }
    }

    async function showFrameInner() {
      if (!status.isOpen) {
        if (!closedMode) {
          closedMode = true;
          currentSingleAdId = null;
          clearTimeout(mediaTimer);
          renderStatus('Display Closed', status, 'closed');
        }
        mediaTimer = setTimeout(async () => { await refreshFeed(); showFrame(); }, 10000);
        return;
      }

      if (closedMode) {
        closedMode = false;
        clearStatus();
      }

      if (!ads.length) {
        currentSingleAdId = null;
        dlog('[DISPLAY ADS] count = 0 - showing "Waiting For Advertisements" fallback, not a black screen.');
        renderStatus('Waiting For Advertisements', `${screen.place} has no active campaigns right now.`);
        mediaTimer = setTimeout(async () => { await refreshFeed(); if (ads.length) clearStatus(); showFrame(); }, 5000);
        return;
      }

      // ONE ADVERTISEMENT: Loop continuously without flicker or DOM re-creations
      if (ads.length === 1) {
        const singleAd = ads[0];
        if (currentSingleAdId === singleAd.id) {
          mediaTimer = setTimeout(async () => { await refreshFeed(); showFrame(); }, 10000);
          return;
        }
        dlog('[DISPLAY RENDER] Rendering ad =', singleAd.id, singleAd.mediaUrl);
        currentSingleAdId = singleAd.id;
        lastAdMediaType = singleAd.mediaType;
        const currentLayerEl = document.getElementById('layer-a');
        const otherLayerEl = document.getElementById('layer-b');
        if (currentLayerEl) {
          try {
            const prepared = prepareMediaElement(singleAd);
            if (prepared.type === 'video') {
              if (prepared.mainVideo) prepared.mainVideo.loop = true;
              if (prepared.bgVideo) prepared.bgVideo.loop = true;
            }
            // Same as runFallTransition's cleanup: pause/detach any
            // previous <video> before wiping it out, so swapping the
            // single ad can't leave its old audio track playing.
            stopLayerMedia(currentLayerEl);
            currentLayerEl.innerHTML = '';
            currentLayerEl.appendChild(prepared.fragment);
            currentLayerEl.classList.add('active');
            // Belt-and-suspenders: the class + fragment above should be
            // sufficient, but if any inline style was left over from a
            // prior forceShowLayer() call (e.g. opacity/display set
            // directly), it wins the cascade over the .active class rule.
            // Clear any stale inline overrides so the CSS class is what
            // actually controls visibility here.
            currentLayerEl.style.display = '';
            currentLayerEl.style.opacity = '';
            currentLayerEl.style.zIndex = '';
            dlog('[DISPLAY VISIBLE] ad =', singleAd.id);
          } catch (err) {
            // Media construction must never be able to leave the display
            // black - force the layer visible even if something inside
            // prepareMediaElement() threw unexpectedly.
            console.error('[DISPLAY] single-ad render failed, forcing layer visible', err);
            forceShowLayer(currentLayerEl, otherLayerEl);
          }
        }
        if (DEBUG) {
          logRenderDiagnostics(dlog, {
            ad: singleAd,
            currentLayer: currentLayerEl,
            nextLayer: currentLayerEl,
            currentLayerId: 'layer-a',
            nextLayerId: 'layer-a',
          });
        }
        mediaTimer = setTimeout(async () => { await refreshFeed(); showFrame(); }, 10000);
        return;
      }

      // MULTIPLE ADVERTISEMENTS: Rotate seamlessly
      // Big display does NOT show Lumen intro - that's only for small network previews.
      // The big display shows ads continuously without branding interruptions.
      currentSingleAdId = null;
      introPending = false; // disabled for big display

      if (index >= ads.length) index = 0;
      const ad = ads[index];
      const nextAd = ads[(index + 1) % ads.length];

      dlog('[DISPLAY RENDER] Rendering ad =', ad.id, ad.mediaUrl);

      const currentId = activeLayer === 'a' ? 'layer-a' : 'layer-b';
      const nextId = activeLayer === 'a' ? 'layer-b' : 'layer-a';
      const currentLayer = document.getElementById(currentId);
      const nextLayer = document.getElementById(nextId);
      const canvasContainer = document.getElementById('bas-canvas-container');

      if (!nextLayer) return;

      /*
       * ============================================================
       * BIG DISPLAY TRANSITION PIPELINE
       * ============================================================
       *
       * IMAGE -> IMAGE:
       *   particle-transition.js
       *
       * IMAGE -> VIDEO:
       * VIDEO -> IMAGE:
       * VIDEO -> VIDEO:
       *   turbulent-dissolve.js
       *
       * IMPORTANT:
       * The incoming layer must remain hidden until the transition
       * engine performs the visual handoff.
       */

      let prepared = null;

      try {
        /*
         * ----------------------------------------------------------
         * 1. Prepare incoming media
         * ----------------------------------------------------------
         */
        prepared = prepareMediaElement(ad);

        /*
         * ----------------------------------------------------------
         * 2. Mount incoming media in the inactive layer
         * ----------------------------------------------------------
         */
        nextLayer.innerHTML = '';

        nextLayer.className =
          'player-media-layer lumen-player-page';

        nextLayer.appendChild(prepared.fragment);

        /*
         * Incoming layer MUST NOT be visible before transition.
         */
        nextLayer.classList.remove(
          'active',
          'lumen-player-page-fall',
          'lumen-player-page-fall-in'
        );

        nextLayer.classList.add('no-anim');

        nextLayer.style.display = 'flex';
        nextLayer.style.visibility = 'hidden';
        nextLayer.style.opacity = '0';
        nextLayer.style.pointerEvents = 'none';
        nextLayer.style.zIndex = '-1';

        /*
         * Force browser to commit hidden state.
         */
        void nextLayer.offsetWidth;

        /*
         * ----------------------------------------------------------
         * 3. Determine outgoing/incoming media types
         * ----------------------------------------------------------
         */
        const outgoingType = lastAdMediaType;
        const incomingType = ad.mediaType;

        /*
         * Any transition involving video uses the turbulent
         * dissolve engine.
         *
         * Pure image -> image uses particle transition.
         */
        const useDissolve =
          outgoingType === 'video' ||
          incomingType === 'video';

        dlog(
          '[DISPLAY TRANSITION]',
          outgoingType || '(initial)',
          '->',
          incomingType,
          'ENGINE:',
          useDissolve
            ? 'TURBULENT DISSOLVE'
            : 'PARTICLE'
        );

        /*
         * ----------------------------------------------------------
         * 4. Run transition
         * ----------------------------------------------------------
         */
        if (NO_TRANSITION || !outgoingType) {

          /*
           * Diagnostic mode, OR this is the very first ad shown this
           * session (outgoingType is null - nothing has ever been
           * rendered into the "current" layer yet). Both transition
           * engines assume a real outgoing frame to transition FROM;
           * particle-transition.js explicitly throws if asked to run
           * without one ("particle transition requires IMAGE -> IMAGE").
           * With no prior ad, there is nothing to transition from, so
           * just reveal the incoming layer directly.
           */
          forceShowLayer(
            nextLayer,
            currentLayer
          );

        } else if (useDissolve) {

          /*
           * IMAGE -> VIDEO
           * VIDEO -> IMAGE
           * VIDEO -> VIDEO
           *
           * The turbulent engine controls the visual reveal.
           */
          await runTurbulentDissolve({
            currentLayer,
            nextLayer,
            durationMs: 1800,
            dlog
          });

        } else {

          /*
           * IMAGE -> IMAGE
           *
           * Keep particle transition completely separate.
           */
          await runParticleTransition({
            currentLayer,
            nextLayer,
            durationMs: 3000,
            dlog
          });
        }

        /*
         * The transition engine has completed.
         */
        dlog(
          '[DISPLAY VISIBLE] transition completed',
          {
            adId: ad.id,
            from: outgoingType,
            to: incomingType
          }
        );

      } catch (err) {

        /*
         * ----------------------------------------------------------
         * TRANSITION ERROR
         * ----------------------------------------------------------
         *
         * IMPORTANT:
         * Do NOT reveal the incoming ad here.
         *
         * The old implementation called forceShowLayer(nextLayer,
         * currentLayer), which could make the new ad suddenly appear
         * on top of the old one.
         *
         * Keep the currently visible ad on screen instead.
         */
        console.error(
          '[DISPLAY TRANSITION ERROR]',
          {
            adId: ad.id,
            outgoingType: lastAdMediaType,
            incomingType: ad.mediaType,
            error: err
          }
        );

        /*
         * Stop any video that belongs to the failed incoming layer.
         */
        stopLayerMedia(nextLayer);

        /*
         * Completely hide the failed incoming layer.
         */
        nextLayer.classList.remove(
          'active',
          'no-anim',
          'lumen-player-page-fall',
          'lumen-player-page-fall-in'
        );

        nextLayer.style.display = 'none';
        nextLayer.style.visibility = 'hidden';
        nextLayer.style.opacity = '0';
        nextLayer.style.pointerEvents = 'none';
        nextLayer.style.zIndex = '-1';

        nextLayer.innerHTML = '';

        /*
         * Restore outgoing layer.
         */
        currentLayer.classList.add('active');

        currentLayer.style.display = 'flex';
        currentLayer.style.visibility = 'visible';
        currentLayer.style.opacity = '1';
        currentLayer.style.pointerEvents = '';
        currentLayer.style.zIndex = '2';

        /*
         * Neither transition engine wraps its WebGL setup/animation in a
         * try/finally - each only removes the shared canvas container's
         * "on" class (the class that actually makes the canvas visible;
         * see the fix in turbulent-dissolve.js/particle-transition.js)
         * on its own success/known-error paths. If something throws in
         * between, the container could be left stuck in the visible
         * state with a frozen last-drawn frame sitting on top of the
         * outgoing ad we just restored above. Belt-and-suspenders: force
         * it back to its default hidden state here too.
         */
        if (canvasContainer) {
          canvasContainer.classList.remove('on');
        }

        /*
         * Let the outer showFrame() retry mechanism handle it.
         */
        throw err;
      }

      /*
       * ------------------------------------------------------------
       * TRANSITION FINISHED
       * ------------------------------------------------------------
       *
       * Only now update the state to say that the incoming ad is
       * the currently displayed advertisement.
       */
      lastAdMediaType = ad.mediaType;

      activeLayer =
        activeLayer === 'a' ? 'b' : 'a';

      index += 1;

      if (index >= ads.length) {
        index = 0;
      }

      /*
       * ------------------------------------------------------------
       * PRELOAD NEXT AD
       * ------------------------------------------------------------
       */
      if (nextAd) {
        if (nextAd.mediaType === 'image') {

          const img = new Image();
          img.src = nextAd.mediaUrl;

        } else {

          const vid = document.createElement('video');
          vid.preload = 'auto';
          vid.src = nextAd.mediaUrl;
        }
      }

      /*
       * ------------------------------------------------------------
       * SCHEDULE NEXT AD
       * ------------------------------------------------------------
       */
      clearTimeout(mediaTimer);

      let nextTriggered = false;

      const triggerNext = () => {
        if (nextTriggered) return;

        nextTriggered = true;

        clearTimeout(mediaTimer);

        refreshFeed().then(showFrame);
      };

      if (ad.mediaType === 'video') {

        /*
         * Video plays until it actually ends.
         */
        if (prepared && prepared.mainVideo) {

          prepared.mainVideo.addEventListener(
            'ended',
            triggerNext,
            { once: true }
          );

          const vidDurationSec =
            prepared.mainVideo.duration ||
            Number(ad.duration) ||
            30;

          mediaTimer = setTimeout(
            triggerNext,
            Math.ceil(vidDurationSec * 1000) + 800
          );

        } else {

          mediaTimer = setTimeout(
            triggerNext,
            (Number(ad.duration) || 10) * 1000
          );
        }

      } else {

        /*
         * Image duration.
         */
        const durationMs =
          Number(ad.duration || 10) * 1000;

        mediaTimer = setTimeout(
          triggerNext,
          Math.max(3000, durationMs)
        );
      }
    }

    // Live socket/poll watcher for screen or ad changes
    stopWatch = watchLive({
      'ads.json': (data) => { if (!data?.localEmit) refreshFeed(); },
      'screens.json': (data) => { if (!data?.localEmit) refreshFeed(); },
      // The server stamps a fresh `build` version every time it boots (see
      // config/db.js) - i.e. on every deploy. A kiosk tab can stay open for
      // days; without this, a shipped fix sits on the server forever while
      // the tab keeps running whatever JS it loaded before the deploy. This
      // reloads the actual page so the new code is the code that runs.
      'build': (data) => { if (!data?.localEmit) { dlog('[DISPLAY] new build detected, reloading'); window.location.reload(); } }
    }, { intervalMs: 2000 });

    window.addEventListener('beforeunload', () => {
      if (stopWatch) stopWatch();
      clearTimeout(mediaTimer);
    });

    showFrame();
  }
})();

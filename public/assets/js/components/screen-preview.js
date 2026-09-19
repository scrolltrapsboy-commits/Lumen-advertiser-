import { apiFetch } from '../core/api.js';
import { generateQRSvgMarkup } from './qr-code.js';
import { mountClockWeatherOverlay } from './clock-weather-overlay.js';
import { initQRVideoWalker } from './qr-video-walker.js';

/**
 * ScreenPreviewController - the "Upload Preview" system (kept
 * deliberately separate from the Big Display's own live playback
 * system in display.js, which is untouched by this file).
 *
 * Given a screen ID, it fetches the EXACT SAME endpoints the actual Big
 * Display uses (GET /api/display/:screenId for the screen/ads/site
 * config, GET /api/weather/:screenId for weather) and renders the real
 * current advertisement, clock, date, location, weather, QR, and QR
 * walker into the `screenEl` returned by mountSmallDisplayTV() - never
 * fake/hardcoded example data.
 *
 * Reuses the Big Display's own CSS classes/markup fragments verbatim
 * (.player-header, .player-qr, and the shared clock-weather-overlay.js
 * / qr-video-walker.js modules also used by display.js) at the Big
 * Display's own real logical resolution (1080x1920), then scales that
 * whole stage down with a single CSS transform to fit whatever size the
 * TV's screen area actually renders at. That's what keeps clock/QR/text
 * proportions IDENTICAL to the real display instead of a separately
 * hand-tuned "small" version that could drift out of sync with it, and
 * it can never stretch/distort/crop since it's one uniform scale.
 *
 * Deliberately, explicitly NOT the same as the Big Display's own ad
 * playback:
 *  - NO automatic ad rotation/playlist and NO transition of any kind
 *    (no fall, dissolve, particle, slide, flip, zoom) between ads or
 *    when a pending file is selected - the currently-relevant media is
 *    just shown, instantly, full stop. The Big Display's own particle-
 *    transition/turbulent-dissolve system (display.js) is untouched and
 *    is not reused or referenced here.
 *  - The QR walker (qr-video-walker.js) IS mounted here, exactly once
 *    per preview instance, and keeps running independently of screen or
 *    pending-media changes - see setScreen()/setPendingMedia() below.
 *
 * Also disclosed, not silently skipped:
 *  - Browser-geolocation weather fallback is intentionally NOT
 *    triggered from here: that fallback exists in display.js because
 *    the Big Display's browser physically sits at the screen's real
 *    location, so ITS geolocation is a reasonable stand-in for a
 *    screen with no configured coordinates. An admin/advertiser
 *    previewing that same screen from their own browser is very likely
 *    somewhere else entirely, so their geolocation would misrepresent
 *    the screen's real location rather than approximate it. If a
 *    screen has no configured lat/lng, this preview just shows no
 *    weather block - exactly like the Big Display does before its own
 *    geolocation fallback resolves.
 *  - There is no reverse-geocoding pipeline anywhere in this codebase
 *    (only `screen.place`, an admin-entered label) - this preview shows
 *    `screen.place`, the exact same value and field the Big Display
 *    itself renders as the location, rather than inventing a new
 *    geocoding integration this app doesn't otherwise have.
 */

const STAGE_W = 1080;
const STAGE_H = 1920;

function buildAdContent(ad) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;';
  const backdrop = document.createElement('div');
  backdrop.className = 'player-backdrop';
  const overlay = document.createElement('div');
  overlay.className = 'player-backdrop-overlay';
  const content = document.createElement('div');
  content.className = 'player-media-content';

  if (ad.mediaType === 'video') {
    const bgVideo = document.createElement('video');
    bgVideo.src = ad.mediaUrl;
    bgVideo.muted = true;
    bgVideo.autoplay = true;
    bgVideo.loop = true;
    bgVideo.playsInline = true;
    bgVideo.className = 'player-backdrop-media';
    const fgVideo = document.createElement('video');
    fgVideo.src = ad.mediaUrl;
    fgVideo.muted = true;
    fgVideo.autoplay = true;
    fgVideo.loop = true;
    fgVideo.playsInline = true;
    fgVideo.className = 'player-foreground-media';
    backdrop.appendChild(bgVideo);
    content.appendChild(fgVideo);
  } else {
    const bgImg = document.createElement('img');
    bgImg.src = ad.mediaUrl;
    bgImg.className = 'player-backdrop-media';
    const fgImg = document.createElement('img');
    fgImg.src = ad.mediaUrl;
    fgImg.alt = 'Advertisement preview';
    fgImg.className = 'player-foreground-media';
    backdrop.appendChild(bgImg);
    content.appendChild(fgImg);
  }

  backdrop.appendChild(overlay);
  wrap.appendChild(backdrop);
  wrap.appendChild(content);
  return wrap;
}

function buildMessageContent(message) {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.55);font-size:34px;text-align:center;padding:8%;';
  el.textContent = message;
  return el;
}

export function createScreenPreview(screenEl) {
  screenEl.innerHTML = `
    <div class="player-shell screen-preview-stage" id="sp-stage">
      <div class="player-media-layer active" id="sp-layer"></div>
      <div class="player-header" id="sp-header">
        <span class="player-live-badge"><span class="player-live-dot"></span>LIVE</span>
        <span class="player-header-divider" id="sp-place-divider" style="display:none;"></span>
        <span class="player-header-place" id="sp-place" style="display:none;"></span>
      </div>
      <div class="player-liquid-clock" id="sp-clock"></div>
      <div class="player-qr" id="sp-qr" style="display:none;">
        <div class="player-qr-card">
          <div class="player-qr-code" id="sp-qr-code"></div>
          <div class="player-qr-info">
            <p class="player-qr-heading">Learn more<br>about us.</p>
            <div class="player-qr-cta"><span class="player-qr-cta-arrow" aria-hidden="true">&#8592;</span><span>scan here</span></div>
          </div>
        </div>
      </div>
      <div class="qr-video-overlay" id="sp-qr-walker" aria-hidden="true"></div>
      <div class="screen-preview-status" id="sp-status"></div>
    </div>`;

  const stage = screenEl.querySelector('#sp-stage');
  stage.style.width = `${STAGE_W}px`;
  stage.style.height = `${STAGE_H}px`;
  stage.style.transformOrigin = 'top left';

  const statusEl = screenEl.querySelector('#sp-status');
  const layer = screenEl.querySelector('#sp-layer');
  const qrEl = screenEl.querySelector('#sp-qr');
  const qrWalkerContainer = screenEl.querySelector('#sp-qr-walker');
  const clockOverlay = mountClockWeatherOverlay(screenEl.querySelector('#sp-clock'));

  let currentScreenId = null;
  let ads = [];
  let weatherTimer = null;
  let pendingMedia = null; // { url, type } | null - see setPendingMedia()
  let destroyed = false;
  let requestToken = 0; // guards against a slow fetch resolving after setScreen() moved on
  let walkerHandle = null; // mounted at most ONCE, ever - see setScreen() below

  function rescale() {
    const rect = screenEl.getBoundingClientRect();
    if (!rect.width) return;
    stage.style.transform = `scale(${rect.width / STAGE_W})`;
    // The QR walker's own layout() needs to re-run whenever THIS
    // preview's rendered size changes (e.g. a sidebar collapsing), not
    // only on an actual browser window resize - call its exposed
    // relayout() directly. (Not a dispatched 'resize' event: layout()
    // is already subscribed to 'resize' itself, so re-dispatching one
    // from here would call it a second time on every real resize too,
    // and risks recursing if anything else ever reacts to 'resize' by
    // resizing something in turn.)
    if (walkerHandle) walkerHandle.relayout();
  }
  rescale();
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(rescale) : null;
  if (resizeObserver) resizeObserver.observe(screenEl);
  window.addEventListener('resize', rescale);

  function showStatus(message) {
    statusEl.textContent = message;
    statusEl.style.display = 'flex';
  }
  function hideStatus() {
    statusEl.style.display = 'none';
    statusEl.textContent = '';
  }

  /**
   * Replaces whatever is currently shown with new content, INSTANTLY -
   * no fade/dissolve/fall/slide/flip/zoom of any kind, by design (see
   * file header). Old <video> elements are explicitly stopped before
   * being discarded so a replaced ad doesn't keep decoding in the
   * background.
   */
  function showInstantly(buildContentFn) {
    layer.querySelectorAll('video').forEach((v) => {
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* noop */ }
    });
    layer.innerHTML = '';
    layer.appendChild(buildContentFn());
  }

  /** Renders whatever SHOULD currently be visible: the pending preview
   * file if one is selected, otherwise the screen's current ad (just
   * the first one - see file header: no rotation/playlist here), with
   * no transition either way. */
  function renderCurrentMedia() {
    if (pendingMedia) {
      showInstantly(() => buildAdContent({ mediaType: pendingMedia.type, mediaUrl: pendingMedia.url }));
    } else if (ads.length) {
      showInstantly(() => buildAdContent(ads[0]));
    } else {
      showInstantly(() => buildMessageContent('No advertisements are currently scheduled on this screen.'));
    }
  }

  async function pollWeatherOnce(screenId) {
    try {
      const data = await apiFetch(`/api/weather/${encodeURIComponent(screenId)}`);
      if (destroyed || screenId !== currentScreenId) return;
      if (data && data.ok && data.weather) {
        clockOverlay.renderWeather(data.weather);
        if (typeof data.refreshMs === 'number' && data.refreshMs > 0) {
          if (weatherTimer) clearInterval(weatherTimer);
          weatherTimer = setInterval(() => pollWeatherOnce(screenId), data.refreshMs);
        }
      } else {
        // WEATHER_NOT_CONFIGURED or any other non-ok response: no
        // geolocation fallback here (see file header) - just no weather
        // block, same as the Big Display before its own fallback runs.
        clockOverlay.renderWeather(null);
      }
    } catch (err) {
      if (destroyed || screenId !== currentScreenId) return;
      clockOverlay.renderWeather(null);
    }
  }

  function renderQR(siteUrl) {
    const qrCodeEl = screenEl.querySelector('#sp-qr-code');
    const destination = siteUrl || window.location.origin;
    try {
      qrCodeEl.innerHTML = generateQRSvgMarkup(destination);
      qrEl.style.display = '';
    } catch (err) {
      qrEl.style.display = 'none';
    }

    // Mount the QR walker exactly ONCE, ever, the first time the QR
    // card is actually visible/sized (its layout() needs a real rect to
    // measure) - never remounted on later screen changes or file
    // changes, so there is only ever one walker, one canvas, one pair
    // of decode-only <video> elements, one RAF loop for this preview
    // (see qr-video-walker.js's own file header for how it stays
    // genuinely transparent and how its timeline/state machine works -
    // this is the exact same implementation the Big Display uses, not
    // a second one).
    if (!walkerHandle && qrEl.style.display !== 'none') {
      walkerHandle = initQRVideoWalker(qrWalkerContainer, qrEl) || null;
    }
  }

  async function setScreen(screenId) {
    if (destroyed) return;
    currentScreenId = screenId;
    const token = ++requestToken;
    if (weatherTimer) { clearInterval(weatherTimer); weatherTimer = null; }
    ads = [];
    hideStatus();

    if (!screenId) {
      qrEl.style.display = 'none';
      screenEl.querySelector('#sp-place').style.display = 'none';
      screenEl.querySelector('#sp-place-divider').style.display = 'none';
      showInstantly(() => buildMessageContent('Select a display screen to preview it here.'));
      return;
    }

    showStatus('Loading display\u2026');
    let feed;
    try {
      feed = await apiFetch(`/api/display/${encodeURIComponent(screenId)}`);
    } catch (err) {
      if (destroyed || token !== requestToken) return;
      showStatus('Unable to load display preview');
      return;
    }
    if (destroyed || token !== requestToken) return;
    if (!feed || !feed.ok || !feed.screen) {
      showStatus('Unable to load display preview');
      return;
    }
    hideStatus();

    const { screen, config } = feed;
    ads = Array.isArray(feed.ads) ? feed.ads : [];

    const placeEl = screenEl.querySelector('#sp-place');
    const placeDividerEl = screenEl.querySelector('#sp-place-divider');
    if (screen.place) {
      placeEl.textContent = `\u{1F4CD} ${screen.place}`;
      placeEl.style.display = '';
      placeDividerEl.style.display = '';
    } else {
      placeEl.style.display = 'none';
      placeDividerEl.style.display = 'none';
    }

    renderQR(config && config.siteUrl);
    renderCurrentMedia();
    pollWeatherOnce(screenId);
  }

  /**
   * Shows a not-yet-uploaded file inside the TV instead of the screen's
   * current ad - instantly, with no transition (see file header). Pass
   * null to go back to showing the screen's current ad. The QR walker
   * is never touched by this - it keeps running independently, exactly
   * as specified.
   */
  function setPendingMedia(media) {
    if (destroyed) return;
    pendingMedia = media || null;
    renderCurrentMedia();
  }

  function destroy() {
    destroyed = true;
    if (weatherTimer) clearInterval(weatherTimer);
    clockOverlay.destroy();
    if (walkerHandle) walkerHandle.destroy();
    if (resizeObserver) resizeObserver.disconnect();
    window.removeEventListener('resize', rescale);
    layer.querySelectorAll('video').forEach((v) => {
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* noop */ }
    });
  }

  return { setScreen, setPendingMedia, destroy };
}

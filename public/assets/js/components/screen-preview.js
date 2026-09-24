import { apiFetch } from '../core/api.js';
import { mountPortraitDisplayOverlay } from './portrait-display-overlay.js';

/**
 * ScreenPreviewController - the "Upload Preview" system (kept
 * deliberately separate from the Big Display's own live playback
 * system in display.js, which is untouched by this file).
 *
 * Given a screen ID, it fetches the EXACT SAME endpoints the actual
 * displays use (GET /api/display/:screenId for the screen/ads/site
 * config, GET /api/weather/:screenId for weather) and renders the
 * real current advertisement underneath the shared portrait display
 * overlay (portrait-display-overlay.js - the same persistent
 * information system as the Big Display: LIVE badge, Lumen branding,
 * screen label, clock, date, greeting, location, animated weather,
 * daily quote and the real scannable QR). Never
 * fake/hardcoded example data.
 *
 * Deliberately, explicitly NOT the same as the Big Display's own ad
 * playback:
 *  - NO automatic ad rotation/playlist and NO transition of any kind
 *    (no fall, dissolve, particle, slide, flip, zoom) between ads or
 *    when a pending file is selected - the currently-relevant media is
 *    just shown, instantly, full stop. Only the weather icon keeps its
 *    own independent animation. The Big Display's
 *    particle-transition/turbulent-dissolve systems are untouched and
 *    are not reused or referenced here.
 *  - NO QR video walker: the preview's job is to represent the screen's
 *    information and how the uploaded ad will sit in the portrait frame;
 *    the place/pickup walker is a physical-display behavior (the Big
 *    Display mounts it itself), not part of a preview. The QR
 *    CARD itself still renders - real and scannable, exactly as on the
 *    display.
 *
 * Also disclosed, not silently skipped:
 *  - Browser-geolocation weather fallback is intentionally NOT
 *    triggered from here: that fallback exists in display.js because
 *    a real display's browser physically sits at the screen's
 *    location. An admin/advertiser previewing that same screen from
 *    their own browser is very likely somewhere else entirely, so
 *    their geolocation would misrepresent the screen's real location.
 *    The selected screen's configured location is the source of truth
 *    whenever it exists; if a screen has no configured lat/lng the
 *    weather block just shows placeholders - and no permission prompt
 *    is ever shown from a preview.
 *  - There is no reverse-geocoding pipeline for previews (only
 *    `screen.place`, an admin-entered label, plus the weather
 *    service's own optional locationName) - this preview shows
 *    `screen.place`, the same value the Big Display renders.
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
  el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.55);font-size:44px;line-height:1.4;text-align:center;padding:8%;';
  el.textContent = message;
  return el;
}

export function createScreenPreview(screenEl) {
  screenEl.innerHTML = `
    <div class="portrait-display-stage screen-preview-stage">
      <div class="pd-media"></div>
    </div>`;

  const stage = screenEl.querySelector('.screen-preview-stage');
  const layer = stage.querySelector('.pd-media');
  const statusEl = document.createElement('div');
  statusEl.className = 'screen-preview-status';
  statusEl.style.display = 'none';
  stage.appendChild(statusEl);

  let overlay = null;

  // ONE uniform scale for the whole 1080x1920 composition - the TV can
  // render at any CSS size and every proportion stays locked (see the
  // stage rules in pages.css).
  function rescale() {
    const rect = screenEl.getBoundingClientRect();
    if (!rect.width) return;
    stage.style.transform = `scale(${rect.width / STAGE_W})`;
  }
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(rescale) : null;
  if (resizeObserver) resizeObserver.observe(screenEl);
  window.addEventListener('resize', rescale);
  rescale();

  overlay = mountPortraitDisplayOverlay(stage);

  let currentScreenId = null;
  let ads = [];
  let weatherTimer = null;
  let pendingMedia = null; // { url, type } | null - see setPendingMedia()
  let destroyed = false;
  let requestToken = 0; // guards against a slow fetch resolving after setScreen() moved on

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
   * background. The persistent overlay is a sibling of the media layer
   * and is never touched by this.
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
      // Values update in place inside the permanently-reserved weather
      // block, so a late/refreshed reading never moves the layout.
      overlay.setWeather(data && data.ok && data.weather ? data.weather : null);
      if (data && typeof data.refreshMs === 'number' && data.refreshMs > 0) {
        if (weatherTimer) clearInterval(weatherTimer);
        weatherTimer = setInterval(() => pollWeatherOnce(screenId), data.refreshMs);
      }
    } catch (err) {
      if (destroyed || screenId !== currentScreenId) return;
      overlay.setWeather(null);
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
      overlay.setPlace('');
      overlay.setScreenLabel('');
      overlay.setQrDestination(null);
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

    // Screen-specific persistent information: name chip, location, QR
    // destination and weather all switch to the SELECTED screen's real
    // data, in place.
    overlay.setScreenLabel(screen.id);
    overlay.setPlace(screen.place || '');
    overlay.setQrDestination(config && config.siteUrl);
    renderCurrentMedia();
    pollWeatherOnce(screenId);
  }

  /**
   * Shows a not-yet-uploaded file inside the TV instead of the screen's
   * current ad - instantly, with no transition (see file header). Pass
   * null to go back to showing the screen's current ad. The persistent
   * overlay (clock/weather/quote/QR/walker) is never touched by this -
   * it keeps running independently, exactly as specified.
   */
  function setPendingMedia(media) {
    if (destroyed) return;
    pendingMedia = media || null;
    renderCurrentMedia();
  }

  function destroy() {
    destroyed = true;
    if (weatherTimer) clearInterval(weatherTimer);
    overlay.destroy();
    if (resizeObserver) resizeObserver.disconnect();
    window.removeEventListener('resize', rescale);
    layer.querySelectorAll('video').forEach((v) => {
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* noop */ }
    });
  }

  return { setScreen, setPendingMedia, destroy };
}

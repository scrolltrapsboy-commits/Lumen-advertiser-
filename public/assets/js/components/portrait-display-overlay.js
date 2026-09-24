import { WEATHER_ICONS } from './weather-icons.js';
import { generateQRSvgMarkup } from './qr-code.js';
import { initQRVideoWalker } from './qr-video-walker.js';
import { dailyQuote } from '../utils/quote.js';

/**
 * The ONE shared PORTRAIT composition of the Lumen display system's
 * persistent information layer - the authoritative "Small Display
 * renderer" every portrait TV in this codebase mounts through:
 *
 *   - screen-preview.js  (Upload Preview + Admin Advertise preview)
 *   - network-preview.js (the Small Display playback shown inside the
 *                         TV chassis on landing/login/signup/dashboard)
 *
 * It renders the SAME information system as the Big Display (display.js
 * keeps its own landscape composition, untouched): Lumen branding, LIVE
 * indicator, screen label, live clock, date, greeting, screen location,
 * weather (temperature, condition, animated condition renderer, rain,
 * humidity, wind), the daily quote, a REAL scannable QR, and the QR
 * video walker - recomposed for a portrait canvas rather than scaled
 * down from the landscape layout. See the .pd-* rules in pages.css.
 *
 * Everything is designed once at the stage's fixed 1080x1920 logical
 * size (all sizing in absolute stage pixels) and the CONSUMER scales
 * the whole stage with ONE uniform CSS transform, so proportions are
 * locked at any rendered TV size and the walker's coordinate system is
 * inherently the QR's own (both live in the same stage).
 *
 * The QR walker is the Big Display's own implementation
 * (qr-video-walker.js), mounted exactly ONCE per overlay instance
 * against this overlay's QR card - the same place/pickup sequence,
 * never duplicated by screen or media changes.
 *
 * Resource discipline (one instance each, by construction): one clock
 * interval, one weather renderer, one walker (canvas + two decode-only
 * videos + one RAF loop). setPlace/setWeather/setScreenLabel update
 * values in place - the DOM is never rebuilt, so nothing jumps when
 * data loads and no listener is ever duplicated. destroy() tears the
 * clock and walker down with the overlay.
 *
 * @param {HTMLElement} stageEl - the 1080x1920 .portrait-display-stage
 *   element; the overlay is appended inside it, above the media layers.
 * @param {{walker?:boolean}} [opts] - walker:false skips the QR video
 *   walker (kept for contexts that must stay entirely static).
 * @returns {{root:HTMLElement, setPlace:function, setScreenLabel:function,
 *   setWeather:function, setQrDestination:function, relayout:function,
 *   destroy:function}}
 */
export function mountPortraitDisplayOverlay(stageEl, opts = {}) {
  const mountWalker = opts.walker !== false;

  stageEl.insertAdjacentHTML('beforeend', `
    <div class="pd-root">
      <div class="pd-scrim pd-scrim--top" aria-hidden="true"></div>
      <div class="pd-scrim pd-scrim--bottom" aria-hidden="true"></div>

      <div class="pd-topbar">
        <span class="player-live-badge"><span class="player-live-dot"></span>LIVE</span>
        <span class="player-header-divider" aria-hidden="true"></span>
        <span class="pd-brand">LUMEN DIGITAL ADS</span>
        <span class="pd-screen-chip" hidden></span>
      </div>

      <div class="pd-infocard">
        <div class="pd-clock">
          <div class="pd-greeting"></div>
          <div class="pd-time">--:--</div>
          <div class="pd-date"></div>
        </div>

        <div class="pd-place" hidden></div>

        <div class="pd-weather">
          <div class="pd-weather-main">
            <span class="pd-weather-icon" data-condition="partly-cloudy" aria-hidden="true">${WEATHER_ICONS['partly-cloudy']}</span>
            <span class="pd-weather-temp">--&deg;</span>
            <span class="pd-weather-cond">Weather unavailable</span>
          </div>
          <div class="pd-metrics">
            <span class="pd-metric">Rain --%</span>
            <span class="pd-metric">Humidity --%</span>
            <span class="pd-metric">Wind -- km/h</span>
          </div>
        </div>
      </div>

      <div class="pd-spacer" aria-hidden="true"></div>

      <div class="pd-quote"></div>

      <div class="pd-qr">
        <div class="player-qr-card">
          <div class="player-qr-code"></div>
          <div class="player-qr-info">
            <p class="player-qr-heading">Learn more<br>about us.</p>
            <div class="player-qr-cta"><span class="player-qr-cta-arrow" aria-hidden="true">&#8592;</span><span>scan here</span></div>
          </div>
        </div>
        <div class="pd-qr-anchor" aria-hidden="true"></div>
      </div>

      <div class="qr-video-overlay pd-walker" aria-hidden="true"></div>
    </div>`);

  const root = stageEl.querySelector(':scope > .pd-root');
  const greetingEl = root.querySelector('.pd-greeting');
  const timeEl = root.querySelector('.pd-time');
  const dateEl = root.querySelector('.pd-date');
  const placeEl = root.querySelector('.pd-place');
  const chipEl = root.querySelector('.pd-screen-chip');
  const iconEl = root.querySelector('.pd-weather-icon');
  const tempEl = root.querySelector('.pd-weather-temp');
  const condEl = root.querySelector('.pd-weather-cond');
  const metricEls = Array.from(root.querySelectorAll('.pd-metric'));
  const quoteEl = root.querySelector('.pd-quote');
  const qrCodeEl = root.querySelector('.player-qr-code');
  const anchorEl = root.querySelector('.pd-qr-anchor');
  const walkerEl = root.querySelector('.pd-walker');

  // Intentionally the BROWSER's own local time (same policy as the Big
  // Display's clock-weather-overlay.js) - whatever device renders this
  // shows its own local clock.
  function renderClock() {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 5 ? 'Good Night' : hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : hour < 21 ? 'Good Evening' : 'Good Night';
    if (greetingEl.textContent !== greeting) greetingEl.textContent = greeting;
    const label = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (timeEl.textContent !== label) timeEl.textContent = label;
    const weekday = now.toLocaleDateString([], { weekday: 'short' });
    const dom = String(now.getDate()).padStart(2, '0');
    const month = now.toLocaleDateString([], { month: 'short' });
    const dateLabel = `${weekday}, ${dom} ${month} ${now.getFullYear()}`;
    if (dateEl.textContent !== dateLabel) dateEl.textContent = dateLabel;
  }
  renderClock();
  const clockTimer = setInterval(renderClock, 1000);

  // Same daily-quote system as the Big Display (utils/quote.js): one
  // quote per calendar day, written once at mount - never re-rolled by
  // screen/media/weather changes or rerenders.
  quoteEl.textContent = dailyQuote();

  function setPlace(place) {
    if (place) {
      placeEl.textContent = `\u{1F4CD} ${place}`;
      placeEl.hidden = false;
    } else {
      placeEl.hidden = true;
    }
  }

  function setScreenLabel(label) {
    if (label) {
      chipEl.textContent = label;
      chipEl.hidden = false;
    } else {
      chipEl.hidden = true;
    }
  }

  /** Updates weather values IN PLACE (no rebuild, no layout jump); the
   * block's space is permanently reserved so a missing/late reading
   * never shifts the composition. */
  function setWeather(weather) {
    if (!weather || typeof weather.tempC !== 'number' || !weather.category) {
      tempEl.textContent = '--\u00b0';
      condEl.textContent = 'Weather unavailable';
      metricEls[0].textContent = 'Rain --%';
      metricEls[1].textContent = 'Humidity --%';
      metricEls[2].textContent = 'Wind -- km/h';
      return;
    }
    if (iconEl.dataset.condition !== weather.category) {
      iconEl.dataset.condition = weather.category;
      // Same animated condition renderer the Big Display uses
      // (weather-icons.js + the .wx-* CSS animations in pages.css).
      iconEl.innerHTML = WEATHER_ICONS[weather.category] || WEATHER_ICONS.cloudy;
    }
    tempEl.textContent = `${weather.tempC}\u00b0C`;
    condEl.textContent = weather.condition || '';
    metricEls[0].textContent = `Rain ${typeof weather.precipitationProbability === 'number' ? weather.precipitationProbability : '--'}%`;
    metricEls[1].textContent = `Humidity ${typeof weather.humidity === 'number' ? weather.humidity : '--'}%`;
    metricEls[2].textContent = `Wind ${typeof weather.windKmh === 'number' ? weather.windKmh : '--'} km/h`;
  }

  /** Regenerates the REAL scannable QR (qr-code.js) from the given
   * destination - same source the Big Display uses (config.siteUrl). */
  function setQrDestination(url) {
    try {
      qrCodeEl.innerHTML = generateQRSvgMarkup(url || window.location.origin);
    } catch (err) {
      // Generation failed (e.g. pathological destination) - keep the
      // previous QR rather than rendering a broken one.
    }
  }

  // ONE walker per overlay, ever. It is positioned against an invisible
  // ANCHOR that mirrors the visible QR card's exact rect (same CSS
  // right/bottom/width/aspect - see .pd-qr-anchor in pages.css), so the
  // walker's DOM-visibility toggles land on the anchor and the REAL QR
  // card stays mounted and visible at all times, independent of the
  // walker sequence and of advertisement media. cardScale 1 makes the
  // walker's baked card land exactly on the real card's rect, so the
  // man appears to carry the very card that is on screen.
  let walkerHandle = null;
  if (mountWalker) {
    walkerHandle = initQRVideoWalker(walkerEl, anchorEl, { cardScale: 1 }) || null;
  }

  /** Re-runs the walker's layout after the stage's uniform scale
   * changes (TV resized / sidebar collapsed) - a plain call, never a
   * synthetic 'resize' event (qr-video-walker.js already listens to
   * real ones itself). */
  function relayout() {
    if (walkerHandle) walkerHandle.relayout();
  }

  function destroy() {
    clearInterval(clockTimer);
    if (walkerHandle) walkerHandle.destroy();
  }

  return { root, setPlace, setScreenLabel, setWeather, setQrDestination, relayout, destroy };
}

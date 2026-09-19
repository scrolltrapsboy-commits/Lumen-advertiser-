import { WEATHER_ICONS } from './weather-icons.js';

/**
 * The liquid-glass clock/date/weather card. Extracted out of display.js
 * (Big Display) so both the Big Display and the small-screen preview
 * (screen-preview.js) render it from ONE place instead of two copies of
 * the same markup/logic drifting apart - see PART 25/10 of the small-
 * display-preview spec ("ONE SCREEN STATE... do not duplicate the same
 * logic in multiple pages").
 *
 * Scoped to `container` (no global-ID lookups), so more than one of
 * these can exist on a page at once without colliding - required for
 * the small preview, which can sit on the same page as other UI while
 * the Big Display's own instance lives entirely on its own page.
 *
 * @param {HTMLElement} container - emptied and filled with the card's
 *   own markup. Reuses the exact same CSS classes as the Big Display
 *   (pages.css .player-liquid-clock-card etc.) so it's pixel-identical.
 * @returns {{ renderClock(): void, renderWeather(weather): void, destroy(): void }}
 */
export function mountClockWeatherOverlay(container, options = {}) {
  const detailed = options.detailed === true;
  container.innerHTML = `
    <div class="player-liquid-clock-card${detailed ? ' player-liquid-clock-card--detailed' : ''}">
      <div class="player-liquid-clock-main">
        <div class="player-liquid-clock-kicker">LIVE</div>
        <div class="player-liquid-clock-time">--:--</div>
        <div class="player-liquid-clock-date"></div>
      </div>
      <div class="player-liquid-clock-weather" hidden>
        <div class="player-liquid-clock-location"></div>
        <div class="player-liquid-clock-weather-topline">
          <span class="player-liquid-clock-weather-icon" aria-hidden="true"></span>
          <span class="player-liquid-clock-weather-temp"></span>
          <span class="player-liquid-clock-weather-label"></span>
          <span class="player-liquid-clock-wind-visual" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>
        <div class="player-liquid-clock-metrics">
          <span class="player-liquid-clock-rain"></span>
          <span class="player-liquid-clock-humidity"></span>
          <span class="player-liquid-clock-wind"></span>
        </div>
      </div>
    </div>`;

  const timeEl = container.querySelector('.player-liquid-clock-time');
  const dateEl = container.querySelector('.player-liquid-clock-date');
  const kickerEl = container.querySelector('.player-liquid-clock-kicker');
  const wrap = container.querySelector('.player-liquid-clock-weather');
  const locationEl = container.querySelector('.player-liquid-clock-location');
  const iconEl = container.querySelector('.player-liquid-clock-weather-icon');
  const tempEl = container.querySelector('.player-liquid-clock-weather-temp');
  const labelEl = container.querySelector('.player-liquid-clock-weather-label');
  const rainEl = container.querySelector('.player-liquid-clock-rain');
  const humidityEl = container.querySelector('.player-liquid-clock-humidity');
  const windEl = container.querySelector('.player-liquid-clock-wind');
  const windVisualEl = container.querySelector('.player-liquid-clock-wind-visual');

  function renderClock() {
    // Intentionally the BROWSER's own local time, not a server-side
    // timezone lookup: whatever device is rendering this (a physical
    // Big Display, or an admin/advertiser's browser previewing a
    // screen) shows ITS OWN local clock - see display.js's original
    // comment for why this is correct for a multi-city fleet.
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 5 ? 'Good Night' : hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : hour < 21 ? 'Good Evening' : 'Good Night';
    kickerEl.textContent = detailed ? greeting : 'LIVE';
    const label = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (timeEl.textContent !== label) timeEl.textContent = label;
    const day = now.toLocaleDateString([], { weekday: 'short' });
    const dom = String(now.getDate()).padStart(2, '0');
    const month = now.toLocaleDateString([], { month: 'short' });
    const year = now.getFullYear();
    const dateLabel = `${day}, ${dom} ${month} ${year}`;
    if (dateEl.textContent !== dateLabel) dateEl.textContent = dateLabel;
  }

  function renderWeather(weather) {
    if (!weather || typeof weather.tempC !== 'number' || !weather.category) {
      // No valid reading yet (no lat/lng configured, or first fetch
      // hasn't resolved) - never show undefined/NaN/null, just keep the
      // compact clock-only state.
      locationEl.textContent = 'Location unavailable';
      tempEl.textContent = '--';
      labelEl.textContent = 'Weather unavailable';
      rainEl.textContent = 'Rain --%';
      humidityEl.textContent = 'Humidity --%';
      windEl.textContent = 'Wind -- km/h';
      wrap.hidden = false;
      return;
    }
    if (iconEl.dataset.condition !== weather.category) {
      iconEl.dataset.condition = weather.category;
      iconEl.innerHTML = WEATHER_ICONS[weather.category] || WEATHER_ICONS.cloudy;
    }
    tempEl.textContent = `${weather.tempC}\u00b0C`;
    labelEl.textContent = weather.condition || '';
    locationEl.textContent = weather.locationName || 'Location unavailable';
    rainEl.textContent = `Rain ${typeof weather.precipitationProbability === 'number' ? weather.precipitationProbability : '--'}%`;
    humidityEl.textContent = `Humidity ${typeof weather.humidity === 'number' ? weather.humidity : '--'}%`;
    windEl.textContent = `Wind ${typeof weather.windKmh === 'number' ? weather.windKmh : '--'} km/h`;
    if (windVisualEl) {
      const speed = typeof weather.windKmh === 'number' ? weather.windKmh : 0;
      windVisualEl.style.animationDuration = `${Math.max(0.7, 2.8 - Math.min(speed, 30) * 0.06)}s`;
    }
    wrap.hidden = false;
  }

  renderClock();
  const intervalId = setInterval(renderClock, 1000);

  return {
    renderClock,
    renderWeather,
    destroy() {
      clearInterval(intervalId);
    }
  };
}

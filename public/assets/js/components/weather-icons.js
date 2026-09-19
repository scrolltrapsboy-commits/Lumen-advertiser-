/**
 * One small inline SVG per weather-animation category. Kept intentionally
 * tiny/subtle per the spec ("no excessive glow", "compact") - these are
 * meant to read at a glance, not compete with the advertisement for
 * attention. All animation is done with CSS (see pages.css
 * .player-liquid-clock-weather-icon[data-condition="..."] rules) so
 * swapping the icon is just an innerHTML + data-condition write, no
 * per-frame JS.
 *
 * Extracted out of display.js (Big Display) so the exact same icon set
 * can be shared by the small-screen preview (screen-preview.js) - ONE
 * source of truth for both, instead of two copies drifting apart.
 */
export const WEATHER_ICONS = {
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

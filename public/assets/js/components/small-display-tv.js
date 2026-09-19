/**
 * ONE reusable "physical" Small Display TV chassis - a tall portrait
 * digital-signage panel built entirely from CSS gradients/box-shadow
 * (see .small-display-tv rules in components.css), never a background
 * image, so it is genuinely backgroundless/transparent and drops onto
 * any page background (dark, light, gradient, glass) without a visible
 * rectangular boundary.
 *
 * This component knows NOTHING about ads/clock/weather/QR - it is only
 * the physical shell. Every page that needs "a Small Display" mockup
 * calls mountSmallDisplayTV() and puts whatever belongs on that screen
 * into the returned `screenEl` (either a raw file preview, or a full
 * live ScreenPreviewController - see screen-preview.js). That's what
 * makes this the single reusable component instead of every page
 * building its own competing mockup.
 *
 * @param {HTMLElement} container - emptied and filled with the chassis.
 * @param {{ maxWidth?: number }} [opts] - optional pixel cap on the
 *   chassis width (it's 100% of its container otherwise, capped at the
 *   CSS default of 300px - pass a larger/smaller maxWidth to override
 *   per placement, e.g. a bigger hero spot vs. a compact list card).
 * @returns {{ root: HTMLElement, screenEl: HTMLElement }} `screenEl` is
 *   the 9:16 content slot - append/replace its children freely; the
 *   chassis around it never needs to be touched again.
 */
export function mountSmallDisplayTV(container, opts = {}) {
  const { maxWidth } = opts;
  container.innerHTML = `
    <div class="small-display-tv"${maxWidth ? ` style="max-width:${Number(maxWidth)}px;"` : ''}>
      <div class="small-display-tv__bezel">
        <div class="small-display-tv__screen">
          <div class="small-display-tv__screen-content"><span class="small-display-tv__screen-empty">Loading display\u2026</span></div>
          <div class="small-display-tv__glare" aria-hidden="true"></div>
        </div>
      </div>
      <div class="small-display-tv__speaker" aria-hidden="true"></div>
      <div class="small-display-tv__stand" aria-hidden="true"></div>
    </div>`;
  return {
    root: container.querySelector('.small-display-tv'),
    screenEl: container.querySelector('.small-display-tv__screen-content')
  };
}

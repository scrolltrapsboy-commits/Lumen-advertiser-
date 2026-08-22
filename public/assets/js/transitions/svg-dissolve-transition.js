/**
 * svg-dissolve-transition.js
 * ------------------------------------------------------------------------
 * "Engine 1" - the turbulent noise dissolve. Used as the transition for
 * any ad handoff that involves video (image->video, video->image,
 * video->video). Image->image keeps using the separate Three.js/BAS
 * shatter engine in bas-slide-transition.js.
 *
 * The filter graph itself:
 *   feTurbulence (fractalNoise) -> feColorMatrix (luminanceToAlpha)
 *   -> feComponentTransfer/feFuncA linear[slope]
 *   -> feComponentTransfer/feFuncA discrete[0,1]
 *   -> feGaussianBlur -> feComposite("in", SourceGraphic)
 * is reused UNCHANGED from the supplied reference SVG.
 *
 * Two things were necessarily adapted to work as a live, repeatable,
 * JS-triggered player transition instead of a static one-page demo:
 *
 *   1. The reference's feImage + final feComposite("over") baked in a
 *      SECOND, hardcoded static image as the "underlay" being revealed.
 *      That doesn't apply here - the real underlay is whatever DOM layer
 *      is already sitting underneath the outgoing one (the incoming ad,
 *      already playing beneath it), so those two primitives are dropped.
 *      The filter's output is just the dissolving `overlay` result.
 *   2. The reference drives `slope` with an indefinitely looping
 *      <animate>, tuned for an 8s ambient back-and-forth demo. Here the
 *      dissolve must run exactly once, exactly when a new ad is about to
 *      show, for whatever the caller's transition duration is - so
 *      `slope` is driven by a one-shot GSAP tween (same 0..2 range,
 *      same filter math) instead of SMIL.
 *
 * Works on both <img> and <video> elements identically - it's just a CSS
 * filter applied to whatever the outgoing layer currently contains, so a
 * playing video's live frames get fed through the same filter graph.
 * ------------------------------------------------------------------------
 */

const FILTER_ID = 'turbulent-dissolve';
const SLOPE_ID = 'turbulent-dissolve-slope';

let injected = false;
let feFuncA = null;

function ensureFilterInDOM() {
  if (injected) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.style.overflow = 'hidden';
  svg.style.pointerEvents = 'none';

  // x/y/width/height widened beyond the default 0%/0%/100%/100% so the
  // blur/turbulence don't get clipped at the element's edges.
  svg.innerHTML =
    '<defs>' +
      '<filter id="' + FILTER_ID + '" x="-20%" y="-20%" width="140%" height="140%">' +
        '<feTurbulence type="fractalNoise" baseFrequency=".012"/>' +
        '<feColorMatrix type="luminanceToAlpha"/>' +
        '<feComponentTransfer>' +
          '<feFuncA id="' + SLOPE_ID + '" type="linear" slope="2"/>' +
        '</feComponentTransfer>' +
        '<feComponentTransfer>' +
          '<feFuncA type="discrete" tableValues="0 1"/>' +
        '</feComponentTransfer>' +
        '<feGaussianBlur stdDeviation="1"/>' +
        '<feComposite operator="in" in="SourceGraphic" result="overlay"/>' +
      '</filter>' +
    '</defs>';

  document.body.appendChild(svg);
  feFuncA = document.getElementById(SLOPE_ID);
  injected = true;
}

/**
 * Dissolves `outgoingEl` (an <img> or <video>) away via the turbulent
 * noise mask, revealing whatever already sits underneath it in the DOM.
 * Resolves once fully dissolved. If gsap isn't available, falls back to
 * an instant reveal (no animation) rather than leaving the layer stuck.
 */
export function runSvgDissolveTransition(outgoingEl, durationMs = 900) {
  ensureFilterInDOM();

  if (!window.gsap) {
    console.warn('[Lumen] gsap unavailable, skipping dissolve animation for this transition.');
    outgoingEl.style.filter = '';
    return Promise.resolve();
  }

  outgoingEl.style.filter = `url(#${FILTER_ID})`;

  const state = { slope: 2 };
  feFuncA.setAttribute('slope', '2');

  return new Promise((resolve) => {
    window.gsap.to(state, {
      slope: 0,
      duration: durationMs / 1000,
      ease: 'power2.in',
      onUpdate: () => feFuncA.setAttribute('slope', state.slope.toFixed(3)),
      onComplete: () => {
        outgoingEl.style.filter = '';
        resolve();
      }
    });
  });
}

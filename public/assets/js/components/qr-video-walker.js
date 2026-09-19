/**
 * QR video walker (v3) - two pre-rendered videos (public/assets/videos/
 * qr-place.mp4, qr-pickup.mp4) of a real man placing/picking up the QR
 * advertisement, composited over the real page as a genuinely
 * transparent overlay and sequenced as ONE continuous scene (a
 * seamless handoff into a true frozen video frame, not a cut to a
 * separate HTML element and back).
 *
 * TRANSPARENCY
 * Both source videos are shot on solid black. Rather than faking
 * transparency with `mix-blend-mode: screen` (which silently does
 * nothing useful here - see the CSS comment above .qr-video-overlay-
 * canvas for why - and was producing the reported black rectangle),
 * every frame is drawn into an off-screen canvas and each pixel's
 * alpha is set directly from how close it is to black (near-black ->
 * alpha 0, the man/card -> alpha 255, a short ramp between for
 * anti-aliased edges). That canvas - with real per-pixel alpha - is
 * the only thing ever displayed. The two <video> elements are decode
 * sources only: shrunk to 1x1, opacity 0, never removed or recreated.
 *
 * TIMELINE / HANDOFF
 * qr-place.mp4's very last frame and qr-pickup.mp4's very first frame
 * are pixel-identical (both show the same completed, stationary QR
 * card) - confirmed directly by diffing the two frames. That means
 * "seamlessly hand off from placement into a true freeze of the
 * pickup video" requires no seeking or guessing: play qr-place.mp4 to
 * its natural end, then hold qr-pickup.mp4 paused at time 0 for the
 * hold duration, then play it forward. The two videos are simply two
 * halves of one continuous shot.
 *
 * The one moment that does need a real, scannable QR standing in for
 * the video's baked-in (not necessarily scannable, not dynamically
 * generated) QR pattern is while the card is sitting still: from the
 * moment placement finishes through the freeze and into the start of
 * the pickup video, up until the man's hand actually starts moving the
 * card (measured directly from qr-pickup.mp4's frames - the card is
 * still perfectly flat through frame ~90/192, ~3.75s at 24fps, and is
 * visibly tilting by frame ~92). The real DOM QR (#player-qr, from
 * qr-code.js) is shown at exactly that rect only for that span, and
 * the swap in/out is a hard, instant opacity toggle - no fade, no
 * transition - specifically because the canvas and the real card are
 * pixel-identical at the swap instants, so a fade would only risk a
 * double-exposure ghost that a true cut avoids.
 *
 * State machine (exactly as specified, nothing extra):
 *   PLACE_PLAYING -> PICKUP_FROZEN_20S -> PICKUP_PLAYING -> EMPTY_10S -> repeat
 */

const VIDEO_SRC = {
  place: 'assets/videos/qr-place.mp4',
  pickup: 'assets/videos/qr-pickup.mp4',
};

// Native size of both source videos.
const VIDEO_W = 1280;
const VIDEO_H = 720;

// The QR "card" (QR + heading + CTA) sits at the SAME pixel position in
// both videos - confirmed directly: the last frame of qr-place.mp4 and
// the first frame of qr-pickup.mp4 are pixel-identical. These fractions
// are that card's measured bounding box (via a non-black-pixel scan),
// left=107 top=106 right=1195 bottom=612 out of the native 1280x720 -
// not guessed. Used to line up the baked-in card with the real DOM QR's
// actual on-screen rect as closely as the fixed video content allows.
const CARD = {
  left: 107 / VIDEO_W,
  top: 106 / VIDEO_H,
  right: 1195 / VIDEO_W,
  bottom: 612 / VIDEO_H,
};

// One shared footprint for both source videos. The source card is rendered
// at 42% of the live card width - reduced from an earlier 64% after the
// composition was still reported too large (see file header/git history);
// this is a deliberate creative reduction on top of the measured CARD
// geometry above, not a blind arbitrary scale applied to nothing - it
// scales the SAME already-measured video composition uniformly (man, card,
// and QR together, never independently), so proportions, aspect ratio and
// relative sizes between the man and the card are unchanged, only the
// overall footprint is smaller. Flag for a follow-up tuning pass if 42%
// still isn't the intended "natural" size - that's a visual/creative
// judgment call the measurements alone can't fully settle.
const SHARED_CARD_SCALE = 0.42;

// Native QR artwork bounds measured from the stationary card in both videos.
// The QR-only hold uses these same pixels, so its size and position are tied
// to the physical QR carried by the video rather than the old full card.
const QR_ARTWORK = {
  left: 166 / VIDEO_W,
  top: 166 / VIDEO_H,
  right: 590 / VIDEO_W,
  bottom: 590 / VIDEO_H,
};

// The exact QR image supplied for this task (not library-generated, not
// redrawn) - see public/assets/videos/qr-pause-only.png. It's a tight,
// square crop of the original qr_banner_padded.png reference isolating
// just the QR artwork (finder patterns, modules, and a real quiet zone)
// with the surrounding card/border/heading/CTA button cropped away and
// left fully transparent (verified: RGBA, alpha=0 outside the QR square).
const QR_PAUSE_SRC = 'assets/videos/qr-pause-only.png';


// Luma-key thresholds for the transparency pass. Re-measured directly on
// extracted frames from the actual source videos (not guessed):
//   - true background (multiple patches, both videos): typically
//     max-channel 0-3, with rare single-pixel compression-noise spikes up
//     to ~11-14 (99th percentile still only ~3).
//   - the man's jeans (navy denim, sampled across a broad region of both
//     legs in qr-place.mp4 frame 60): max-channel ranges from 0 (deepest
//     shadow folds, genuinely as dark as the background) up through a
//     median of ~7 to a mean of ~28.6, with roughly half the sampled
//     region under 8.
// The previous thresholds (BLACK_LOW=8, BLACK_HIGH=30) were tuned against
// a single sampled "darkest navy denim" pixel (value 27) without checking
// how much of the jeans actually sits BELOW that - in practice ~50% of
// the jeans region was at or under 8 and so rendered fully transparent,
// which is the reported "clothing goes see-through" bug.
// This is a genuine hard case: the darkest denim shadow-fold pixels (down
// to 0) are measurably indistinguishable in luma from the true background
// (also 0-3) in this footage - no pure black/near-black keying threshold
// can perfectly separate the two without new footage shot with more
// separation between wardrobe and backdrop. Lowering BLACK_LOW/HIGH here
// is a real, measured improvement (most of the jeans' actual value range
// now falls inside or above the ramp instead of entirely below it), not a
// full fix - the very darkest fold pixels will still be quite transparent,
// and background compression-noise spikes may now show as extremely
// faint, isolated flecks rather than being fully invisible. Both are
// documented trade-offs, not oversights.
const BLACK_LOW = 2;
const BLACK_HIGH = 22;
const BLACK_RANGE = BLACK_HIGH - BLACK_LOW;

// qr-pickup.mp4 is 192 frames at 24fps (8s). The card is measurably
// still flat through frame ~90 and visibly tilting (being lifted) by
// frame ~92 - checked by sampling that range frame-by-frame. This is
// the point at which the real DOM QR overlay is hidden so only the
// video's own carried-away card is visible during the lift/exit.
const GRIP_TIME_S = 90 / 24;

const DURATIONS = {
  PICKUP_FROZEN_20S: 20000,
  EMPTY_10S: 10000,
};

/**
 * Computes a position/size for the canvas (kept at its true 16:9
 * aspect ratio - never stretched) such that the baked-in card's
 * bottom-right corner and width line up with the real QR element's
 * bottom-right corner and width. The card's aspect ratio inside the
 * video (~2.15:1) doesn't exactly match the live QR card's own aspect
 * (also set to 2.15:1 specifically to match, see pages.css), so this
 * is a close anchor rather than a mathematical guarantee on every
 * edge - documented rather than silently hand-waved.
 */
function computeOverlayRect(qrRect) {
  const cardWidthFrac = CARD.right - CARD.left;
  const scale = (qrRect.width * SHARED_CARD_SCALE) / (cardWidthFrac * VIDEO_W);
  const width = VIDEO_W * scale;
  const height = VIDEO_H * scale;
  const left = qrRect.right - width * CARD.right;
  const top = qrRect.bottom - height * CARD.bottom;
  return { left, top, width, height };
}

/**
 * The paused-state QR image's rect, derived from the SAME video-canvas
 * box computeOverlayRect() returns (not an independent measurement) -
 * this is what guarantees the supplied QR image lines up pixel-for-pixel
 * with the physical QR baked into the frozen video frame: both are
 * ultimately positioned relative to the identical `box`, just narrowed
 * from the full CARD fraction down to the QR_ARTWORK sub-fraction within
 * it. No extra shrink factor is applied here - the "noticeably smaller"
 * requirement is already satisfied by (a) SHARED_CARD_SCALE shrinking the
 * whole video composition and (b) this being just the QR square instead
 * of the full card+heading+CTA, not by scaling this rect down further,
 * which would break the pixel-match with the video at the swap instants.
 */
function computeQrOnlyRect(qrRect) {
  const box = computeOverlayRect(qrRect);
  const left = box.left + QR_ARTWORK.left * box.width;
  const top = box.top + QR_ARTWORK.top * box.height;
  const width = (QR_ARTWORK.right - QR_ARTWORK.left) * box.width;
  const height = (QR_ARTWORK.bottom - QR_ARTWORK.top) * box.height;
  return { left, top, width, height };
}

/** In-place luma key: sets each pixel's alpha from how close to black
 * it is. Operates directly on an ImageData's Uint8ClampedArray. */
function applyLumaKey(data) {
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.max(data[i], data[i + 1], data[i + 2]);
    let alpha;
    if (value <= BLACK_LOW) alpha = 0;
    else if (value >= BLACK_HIGH) alpha = 255;
    else alpha = ((value - BLACK_LOW) * 255) / BLACK_RANGE;
    data[i + 3] = alpha;
  }
}

/** A setTimeout that can be paused/resumed - used so a hidden tab
 * doesn't burn through the waits/grip-timer while nothing is
 * rendering, and so every wall-clock wait in this module pauses/
 * resumes in lockstep with the videos themselves. */
function pausableTimeout(fn, ms) {
  let remaining = ms;
  let startedAt = Date.now();
  let handle = setTimeout(fn, ms);
  let paused = false;
  return {
    pause() {
      if (paused) return;
      paused = true;
      clearTimeout(handle);
      remaining -= Date.now() - startedAt;
      remaining = Math.max(0, remaining);
    },
    resume() {
      if (!paused) return;
      paused = false;
      startedAt = Date.now();
      handle = setTimeout(fn, remaining);
    },
    cancel() {
      clearTimeout(handle);
    },
  };
}

/**
 * @param {HTMLElement} container - persistent element to mount the
 *   canvas and the two (invisible, decode-only) video elements into.
 * @param {HTMLElement} [qrCardEl] - the real QR card element to
 *   sequence around (must already exist and be laid out - its
 *   getBoundingClientRect() drives where the video overlay is
 *   positioned/sized). Defaults to #player-qr (the Big Display's own
 *   QR card) so existing call sites (display.js) don't need to change.
 *   The Upload Preview passes its own scoped QR card element instead,
 *   so the exact same walker implementation can run independently
 *   inside a small preview without colliding with the Big Display's
 *   instance (different qrCardEl, different container, entirely
 *   separate video elements/canvas/timers per call).
 * @returns {{ destroy(): void }|undefined} undefined if nothing was
 *   mounted (already mounted on this container, no qrCardEl found, or
 *   prefers-reduced-motion).
 */
export function initQRVideoWalker(container, qrCardEl) {
  if (!container || container.dataset.qrVideoWalkerMounted === '1') return;
  container.dataset.qrVideoWalkerMounted = '1';

  const qrEl = qrCardEl || document.getElementById('player-qr');
  if (!qrEl) return; // nothing to sequence around - bail out silently

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    // Skip the videos entirely - just leave the real QR statically
    // visible rather than forcing motion on an environment that has
    // opted out of it.
    qrEl.style.opacity = '1';
    return;
  }

  // --- Decode-only video elements (never the visible layer). ---
  function makeSourceVideo(src) {
    const v = document.createElement('video');
    v.src = src;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('aria-hidden', 'true');
    v.className = 'qr-video-overlay-source';
    container.appendChild(v);
    return v;
  }
  const placeVideo = makeSourceVideo(VIDEO_SRC.place);
  const pickupVideo = makeSourceVideo(VIDEO_SRC.pickup);
  placeVideo.load();
  pickupVideo.load();

  // --- The single visible layer: a canvas holding the keyed-alpha
  // frame of whichever video is currently active. ---
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_W;
  canvas.height = VIDEO_H;
  canvas.className = 'qr-video-overlay-canvas';
  canvas.style.opacity = '0';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // --- The paused-state visible layer: the exact supplied QR image
  // (public/assets/videos/qr-pause-only.png - see QR_PAUSE_SRC), shown
  // ONLY during the 20s freeze in place of either the full baked video
  // frame or the site's normal library-generated #player-qr card. Sized/
  // positioned by computeQrOnlyRect() so it lines up exactly with the
  // physical QR in the frozen video frame - see layout() below. ---
  const pauseQrImg = document.createElement('img');
  pauseQrImg.src = QR_PAUSE_SRC;
  pauseQrImg.alt = '';
  pauseQrImg.setAttribute('aria-hidden', 'true');
  pauseQrImg.className = 'qr-video-overlay-qr';
  pauseQrImg.style.opacity = '0';
  container.appendChild(pauseQrImg);

  function layout() {
    const qrRectVisual = qrEl.getBoundingClientRect();
    if (qrRectVisual.width === 0 || qrRectVisual.height === 0) return; // QR not laid out yet

    // `container` (and therefore `canvas`, its child) is `position:
    // fixed; inset:0` - normally that's fixed-to-the-true-viewport, but
    // per the CSS spec a `transform` on an ancestor (none on the real
    // Big Display; exactly one - the scaled-down preview "stage" - in
    // screen-preview.js) makes THAT ancestor the containing block
    // instead. getBoundingClientRect() always returns final, on-screen
    // (post-transform) coordinates, but a position:fixed element's own
    // left/top/width/height are resolved in its containing block's
    // LOCAL (pre-transform) coordinate space - so on the real Big
    // Display (no transform, containing block = true viewport, 1:1)
    // those two coincide and using the raw rect directly is correct,
    // but inside a scaled preview they do NOT coincide and using the
    // raw rect directly would misplace the overlay by the scale factor.
    // Comparing container's own visual size (getBoundingClientRect) to
    // its LOCAL size (offsetWidth, which CSS transforms never affect)
    // gives the exact ambient scale with no coordination needed from
    // whatever mounted this - dividing it back out converts qrEl's
    // visual rect into the same local coordinate space canvas.style.
    // left/top/width/height need, and is a no-op (scale === 1) in the
    // untransformed Big Display case, so this is safe there too.
    const containerRectVisual = container.getBoundingClientRect();
    const ambientScale = container.offsetWidth ? containerRectVisual.width / container.offsetWidth : 1;
    const qrRectLocal = {
      left: (qrRectVisual.left - containerRectVisual.left) / ambientScale,
      top: (qrRectVisual.top - containerRectVisual.top) / ambientScale,
      right: (qrRectVisual.right - containerRectVisual.left) / ambientScale,
      bottom: (qrRectVisual.bottom - containerRectVisual.top) / ambientScale,
      width: qrRectVisual.width / ambientScale,
      height: qrRectVisual.height / ambientScale
    };

    const box = computeOverlayRect(qrRectLocal);
    canvas.style.left = `${box.left}px`;
    canvas.style.top = `${box.top}px`;
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;

    const qrBox = computeQrOnlyRect(qrRectLocal);
    pauseQrImg.style.left = `${qrBox.left}px`;
    pauseQrImg.style.top = `${qrBox.top}px`;
    pauseQrImg.style.width = `${qrBox.width}px`;
    pauseQrImg.style.height = `${qrBox.height}px`;

  }
  layout();
  window.addEventListener('resize', layout);

  function showCanvas(visible) {
    canvas.style.opacity = visible ? '1' : '0';
  }
  function showPauseQr(visible) {
    // Deliberately an instant toggle, not a fade - see the file header:
    // this image is pixel-position-identical to the video's own physical
    // QR at the exact instants this is called (computeQrOnlyRect derives
    // from the same box as the video canvas), so a fade would only add a
    // double-exposure risk that a hard cut avoids.
    pauseQrImg.style.opacity = visible ? '1' : '0';
  }
  function showDomQR(visible) {
    // Deliberately no transition/fade here - see the file header: the
    // canvas and the real card are pixel-identical at every instant
    // this is called, so an instant toggle is the seamless option and
    // a fade would only add a double-exposure risk.
    qrEl.style.opacity = visible ? '1' : '0';
  }
  // Both start hidden - the first thing the viewer sees is the man
  // arriving and placing the card, not the QR appearing on its own.
  showCanvas(false);
  showPauseQr(false);
  showDomQR(false);

  let disposed = false;
  let activeVideo = null;
  let lastDrawnTime = -1;
  const activeTimers = new Set();

  function wait(ms, next) {
    const timer = pausableTimeout(() => {
      activeTimers.delete(timer);
      if (!disposed) next();
    }, ms);
    activeTimers.add(timer);
    return timer;
  }

  let hiddenPausedVideo = false;
  function onVisibilityChange() {
    if (document.hidden) {
      for (const t of activeTimers) t.pause();
      if (activeVideo && !activeVideo.paused) {
        activeVideo.pause();
        hiddenPausedVideo = true;
      }
    } else {
      for (const t of activeTimers) t.resume();
      if (activeVideo && hiddenPausedVideo) {
        activeVideo.play().catch(() => {});
        hiddenPausedVideo = false;
      }
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // --- Per-frame draw loop: only re-keys a frame when the active
  // video's currentTime has actually moved (so the 20s freeze costs
  // nothing per frame beyond a cheap number comparison), and only
  // runs the keying pass at all while the canvas is the visible layer. ---
  function drawFrame() {
    if (!activeVideo || activeVideo.readyState < 2) return;
    const t = activeVideo.currentTime;
    if (t === lastDrawnTime) return;
    lastDrawnTime = t;
    ctx.clearRect(0, 0, VIDEO_W, VIDEO_H);
    ctx.drawImage(activeVideo, 0, 0, VIDEO_W, VIDEO_H);
    const frame = ctx.getImageData(0, 0, VIDEO_W, VIDEO_H);
    applyLumaKey(frame.data);
    ctx.putImageData(frame, 0, 0);
  }
  let rafHandle = null;
  function loop() {
    if (!disposed) {
      drawFrame();
      rafHandle = requestAnimationFrame(loop);
    }
  }
  rafHandle = requestAnimationFrame(loop);

  function playForward(video, onEnded) {
    activeVideo = video;
    lastDrawnTime = -1; // force a redraw of the new video's current frame
    const handleEnded = () => {
      video.removeEventListener('ended', handleEnded);
      activeVideo = null;
      if (!disposed) onEnded();
    };
    video.addEventListener('ended', handleEnded);
    if (!document.hidden) {
      video.play().catch(() => {
        // Autoplay blocked or source not ready - don't get stuck forever;
        // move on rather than freezing the whole sequence.
        handleEnded();
      });
    }
  }

  // --- The exact state machine: PLACE_PLAYING -> PICKUP_FROZEN_20S ->
  // PICKUP_PLAYING -> EMPTY_10S -> repeat. Only one of {a video
  // playing, a wait timer running} drives the *sequence* forward at
  // once, so only one cycle can run at a time by construction (the
  // grip-hide timer during PICKUP_PLAYING is secondary bookkeeping,
  // not a sequence step). ---
  function statePlacePlaying() {
    showDomQR(false);
    placeVideo.currentTime = 0;
    showCanvas(true);
    playForward(placeVideo, statePickupFrozen20s);
  }
  function statePickupFrozen20s() {
    // placeVideo just ended on the stationary completed card; that frame
    // is pixel-identical to pickupVideo's own frame 0 AND to the exact
    // region the supplied QR-only image (QR_PAUSE_SRC) is measured
    // against (computeQrOnlyRect derives from the same box as the video
    // canvas - see above). So the handoff here is: freeze pickupVideo at
    // time 0 (matches the canvas's last drawn frame), then swap the
    // visible layer from the canvas to the supplied QR-only image in the
    // same instant - not to the full baked card/canvas frame, and not to
    // the site's normal heading+CTA QR card (#player-qr, which stays
    // hidden throughout - see showDomQR(false) below).
    pickupVideo.currentTime = 0;
    pickupVideo.pause();
    activeVideo = pickupVideo;
    lastDrawnTime = -1; // the always-running RAF loop (see loop()/drawFrame()
                         // below) redraws this into the canvas on its very
                         // next tick regardless of the canvas's own
                         // visibility, so it's already current by the time
                         // statePickupPlaying() reveals it again - no
                         // explicit draw needed here.
    showDomQR(false);
    showCanvas(false);
    showPauseQr(true);
    wait(DURATIONS.PICKUP_FROZEN_20S, statePickupPlaying);
  }
  function statePickupPlaying() {
    // Swap back from the supplied QR-only image to the canvas at the
    // exact instant pickupVideo resumes from the same frame 0 it was
    // frozen on - still pixel-identical (computeQrOnlyRect vs the video's
    // own physical QR), so still an instant, invisible cut.
    showPauseQr(false);
    showDomQR(false);
    showCanvas(true);
    const gripTimer = wait(GRIP_TIME_S * 1000, () => {
      // The man's hand has started moving the card in the video -
      // hide the real overlay so only the video's carried-away card
      // is shown for the rest of the lift/exit.
    });
    playForward(pickupVideo, () => {
      activeTimers.delete(gripTimer);
      gripTimer.cancel();
      showDomQR(false);
      stateEmpty10s();
    });
  }
  function stateEmpty10s() {
    // pickupVideo already ends on an empty frame (man fully exited),
    // so hiding the canvas here is not itself a visible change.
    showCanvas(false);
    showPauseQr(false);
    showDomQR(false);
    wait(DURATIONS.EMPTY_10S, statePlacePlaying);
  }

  statePlacePlaying();

  const destroy = () => {
    disposed = true;
    window.removeEventListener('resize', layout);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    for (const t of activeTimers) t.cancel();
    activeTimers.clear();
    if (rafHandle) cancelAnimationFrame(rafHandle);
    placeVideo.pause();
    pickupVideo.pause();
    placeVideo.remove();
    pickupVideo.remove();
    canvas.remove();
    pauseQrImg.remove();
    container.dataset.qrVideoWalkerMounted = '0';
  };
  container._qrVideoWalkerCleanup = destroy;
  // relayout() lets a mounting page (e.g. screen-preview.js's own
  // ResizeObserver, which fires on container-size changes that are NOT
  // necessarily a window resize) force a fresh layout() call directly.
  // Deliberately a plain function call, NOT a dispatched 'resize' event
  // - layout() is already subscribed to 'resize' via the listener above,
  // so re-dispatching one from inside a resize-triggered callback would
  // call layout() a second time pointlessly at best, and at worst - if
  // anything else ever also reacts to 'resize' by calling code that
  // itself resizes something - recurse indefinitely.
  return { destroy, relayout: layout };
}

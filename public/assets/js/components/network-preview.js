import { ScreenService } from '../services/screen.service.js';
import { apiFetch } from '../core/api.js';
import { formatScreenLabel } from '../core/helpers.js';

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function fetchScreenAds(screenId) {
  return apiFetch(`/api/display/${screenId}`)
    .then((feed) => (feed && feed.ads) || [])
    .catch(() => []);
}

// Fall motion: smoother, continuously-moving multi-stage keyframe set with
// an ease-out curve, replacing the original single-stage 0/40/100 keyframes
// and the heavy ease-in cubic-bezier(0.55,0.06,0.68,0.19). That easing put
// most of the visible motion in the back half of the 700ms duration, which
// on a small preview box reads as a pause-then-snap rather than a
// continuous physical fall. rotate3d + translate3d only, opacity stays 1
// throughout (no fade), and the incoming layer still gets NO entrance
// animation - it simply sits underneath and is revealed as the outgoing
// layer falls away.
const FALL_DURATION_MS = 700;
const FALL_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

let smallFallStylesInjected = false;

function ensureSmallFallStyles() {
  if (smallFallStylesInjected) return;
  smallFallStylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes lumen-small-fall {
      0% {
        transform: rotate3d(0, 0, 1, 0deg) translate3d(0, 0, 0);
        opacity: 1;
      }
      25% {
        transform: rotate3d(0, 0, 1, -8deg) translate3d(-2%, 8%, 0);
        opacity: 1;
      }
      50% {
        transform: rotate3d(0, 0, 1, -18deg) translate3d(-5%, 30%, 0);
        opacity: 1;
      }
      75% {
        transform: rotate3d(0, 0, 1, -29deg) translate3d(-9%, 65%, 0);
        opacity: 1;
      }
      100% {
        transform: rotate3d(0, 0, 1, -40deg) translate3d(-15%, 120%, 0);
        opacity: 1;
      }
    }
    .small-network-preview .fall-page.is-falling {
      transform-origin: 0% 0%;
      will-change: transform;
      animation: lumen-small-fall ${FALL_DURATION_MS}ms ${FALL_EASING} forwards;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Plays the fall transition: the OUTER layer (outgoing) falls away and
 * reveals the incoming layer already sitting underneath. The transform is
 * applied to this outer layer only - never to the img/video itself - so
 * aspect ratio inside is never touched by the fall.
 */
async function runSmallFallTransition(outgoing, incoming) {
  if (!outgoing || !incoming) {
    if (incoming) {
      incoming.style.display = 'flex';
      incoming.style.zIndex = '1';
    }
    return;
  }

  ensureSmallFallStyles();

  // Incoming is already placed underneath before we start - this is what
  // prevents any black flash between media.
  incoming.style.position = 'absolute';
  incoming.style.inset = '0';
  incoming.style.display = 'flex';
  incoming.style.zIndex = '1';
  incoming.style.backfaceVisibility = 'hidden';
  incoming.style.transformStyle = 'preserve-3d';

  outgoing.style.position = 'absolute';
  outgoing.style.inset = '0';
  outgoing.style.zIndex = '2';
  outgoing.style.backfaceVisibility = 'hidden';
  outgoing.style.transformStyle = 'preserve-3d';

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      outgoing.classList.remove('is-falling');
      outgoing.style.display = 'none';
      outgoing.style.zIndex = '';
      outgoing.innerHTML = '';
      incoming.style.zIndex = '2';
      resolve();
    };

    const handleAnimationEnd = (event) => {
      if (event.target !== outgoing) return;
      if (event.animationName !== 'lumen-small-fall') return;
      finish();
    };

    outgoing.addEventListener('animationend', handleAnimationEnd, { once: true });

    // Restart the animation every time, same as the reference: remove the
    // class, force a reflow, then re-add it.
    outgoing.classList.remove('is-falling');
    void outgoing.offsetWidth;
    outgoing.classList.add('is-falling');

    // Safety net only - never fires under normal playback, just guards
    // against a dropped animationend event so the loop can't get stuck.
    setTimeout(finish, FALL_DURATION_MS + 200);
  });
}

export function mountNetworkPreview(container, opts = {}) {
  const { labelEl = null, adDisplayMs = 4000, introMs = 3000 } = opts;
  let destroyed = false;
  let currentScreenIndex = 0;
  let prefetched = null; // { screenId, promise }

  container.innerHTML = '';
  container.classList.add('small-network-preview');
  container.style.position = 'relative';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.perspective = '1200px';
  container.style.overflow = 'hidden';

  const layerA = document.createElement('div');
  const layerB = document.createElement('div');
  [layerA, layerB].forEach((l) => {
    l.classList.add('fall-page');
    l.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#030405;backface-visibility:hidden;transform-style:preserve-3d;transform-origin:0% 0%;will-change:transform;';
  });
  layerA.style.zIndex = '2';
  layerB.style.zIndex = '1';
  container.appendChild(layerB);
  container.appendChild(layerA);
  let active = layerA;
  let idle = layerB;

  function buildLumenFragment() {
    const el = document.createElement('div');
    el.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(124,156,255,0.16), transparent 65%), #030405;text-align:center;padding:8%;';
    el.innerHTML = `
      <div style="width:22%;aspect-ratio:1;max-width:40px;border-radius:22%;background:linear-gradient(135deg,#7C9CFF 0%,#B48CFF 55%,#FF6A3D 100%);box-shadow:0 0 30px rgba(124,156,255,0.35);"></div>
      <div style="font-family:Inter,-apple-system,sans-serif;font-weight:800;font-size:clamp(11px,7%,20px);letter-spacing:0.08em;color:#fff;">LUMEN</div>
    `;
    el.dataset.kind = 'lumen';
    return el;
  }

  function buildAdFragment(ad) {
    const el = document.createElement('div');
    el.style.cssText = 'width:100%;height:100%;position:relative;background:#000;overflow:hidden;';

    // Background layer for letterboxing/pillarboxing - blurred and scaled.
    const bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;inset:-20%;background-size:cover;background-position:center;filter:blur(30px) brightness(0.4);transform:scale(1.2);z-index:0;';

    // Foreground layer - always object-fit:contain so portrait/landscape
    // media never gets stretched, regardless of the container's shape.
    const fg = document.createElement('div');
    fg.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:1;';

    if (ad.mediaType === 'video') {
      const video = document.createElement('video');
      video.className = 'network-preview-media';
      video.src = ad.mediaUrl;
      video.style.cssText = 'max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;';
      video.muted = true;
      video.playsInline = true;
      video.loop = false;
      video.play().then(() => {
        video.muted = false;
        video.play().catch(() => { video.muted = true; });
      }).catch(() => {});

      bg.style.backgroundImage = `url(${ad.mediaUrl})`;
      fg.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.className = 'network-preview-media';
      img.src = ad.mediaUrl;
      img.alt = formatScreenLabel(ad.screenId) || 'Advertisement';
      img.style.cssText = 'max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;';

      bg.style.backgroundImage = `url(${ad.mediaUrl})`;
      fg.appendChild(img);
    }

    el.appendChild(bg);
    el.appendChild(fg);
    el.dataset.kind = 'ad';
    return el;
  }

  /** Ad -> ad within the same screen: same fall transition as everywhere else. */
  async function crossfadeAd(buildFn) {
    if (destroyed) return;

    idle.innerHTML = '';
    idle.appendChild(buildFn());

    await runSmallFallTransition(active, idle);

    active.innerHTML = '';
    [active, idle] = [idle, active];
  }

  /**
   * Screen -> screen: the exact same fall transition, just with the
   * incoming screen's Lumen intro as the frame underneath.
   *
   * Must swap the active/idle references after the fall completes, exactly
   * like crossfadeAd() does. Without this, the `active`/`idle` variables
   * fall out of sync with which DOM layer is actually visible (idle stays
   * "idle" even though it's now on top with z-index 2). The very next call
   * that touches `idle` - e.g. crossfadeAd() playing this screen's first ad -
   * would then wipe the *currently visible* layer's innerHTML instantly and
   * animate the already-hidden layer instead, producing exactly the instant
   * swap / blank-frame behavior this transition is supposed to avoid.
   */
  async function wipeToScreen(buildFirstFrameFn) {
    if (destroyed) return;

    idle.innerHTML = '';
    idle.appendChild(buildFirstFrameFn());

    await runSmallFallTransition(active, idle);
    active.innerHTML = '';
    [active, idle] = [idle, active];
  }

  async function loop() {
    let firstEntryEver = true;

    while (!destroyed) {
      // Screens are always walked in backend order (001 -> 002 -> 003 -> ...
      // -> back to 001), never shuffled or randomized.
      const screens = await ScreenService.list().catch(() => []);
      if (destroyed) return;

      if (!screens.length) {
        if (labelEl) labelEl.textContent = 'Lumen Network';
        if (firstEntryEver) {
          idle.appendChild(buildLumenFragment());
          idle.style.zIndex = '2'; active.style.zIndex = '1';
          [active, idle] = [idle, active]; idle.innerHTML = '';
          firstEntryEver = false;
        } else {
          await wipeToScreen(buildLumenFragment);
        }
        await wait(introMs);
        currentScreenIndex = 0;
        continue; // re-check for real screens next pass
      }

      if (currentScreenIndex >= screens.length) currentScreenIndex = 0;
      const screen = screens[currentScreenIndex];
      if (labelEl) labelEl.textContent = screen.place || screen.id;

      const ads = (prefetched && prefetched.screenId === screen.id)
        ? await prefetched.promise
        : await fetchScreenAds(screen.id);
      prefetched = null;
      if (destroyed) return;

      // Entering this screen's round: its Lumen intro always plays again,
      // every single time the screen becomes active - even on repeat loops.
      if (firstEntryEver) {
        idle.appendChild(buildLumenFragment());
        await runSmallFallTransition(active, idle);
        // Same active/idle swap wipeToScreen() does after its fall - see the
        // comment there. Without it, this very first screen's first ad
        // transition (the next crossfadeAd() call) wipes the visible layer
        // instantly instead of falling.
        active.innerHTML = '';
        [active, idle] = [idle, active];
        firstEntryEver = false;
      } else {
        await wipeToScreen(buildLumenFragment);
      }
      await wait(introMs);
      if (destroyed) return;

      if (!ads.length) {
        // Zero-ad screen: it still shows its Lumen intro (above), then
        // falls straight through to the next screen. Kick off that next
        // screen's prefetch now so the upcoming wipe never has to wait.
        const nextIdx = (currentScreenIndex + 1) % screens.length;
        const nextScreen = screens[nextIdx];
        if (nextScreen) {
          prefetched = { screenId: nextScreen.id, promise: fetchScreenAds(nextScreen.id) };
        }
      }

      // Play every ad that belongs to this screen, in order, before moving on.
      for (let i = 0; i < ads.length; i++) {
        if (destroyed) return;
        await crossfadeAd(() => buildAdFragment(ads[i]));

        // On the last ad, start fetching the next screen's ads in the
        // background so the screen-to-screen fall never has to wait.
        if (i === ads.length - 1) {
          const nextIdx = (currentScreenIndex + 1) % screens.length;
          const nextScreen = screens[nextIdx];
          if (nextScreen) {
            prefetched = { screenId: nextScreen.id, promise: fetchScreenAds(nextScreen.id) };
          }
        }
        await wait(adDisplayMs);
      }

      currentScreenIndex = (currentScreenIndex + 1) % screens.length;
    }
  }

  loop();

  return {
    destroy() {
      destroyed = true;
      container.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); });
    }
  };
}

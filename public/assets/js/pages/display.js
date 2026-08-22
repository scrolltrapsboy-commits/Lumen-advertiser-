import { apiFetch } from '../core/api.js';
import { qs, qsa, escapeHTML, formatScreenLabel } from '../core/helpers.js';
import { watchLive } from '../core/live.js';
import { showLoader, hideLoader } from '../components/loader.js';

/**
 * Runs the exact fall-in transition for ALL media types.
 * Uses the reference CSS animations (lumen-player-page-fall / lumen-player-page-fall-in).
 * 
 * The incoming layer is revealed instantly underneath the outgoing one
 * (painter's order, no CSS opacity transition), then both animate
 * simultaneously - outgoing falls away, incoming settles in.
 * 
 * This replaces the old shatter/dissolve engines with a single,
 * unified falling-page transition that works for ALL media combinations:
 * image->image, image->video, video->image, video->video.
 */
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

    let feed;
    try {
      feed = await apiFetch(`/api/display/${screenId}`);
    } catch (err) {
      renderStatus('Invalid Screen ID', err.message || `No display is registered with ID "${screenId}".`, 'error');
      return;
    }

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
   * Mounted exactly once per screen connection. The LIVE badge, brand,
   * place text, and QR code live here permanently — subsequent state
   * changes (closed/open, ads arriving/emptying, place renamed) update
   * this DOM in place and never rebuild it, so the overlay never flickers
   * or disappears while the player is running.
   */
  function mountPlayerShell(config, screen) {
    const place = screen ? screen.place : '';
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

        <!-- Minimal QR (Bottom-Right): mounted once, never rebuilt -->
        <div class="player-qr" id="player-qr">
          <div class="player-qr-card">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(config.siteUrl || window.location.origin)}"
                 alt="QR code">
            <p>Scan to Advertise</p>
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

    const backdrop = document.createElement('div');
    backdrop.className = 'player-backdrop';

    const overlay = document.createElement('div');
    overlay.className = 'player-backdrop-overlay';

    const content = document.createElement('div');
    content.className = 'player-media-content';

    if (ad.mediaType === 'image') {
      const bgImg = new Image();
      bgImg.className = 'player-backdrop-media';
      bgImg.crossOrigin = 'anonymous';
      bgImg.src = ad.mediaUrl;

      const fgImg = new Image();
      fgImg.className = 'player-foreground-media';
      fgImg.crossOrigin = 'anonymous';
      fgImg.src = ad.mediaUrl;
      fgImg.alt = formatScreenLabel(ad.screenId) || 'Advertisement';
      // Decoding happens in the background; we don't wait on it. Most ad
      // images are already warm in the browser cache from a prior round.
      if (fgImg.decode) fgImg.decode().catch(() => {});

      backdrop.appendChild(bgImg);
      backdrop.appendChild(overlay);
      content.appendChild(fgImg);
      fragment.appendChild(backdrop);
      fragment.appendChild(content);

      hideSoundToggle();
      audioState.current = null;
      return { fragment, type: 'image' };
    }

    const bgVideo = document.createElement('video');
    bgVideo.className = 'player-backdrop-media';
    bgVideo.src = ad.mediaUrl;
    bgVideo.muted = true; // backdrop is a decorative blurred duplicate — always silent
    bgVideo.playsInline = true;
    bgVideo.preload = 'auto';

    const fgVideo = document.createElement('video');
    fgVideo.className = 'player-foreground-media';
    fgVideo.src = ad.mediaUrl;
    // Start muted so the browser never blocks playback itself, then try
    // to unmute immediately after — either because the session was
    // already unlocked by a prior tap, or because this browser happens
    // to allow it. If the unmuted attempt is rejected, we stay muted
    // and surface the tap-to-enable-sound control instead of pretending
    // audio is on.
    fgVideo.muted = true;
    fgVideo.playsInline = true;
    fgVideo.preload = 'auto';
    audioState.current = fgVideo;

    // Keep backdrop video in sync with foreground video
    fgVideo.addEventListener('play', () => bgVideo.play().catch(() => {}));
    fgVideo.addEventListener('pause', () => bgVideo.pause());
    fgVideo.addEventListener('seeking', () => { bgVideo.currentTime = fgVideo.currentTime; });

    backdrop.appendChild(bgVideo);
    backdrop.appendChild(overlay);
    content.appendChild(fgVideo);
    fragment.appendChild(backdrop);
    fragment.appendChild(content);

    // Fire the actual load/decode/play work now, without waiting for it —
    // it proceeds concurrently with the transition the caller is about to
    // start. No setTimeout, no artificial delay: the video simply becomes
    // visible/audible whenever the browser has it ready, which for these
    // short ad clips is typically well within the transition's own
    // duration.
    //
    // Audio strategy: try unmuted play first. If the browser allows it,
    // great - no UI needed. If it rejects, fall back to muted + show
    // the sound toggle button for user gesture unlock.
    const tryUnmuted = () => {
      fgVideo.muted = false;
      return fgVideo.play();
    };

    fgVideo.play().then(() => {
      // Video started (muted). Now try unmuted if we have a user gesture
      // or if the browser permits it without one.
      if (audioState.unlocked) {
        tryUnmuted().catch(() => {
          fgVideo.muted = true;
          showSoundToggle();
        });
      } else {
        // No user gesture yet - try unmuted anyway. Some browsers allow
        // it based on heuristic (e.g., user has played media on this
        // origin before). If rejected, stay muted and show the button.
        tryUnmuted().catch(() => {
          fgVideo.muted = true;
          showSoundToggle();
        });
      }
    }).catch(() => {
      // Even muted play failed (rare) - show button as last resort
      showSoundToggle();
    });
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
        currentSingleAdId = singleAd.id;
        lastAdMediaType = singleAd.mediaType;
        const currentLayerEl = document.getElementById('layer-a');
        if (currentLayerEl) {
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

      const currentId = activeLayer === 'a' ? 'layer-a' : 'layer-b';
      const nextId = activeLayer === 'a' ? 'layer-b' : 'layer-a';
      const currentLayer = document.getElementById(currentId);
      const nextLayer = document.getElementById(nextId);
      const canvasContainer = document.getElementById('bas-canvas-container');

      if (!nextLayer) return;

      // 1. Prepare next media (fully decoded in memory before showing)
      const prepared = prepareMediaElement(ad);

      // 2. Clear and append to next layer
      nextLayer.innerHTML = '';
      nextLayer.appendChild(prepared.fragment);
      nextLayer.className = 'player-media-layer';

      // 3. Run the exact fall-in transition for ALL media types.
      // The fall-in transition works for all combinations:
      // image->image, image->video, video->image, video->video.
      await runFallTransition({ currentLayer, nextLayer, durationMs: 900 });

      lastAdMediaType = ad.mediaType;
      activeLayer = activeLayer === 'a' ? 'b' : 'a';
      index += 1;
      if (index >= ads.length) {
        index = 0;
        // Big display does not show Lumen intro between rounds
      }

      // Preload next image/video in memory
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

      clearTimeout(mediaTimer);

      let nextTriggered = false;
      const triggerNext = () => {
        if (nextTriggered) return;
        nextTriggered = true;
        clearTimeout(mediaTimer);
        refreshFeed().then(showFrame);
      };

      if (ad.mediaType === 'video') {
        // VIDEO DURATION: Play completely until ended, never cut off before it finishes
        if (prepared.mainVideo) {
          prepared.mainVideo.addEventListener('ended', triggerNext, { once: true });
          const vidDurationSec = prepared.mainVideo.duration || Number(ad.duration) || 30;
          mediaTimer = setTimeout(triggerNext, Math.ceil(vidDurationSec * 1000) + 800);
        } else {
          mediaTimer = setTimeout(triggerNext, (Number(ad.duration) || 10) * 1000);
        }
      } else {
        // IMAGE DURATION: Display for selected image duration (5, 10, 15, 20, 30s)
        const durationMs = Number(ad.duration || 10) * 1000;
        mediaTimer = setTimeout(triggerNext, Math.max(3000, durationMs));
      }
    }

    // Live socket/poll watcher for screen or ad changes
    stopWatch = watchLive({
      'ads.json': (data) => { if (!data?.localEmit) refreshFeed(); },
      'screens.json': (data) => { if (!data?.localEmit) refreshFeed(); }
    }, { intervalMs: 2000 });

    window.addEventListener('beforeunload', () => {
      if (stopWatch) stopWatch();
      clearTimeout(mediaTimer);
    });

    showFrame();
  }
})();

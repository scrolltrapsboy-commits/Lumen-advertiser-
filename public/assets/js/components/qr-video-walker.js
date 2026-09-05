/**
 * QR video walker (v3) - two pre-rendered videos (public/assets/videos/
 * qr-place.mp4, qr-pickup.mp4) of a real man placing/picking up the QR
 * advertisement, composited over the real page with GENUINE per-pixel
 * alpha transparency (a WebGL chroma-key shader - not
 * `mix-blend-mode: screen`, which only fakes it and still leaves faint
 * near-black edge artifacts). Neither MP4 is modified.
 *
 * SEAMLESS HANDOFF: confirmed by directly inspecting frames of both
 * videos that qr-place.mp4's final frame and qr-pickup.mp4's first
 * frame are pixel-identical (same card, same position). So the handoff
 * is: the instant qr-place.mp4 fires 'ended', start sampling
 * qr-pickup.mp4 (already preloaded and paused at time 0) into the SAME
 * canvas instead - one frame looks the same as the next, no fade/cut.
 *
 * TRUE FREEZE: qr-pickup.mp4 is simply left `.paused` at time 0 for the
 * 20s hold - the canvas isn't redrawn during that time (no rAF calls),
 * so the last-rendered pixels just sit there untouched. `.play()`
 * resumes it exactly where it was.
 *
 * SCANNABILITY: the video's own baked-in QR pattern is an AI
 * reproduction, not guaranteed decodable. During the 20s freeze only,
 * a real generated QR (same generateQRSvgMarkup() used for the site's
 * own QR - genuinely scannable, no chrome/border/text around it) is
 * overlaid exactly on top of the video's white QR square - measured
 * directly from the reference frame, not guessed - so it reads as part
 * of the same card, not a second card.
 */
import { generateQRSvgMarkup } from './qr-code.js';

const VIDEO_SRC = {
  place: 'assets/videos/qr-place.mp4',
  pickup: 'assets/videos/qr-pickup.mp4',
};

const VIDEO_W = 1280;
const VIDEO_H = 720;

// The QR "card" (QR + heading + CTA) - measured via a non-black-pixel
// scan of both videos' pixel-identical resting frame.
const CARD = { left: 107 / VIDEO_W, top: 106 / VIDEO_H, right: 1195 / VIDEO_W, bottom: 612 / VIDEO_H };

// The white QR square specifically (excludes the gradient border and
// the heading/CTA text) - measured via a low-saturation/high-value scan
// restricted to the left portion of the same reference frame:
// left=120 top=120 right=643 bottom=601 of the native 1280x720 frame.
const QR_SQUARE = { left: 120 / VIDEO_W, top: 120 / VIDEO_H, right: 643 / VIDEO_W, bottom: 601 / VIDEO_H };

const DURATIONS = { FROZEN_20S: 20000, EMPTY_10S: 10000 };

const MAX_DPR = 2;

function computeOverlayRect(qrRect) {
  const cardWidthFrac = CARD.right - CARD.left;
  const scale = qrRect.width / (cardWidthFrac * VIDEO_W);
  const width = VIDEO_W * scale;
  const height = VIDEO_H * scale;
  const left = qrRect.right - width * CARD.right;
  const top = qrRect.bottom - height * CARD.bottom;
  return { left, top, width, height };
}

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
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
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

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Chroma-key: both source videos are shot on solid matte black. Alpha
// is derived from luminance with a soft (smoothstep) threshold rather
// than a hard cutoff, specifically to avoid a visible hard-edged halo
// around the man/card (H.264 compression leaves faint non-zero noise
// in "black" areas and soft anti-aliased edges around the subject -
// a hard cutoff would fringe those edges; the soft ramp blends them).
const FRAG_SRC = `
precision mediump float;
uniform sampler2D uVideo;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uVideo, vUv);
  float lum = max(c.r, max(c.g, c.b));
  float alpha = smoothstep(0.045, 0.16, lum);
  gl_FragColor = vec4(c.rgb * alpha, alpha);
}`;

function createChromaKeyRenderer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('Shader compile failed: ' + info);
    }
    return s;
  }
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT_SRC));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG_SRC));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Program link failed: ' + gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  return {
    /** Draws one frame from the given <video> element. */
    draw(videoEl) {
      const w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (videoEl.readyState >= 2) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoEl);
        } catch (e) {
          return; // not decodable yet this frame - leave canvas as-is
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    },
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
    },
  };
}

export function initQRVideoWalker(container, options = {}) {
  if (!container || container.dataset.qrVideoWalkerMounted === '1') return;
  container.dataset.qrVideoWalkerMounted = '1';

  const qrCardEl = document.getElementById('player-qr');
  if (!qrCardEl) return;
  // The video itself renders the whole card (QR + text + CTA) as
  // chroma-keyed pixels at every stage of the sequence, including the
  // 20s freeze - the site's own full card element is never shown
  // alongside it (that would be a second, duplicate card).
  qrCardEl.style.opacity = '0';

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    // No motion at all - nothing to freeze-frame either, so just leave
    // the scene empty rather than showing a still man with no context.
    return;
  }

  function makeVideo(src) {
    const v = document.createElement('video');
    v.src = src;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.style.display = 'none'; // never shown directly - only sampled as a texture
    container.appendChild(v);
    return v;
  }
  const placeVideo = makeVideo(VIDEO_SRC.place);
  const pickupVideo = makeVideo(VIDEO_SRC.pickup);
  placeVideo.load();
  pickupVideo.load();

  const canvas = document.createElement('canvas');
  canvas.className = 'qr-video-overlay-canvas';
  container.appendChild(canvas);
  let renderer = null;
  try {
    renderer = createChromaKeyRenderer(canvas);
  } catch (e) {
    renderer = null; // WebGL unavailable - fail silently, no overlay rendered
  }

  // Bare QR (no card chrome) shown ONLY during the 20s freeze, sized to
  // sit exactly over the video's own white QR square.
  const qrOverlay = document.createElement('div');
  qrOverlay.className = 'qr-video-overlay-realqr';
  qrOverlay.style.opacity = '0';
  try {
    qrOverlay.innerHTML = generateQRSvgMarkup(options.qrDestination || window.location.origin);
  } catch (e) {
    /* no real QR available - the video's own baked pattern is still shown */
  }
  container.appendChild(qrOverlay);

  function layout() {
    const rect = qrCardEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const box = computeOverlayRect(rect);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.style.left = `${box.left}px`;
    canvas.style.top = `${box.top}px`;
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;
    if (renderer) renderer.resize(Math.round(box.width * dpr), Math.round(box.height * dpr));

    qrOverlay.style.left = `${box.left + box.width * QR_SQUARE.left}px`;
    qrOverlay.style.top = `${box.top + box.height * QR_SQUARE.top}px`;
    qrOverlay.style.width = `${box.width * (QR_SQUARE.right - QR_SQUARE.left)}px`;
    qrOverlay.style.height = `${box.height * (QR_SQUARE.bottom - QR_SQUARE.top)}px`;
  }
  layout();
  window.addEventListener('resize', layout);

  let disposed = false;
  let rafId = null;
  let activeVideo = null;

  function renderLoop() {
    if (disposed) return;
    if (renderer && activeVideo) renderer.draw(activeVideo);
    rafId = requestAnimationFrame(renderLoop);
  }
  function startRendering(video) {
    activeVideo = video;
    if (rafId === null) rafId = requestAnimationFrame(renderLoop);
  }
  function stopRendering() {
    activeVideo = null;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  let currentTimer = null;
  let pausedForHiddenTab = null;

  function onVisibilityChange() {
    if (document.hidden) {
      if (currentTimer) currentTimer.pause();
      if (activeVideo && !activeVideo.paused) {
        activeVideo.pause();
        pausedForHiddenTab = activeVideo;
      }
    } else {
      if (currentTimer) currentTimer.resume();
      if (pausedForHiddenTab) {
        pausedForHiddenTab.play().catch(() => {});
        pausedForHiddenTab = null;
      }
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  function wait(ms, next) {
    currentTimer = pausableTimeout(() => {
      currentTimer = null;
      if (!disposed) next();
    }, ms);
  }

  // --- State machine: PLACE_PLAYING -> PICKUP_FROZEN_20S ->
  // PICKUP_PLAYING -> EMPTY_10S -> repeat. ---
  function statePlacePlaying() {
    qrOverlay.style.opacity = '0';
    placeVideo.currentTime = 0;
    pickupVideo.currentTime = 0;
    pickupVideo.pause();
    startRendering(placeVideo);
    const handleEnded = () => {
      placeVideo.removeEventListener('ended', handleEnded);
      if (!disposed) statePickupFrozen20s();
    };
    placeVideo.addEventListener('ended', handleEnded);
    if (!document.hidden) placeVideo.play().catch(handleEnded);
  }

  function statePickupFrozen20s() {
    // Seamless handoff: pickupVideo is already loaded and paused at its
    // first frame, which is pixel-identical to placeVideo's last frame
    // (confirmed directly from both files) - swapping which video the
    // SAME canvas samples produces no visible change on screen.
    renderer && renderer.draw(pickupVideo);
    stopRendering();
    qrOverlay.style.opacity = '1';
    wait(DURATIONS.FROZEN_20S, statePickupPlaying);
  }

  function statePickupPlaying() {
    qrOverlay.style.opacity = '0';
    startRendering(pickupVideo);
    const handleEnded = () => {
      pickupVideo.removeEventListener('ended', handleEnded);
      if (!disposed) stateEmpty10s();
    };
    pickupVideo.addEventListener('ended', handleEnded);
    if (!document.hidden) pickupVideo.play().catch(handleEnded);
  }

  function stateEmpty10s() {
    stopRendering();
    qrOverlay.style.opacity = '0';
    wait(DURATIONS.EMPTY_10S, statePlacePlaying);
  }

  statePlacePlaying();

  container._qrVideoWalkerCleanup = () => {
    disposed = true;
    stopRendering();
    window.removeEventListener('resize', layout);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (currentTimer) currentTimer.cancel();
    placeVideo.pause();
    pickupVideo.pause();
    placeVideo.remove();
    pickupVideo.remove();
    canvas.remove();
    qrOverlay.remove();
  };
}

import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const allLogs = [];
  const pageErrors = [];
  const consoleErrors = [];
  const transitionDurations = [];
  let blackFrameSuspected = false;

  page.on('console', (msg) => {
    const t = msg.text();
    allLogs.push(t);
    if (msg.type() === 'error') consoleErrors.push(t);
    if (t.includes('actual duration')) {
      const m = t.match(/actual duration: (\d+)ms/);
      if (m) transitionDurations.push(Number(m[1]));
    }
    console.log('[BROWSER]', t);
  });
  page.on('pageerror', (err) => { pageErrors.push(err.message); console.log('[PAGE ERROR]', err.message); });

  await page.goto(`${BASE}/display?id=SCREEN001&debug=1`, { waitUntil: 'load' });

  // Sample pixels periodically for 32s to catch any black-frame moments
  // across a full rotation (image, video, image, video x2).
  const samples = [];
  for (let i = 0; i < 32; i++) {
    await page.waitForTimeout(1000);
    const sample = await page.evaluate(() => {
      const active = document.querySelector('.player-media-layer.active');
      const media = active ? active.querySelector('img.player-foreground-media, video.player-foreground-media') : null;
      const canvasOn = document.getElementById('bas-canvas-container')?.classList.contains('on');
      // Cheap "is the screen visually non-empty" proxy: sample the actual
      // rendered pixel at screen center via a temporary canvas snapshot is
      // expensive; instead check layout + element presence, which is what
      // actually determines "black" (an active layer with a properly
      // sized media element behind/within it).
      const centerEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return {
        second: null,
        hasActiveLayer: !!active,
        hasMedia: !!media,
        mediaTag: media ? media.tagName : null,
        canvasOn: !!canvasOn,
        centerElTag: centerEl ? centerEl.tagName : null,
        centerElClass: centerEl ? (typeof centerEl.className === 'string' ? centerEl.className : '') : null,
      };
    });
    sample.second = i + 1;
    samples.push(sample);
    if (!sample.hasActiveLayer || !sample.hasMedia) {
      blackFrameSuspected = true;
      console.log(`[SUSPECT BLACK FRAME at t=${i + 1}s]`, JSON.stringify(sample));
    }
  }

  // Final state: check for dual-audio, stale videos, renderer, errors.
  const finalState = await page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')];
    const unmutedPlaying = videos.filter(v => !v.muted && !v.paused);
    return {
      totalVideoElements: videos.length,
      unmutedPlayingCount: unmutedPlaying.length,
      videos: videos.map(v => ({
        layer: v.closest('.player-media-layer')?.id,
        active: v.closest('.player-media-layer')?.classList.contains('active'),
        muted: v.muted, paused: v.paused,
      })),
      layerAWidth: document.getElementById('layer-a')?.getBoundingClientRect().width,
      layerAHeight: document.getElementById('layer-a')?.getBoundingClientRect().height,
    };
  });

  console.log('\n\n========== FINAL REPORT DATA ==========');
  console.log('Total seconds sampled:', samples.length);
  console.log('Black-frame suspected:', blackFrameSuspected);
  console.log('Page errors:', pageErrors.length, pageErrors);
  console.log('Console errors:', consoleErrors.length, consoleErrors);
  console.log('Transition durations captured (ms):', transitionDurations);
  console.log('Final state:', JSON.stringify(finalState, null, 2));

  const rendererLog = allLogs.find(l => l.includes('WebGL renderer'));
  console.log('Renderer log line:', rendererLog);

  const audioSuccessCount = allLogs.filter(l => l.includes('unmuted autoplay SUCCESS')).length;
  const audioBlockedCount = allLogs.filter(l => l.includes('unmuted autoplay BLOCKED')).length;
  console.log('Audio SUCCESS count:', audioSuccessCount, '| BLOCKED count:', audioBlockedCount);

  await browser.close();
}

run().catch((e) => { console.error('HARNESS FATAL', e); process.exit(1); });

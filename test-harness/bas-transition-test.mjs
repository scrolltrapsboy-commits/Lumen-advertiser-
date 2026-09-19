import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const OUT_DIR = '/home/claude/project/lumen-advertiser/test-harness';

async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const logs = [];
  const pageErrors = [];
  const consoleErrors = [];
  const transitionDurations = [];
  const shots = [];
  let shotCount = 0;
  let lastTransitionStartAt = 0;

  page.on('console', (msg) => {
    const t = msg.text();
    logs.push(t);
    if (msg.type() === 'error') consoleErrors.push(t);
    console.log('[BROWSER]', t);
    if (t.includes('actual duration')) {
      const m = t.match(/actual duration: (\d+)ms/);
      if (m) transitionDurations.push(Number(m[1]));
    }
    if (t.includes('particle transition started')) {
      lastTransitionStartAt = Date.now();
      const n = ++shotCount;
      // three snapshots per transition: early / mid / late
      [150, 400, 700].forEach((delay, i) => {
        setTimeout(() => {
          const path = `${OUT_DIR}/shot-${n}-${['early', 'mid', 'late'][i]}.png`;
          page.screenshot({ path }).then(() => shots.push(path)).catch(() => {});
        }, delay);
      });
    }
  });
  page.on('pageerror', (err) => { pageErrors.push(err.message); console.log('[PAGE ERROR]', err.message); });

  await page.goto(`${BASE}/display?id=SCREEN001&debug=1`, { waitUntil: 'load' });

  const blackFrameChecks = [];
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const sample = await page.evaluate(() => {
      const active = document.querySelector('.player-media-layer.active');
      const media = active ? active.querySelector('img.player-foreground-media, video.player-foreground-media') : null;
      return { second: null, hasActiveLayer: !!active, hasMedia: !!media };
    });
    sample.second = i + 1;
    blackFrameChecks.push(sample);
    if (!sample.hasActiveLayer || !sample.hasMedia) {
      console.log(`[SUSPECT BLACK FRAME at t=${i + 1}s]`, JSON.stringify(sample));
    }
  }

  const finalState = await page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')];
    const layerA = document.getElementById('layer-a');
    const layerB = document.getElementById('layer-b');
    const rectA = layerA ? layerA.getBoundingClientRect() : null;
    const rectB = layerB ? layerB.getBoundingClientRect() : null;
    const canvas = document.querySelector('#bas-canvas-container canvas');
    return {
      totalVideoElements: videos.length,
      unmutedPlayingCount: videos.filter(v => !v.muted && !v.paused).length,
      videos: videos.map(v => ({
        layer: v.closest('.player-media-layer')?.id,
        active: v.closest('.player-media-layer')?.classList.contains('active'),
        muted: v.muted, paused: v.paused,
      })),
      layerARect: rectA ? { w: rectA.width, h: rectA.height } : null,
      layerBRect: rectB ? { w: rectB.width, h: rectB.height } : null,
      canvasBufferSize: canvas ? [canvas.width, canvas.height] : null,
      shellRect: (() => {
        const shell = document.getElementById('player-shell-root');
        if (!shell) return null;
        const r = shell.getBoundingClientRect();
        return { w: r.width, h: r.height };
      })(),
    };
  });

  console.log('\n\n========== FINAL REPORT ==========');
  console.log('Black-frame samples flagged:', blackFrameChecks.filter(s => !s.hasActiveLayer || !s.hasMedia).length, '/', blackFrameChecks.length);
  console.log('Page errors:', pageErrors.length, pageErrors);
  console.log('Console errors:', consoleErrors.length, consoleErrors);
  console.log('Transition durations captured (ms):', transitionDurations);
  console.log('Final state:', JSON.stringify(finalState, null, 2));

  const rendererLog = logs.find(l => l.includes('WebGL renderer'));
  console.log('Renderer:', rendererLog);
  const audioSuccessCount = logs.filter(l => l.includes('unmuted autoplay SUCCESS')).length;
  const audioBlockedCount = logs.filter(l => l.includes('unmuted autoplay BLOCKED')).length;
  console.log('Audio SUCCESS:', audioSuccessCount, '| BLOCKED:', audioBlockedCount);
  console.log('Screenshots captured:', shots.length);

  await page.waitForTimeout(800); // let final in-flight screenshots finish
  await browser.close();
}

run().catch((e) => { console.error('HARNESS FATAL', e); process.exit(1); });

import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const logs = [];
  let midShotCount = 0;
  page.on('console', (msg) => {
    const t = msg.text();
    logs.push(t);
    console.log('[BROWSER]', t);
    if (t.includes('particle transition started') && midShotCount < 4) {
      midShotCount++;
      const n = midShotCount;
      setTimeout(() => {
        page.screenshot({ path: `/home/claude/project/lumen-advertiser/test-harness/mid-transition-${n}.png` }).catch(() => {});
      }, 350);
    }
  });
  page.on('pageerror', (err) => console.log('[PAGE ERROR]', err.message));

  await page.goto(`${BASE}/display?id=SCREEN001&debug=1`, { waitUntil: 'load' });

  for (let i = 0; i < 32; i++) {
    await page.waitForTimeout(1000);
  }

  const diag = await page.evaluate(() => {
    const canvas = document.querySelector('#bas-canvas-container canvas');
    const container = document.getElementById('bas-canvas-container');
    return {
      canvasExists: !!canvas,
      canvasSize: canvas ? [canvas.width, canvas.height] : null,
      containerHasOnClass: container ? container.className : null,
      activeLayer: document.querySelector('.player-media-layer.active')?.id,
      currentAudibleVideo: (() => {
        const v = document.querySelector('#layer-a video.player-foreground-media, #layer-b video.player-foreground-media');
        return v ? { muted: v.muted, paused: v.paused, volume: v.volume, currentTime: v.currentTime } : null;
      })(),
    };
  });
  console.log('DIAGNOSTIC:', JSON.stringify(diag, null, 2));

  const audioLogs = logs.filter((l) => l.includes('AUDIO'));
  const transitionLogs = logs.filter((l) => l.includes('BIG TRANSITION'));
  console.log('\n=== AUDIO LOGS SEEN ===');
  audioLogs.forEach((l) => console.log(l));
  console.log('\n=== TRANSITION LOGS SEEN (unique) ===');
  [...new Set(transitionLogs)].forEach((l) => console.log(l));
  console.log('\nmid-transition screenshots captured:', midShotCount);

  await browser.close();
}

run().catch((e) => { console.error('HARNESS FATAL', e); process.exit(1); });

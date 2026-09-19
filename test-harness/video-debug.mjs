import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => { window.__PARTICLE_DEBUG__ = true; });

  let started = 0;
  let shotIdx = 0;
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('PARTICLE DEBUG') || t.includes('BIG TRANSITION') || t.includes('AUDIO')) {
      console.log('[BROWSER]', t);
    }
    if (t.includes('particle transition started')) {
      started++;
      if (started === 2 || started === 3) { // img->video, then video->video
        for (const delay of [50, 150, 300, 500, 700]) {
          const n = shotIdx++;
          setTimeout(() => {
            page.screenshot({ path: `/home/claude/project/lumen-advertiser/test-harness/vid2-${started}-${n}.png` }).catch(() => {});
          }, delay);
        }
      }
    }
  });

  await page.goto(`${BASE}/display?id=SCREEN001&debug=1`, { waitUntil: 'load' });
  await page.waitForTimeout(26000);

  const audioCheck = await page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')];
    return videos.map(v => ({
      inDOM: true,
      layer: v.closest('.player-media-layer')?.id,
      layerActive: v.closest('.player-media-layer')?.classList.contains('active'),
      paused: v.paused,
      muted: v.muted,
      volume: v.volume,
      hasSrc: !!v.getAttribute('src') || !!v.currentSrc,
    }));
  });
  console.log('\n=== AUDIO/VIDEO STATE AFTER video->video TRANSITION ===');
  console.log(JSON.stringify(audioCheck, null, 2));

  await browser.close();
}

run().catch((e) => { console.error('HARNESS FATAL', e); process.exit(1); });

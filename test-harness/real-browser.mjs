import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  page.on('console', (msg) => console.log('[BROWSER CONSOLE]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[BROWSER PAGE ERROR]', err.message));

  console.log('\n=== TEST 1: /display?id=SCREEN001&debug=1&noTransition=1 ===');
  await page.goto(`${BASE}/display?id=SCREEN001&debug=1&noTransition=1`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const diag1 = await page.evaluate(() => {
    const layerA = document.getElementById('layer-a');
    const layerB = document.getElementById('layer-b');
    const img = document.querySelector('#layer-a img.player-foreground-media, #layer-b img.player-foreground-media');
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const centerEl = document.elementFromPoint(cx, cy);
    const csA = layerA ? getComputedStyle(layerA) : null;
    const csB = layerB ? getComputedStyle(layerB) : null;
    const csImg = img ? getComputedStyle(img) : null;
    return {
      layerA: layerA && {
        className: layerA.className, inlineStyle: layerA.getAttribute('style'),
        display: csA.display, opacity: csA.opacity, visibility: csA.visibility, zIndex: csA.zIndex,
        rect: layerA.getBoundingClientRect().toJSON(),
      },
      layerB: layerB && {
        className: layerB.className, inlineStyle: layerB.getAttribute('style'),
        display: csB.display, opacity: csB.opacity, visibility: csB.visibility, zIndex: csB.zIndex,
        rect: layerB.getBoundingClientRect().toJSON(),
      },
      img: img && {
        src: img.currentSrc || img.src, complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        display: csImg.display, opacity: csImg.opacity, visibility: csImg.visibility, zIndex: csImg.zIndex,
        rect: img.getBoundingClientRect().toJSON(),
      },
      centerElement: centerEl ? { tag: centerEl.tagName, id: centerEl.id, className: centerEl.className } : null,
      elementsAtCenter: document.elementsFromPoint(cx, cy).map(e => ({ tag: e.tagName, id: e.id, className: typeof e.className === 'string' ? e.className : '' })),
    };
  });
  console.log('DIAGNOSTIC:', JSON.stringify(diag1, null, 2));

  await page.screenshot({ path: '/home/claude/project/lumen-advertiser/test-harness/test1-notransition.png' });

  // Actual pixel check: sample the center pixel color. If it's black (or near-black)
  // despite the image being a bright blue/orange test image, that's real visual proof
  // of a black screen - not just DOM state.
  const pixel1 = await page.evaluate(async () => {
    const video = document.createElement('canvas');
    video.width = window.innerWidth; video.height = window.innerHeight;
    // Can't screenshot cross-origin-safely via canvas from page context easily;
    // return null here, we rely on the actual screenshot file + naturalWidth/Height instead.
    return null;
  });

  console.log('\n=== TEST 2: /display?id=SCREEN001&debug=1 (normal transition path) ===');
  await page.goto(`${BASE}/display?id=SCREEN001&debug=1`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const diag2 = await page.evaluate(() => {
    const layerA = document.getElementById('layer-a');
    const img = document.querySelector('.player-media-layer.active img.player-foreground-media');
    const activeLayer = document.querySelector('.player-media-layer.active');
    return {
      activeLayerId: activeLayer ? activeLayer.id : null,
      activeLayerClass: activeLayer ? activeLayer.className : null,
      hasImg: !!img,
      imgNaturalSize: img ? [img.naturalWidth, img.naturalHeight] : null,
      imgComplete: img ? img.complete : null,
    };
  });
  console.log('DIAGNOSTIC 2:', JSON.stringify(diag2, null, 2));
  await page.screenshot({ path: '/home/claude/project/lumen-advertiser/test-harness/test2-normal.png' });

  console.log('\n=== TEST 3: repeat single-ad loop stability over 6s ===');
  await page.waitForTimeout(6000);
  const diag3 = await page.evaluate(() => {
    const active = document.querySelector('.player-media-layer.active');
    const img = active ? active.querySelector('img.player-foreground-media') : null;
    return { stillHasActiveLayer: !!active, stillHasImg: !!img, imgComplete: img ? img.complete : null };
  });
  console.log('DIAGNOSTIC 3 (after 12s, ad should have looped):', JSON.stringify(diag3, null, 2));
  await page.screenshot({ path: '/home/claude/project/lumen-advertiser/test-harness/test3-after-loop.png' });

  await browser.close();
}

run().catch((e) => { console.error('HARNESS FATAL', e); process.exit(1); });

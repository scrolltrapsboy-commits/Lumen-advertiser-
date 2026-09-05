/**
 * Real, dynamically-generated, scannable QR codes - entirely client-side,
 * via the vendored MIT-licensed qrcode-generator library (Kazuhiko Arase,
 * https://github.com/kazuhikoarase/qrcode-generator). No screenshot, no
 * PNG placeholder, no external QR-image API call: the actual QR matrix
 * is computed in the browser and rendered as real SVG <path> data, so it
 * stays sharp at any size and is genuinely scannable by a phone camera.
 */
import qrcodeFactory from '../vendor/qrcode-generator.mjs';

// UTF-8 byte encoding (straight port of the library's own optional
// qrcode_UTF8.mjs add-on) so non-ASCII destination URLs still encode
// correctly - same technique the library ships for this exact purpose.
function toUTF8Bytes(str) {
  const utf8 = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) utf8.push(charcode);
    else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return utf8;
}
qrcodeFactory.stringToBytes = toUTF8Bytes;

/**
 * @param {string} destinationUrl - regenerated fresh from this every call,
 *   so changing QR_DESTINATION_URL and remounting the page always encodes
 *   the current value, never a stale cached image.
 * @returns {string} raw <svg>...</svg> markup, real QR module data as an
 *   SVG path (via the library's own createSvgTag), no image API involved.
 */
export function generateQRSvgMarkup(destinationUrl) {
  // Type 0 = auto-select the smallest QR version that fits the data;
  // 'M' = ~15% error-correction, a standard, widely-scannable default.
  const qr = qrcodeFactory(0, 'M');
  qr.addData(destinationUrl);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
}

/**
 * Draws the SAME ad-card design (dark panel, gradient-framed QR, "Learn
 * more / about us." heading, green "← scan here" CTA) onto a 2D canvas -
 * used both as a cheap way to keep the DOM card and the 3D character's
 * hand-held prop texture pixel-consistent, and as a fallback if an <img>
 * needs a rasterized copy of the live SVG QR.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {HTMLImageElement|HTMLCanvasElement|null} qrImage - the QR itself,
 *   already rendered (e.g. an <img> whose src is the SVG data URL). Pass
 *   null to draw the card chrome only (e.g. while the QR image is loading).
 */
export function drawQRCardOnCanvas(ctx, w, h, qrImage) {
  const r = Math.min(18, h * 0.16);
  ctx.clearRect(0, 0, w, h);

  // Outer rounded card, dark panel background.
  roundRectPath(ctx, 0, 0, w, h, r);
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#242424');
  bg.addColorStop(1, '#121212');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = Math.max(1, h * 0.012);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();

  // Left QR panel: green -> blue gradient frame around a white QR square,
  // matching the reference screenshot's border treatment.
  const pad = h * 0.09;
  const qrBoxSize = h - pad * 2;
  ctx.save();
  roundRectPath(ctx, 0, 0, qrBoxSize + pad * 2, h, r);
  ctx.clip();
  const frame = ctx.createLinearGradient(0, 0, qrBoxSize, h);
  frame.addColorStop(0, '#8CE500');
  frame.addColorStop(1, '#1E90FF');
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, qrBoxSize + pad * 2, h);
  const inset = pad * 0.55;
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, inset, inset, qrBoxSize + pad * 2 - inset * 2, h - inset * 2, r * 0.4);
  ctx.fill();
  if (qrImage) {
    const qrPad = inset + (qrBoxSize + pad * 2 - inset * 2) * 0.08;
    const qrSize = qrBoxSize + pad * 2 - qrPad * 2;
    ctx.drawImage(qrImage, qrPad, qrPad, qrSize, qrSize);
  }
  ctx.restore();

  // Right text panel.
  const textX = qrBoxSize + pad * 2 + h * 0.14;
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(h * 0.19)}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Learn more', textX, h * 0.42);
  ctx.fillText('about us.', textX, h * 0.66);

  const ctaH = h * 0.22;
  const ctaY = h * 0.76;
  const ctaW = w - textX - h * 0.12;
  ctx.fillStyle = '#A6E22E';
  roundRectPath(ctx, textX, ctaY, Math.min(ctaW, h * 1.15), ctaH, ctaH * 0.28);
  ctx.fill();
  ctx.fillStyle = '#111111';
  ctx.font = `700 ${Math.round(h * 0.11)}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.fillText('\u2190  scan here', textX + h * 0.08, ctaY + ctaH * 0.68);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

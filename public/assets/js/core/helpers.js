export const qs = (sel, ctx = document) => ctx.querySelector(sel);
export const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function formatCurrency(amount, currency = '\u20b9') {
  return `${currency}${Number(amount).toLocaleString('en-IN')}`;
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function animateCount(el, to, duration = 800) {
  if (!el) return;
  const currentText = el.textContent.replace(/[^0-9.-]+/g, '');
  const from = Number(currentText) || 0;
  if (from === to) {
    el.textContent = Number(to).toLocaleString('en-IN');
    return;
  }
  const start = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString('en-IN');
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export function escapeHTML(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * ad.screenId is not always a single screen-ID string - Admin multi-screen
 * targeting stores it as an array, and "every screen" is stored as the
 * literal string 'all' (see ad.controller.js upload()). Rendering it
 * directly as text (or through escapeHTML, which just calls String() on
 * whatever it's given) silently stringifies an array via
 * Array.prototype.toString() into "SCREEN001,SCREEN002,SCREEN003" - shown
 * as if that comma-joined text were a single screen's name. Use this
 * anywhere ad.screenId is displayed as a label.
 */
export function formatScreenLabel(screenId) {
  if (screenId === 'all') return 'All Screens';
  if (Array.isArray(screenId)) return screenId.join(', ');
  return String(screenId || '');
}

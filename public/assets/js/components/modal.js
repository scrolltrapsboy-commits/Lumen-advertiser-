import { escapeHTML } from '../core/helpers.js';

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let lockCount = 0;
function lockScroll() {
  lockCount += 1;
  if (lockCount === 1) document.body.classList.add('modal-open-lock');
}
function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.classList.remove('modal-open-lock');
}

/**
 * Wires Escape-to-close, backdrop-click-to-close, scroll locking, and a
 * focus trap (Tab/Shift+Tab cycles within the dialog; focus returns to the
 * previously focused element on close) for a modal overlay.
 * Returns a teardown function to call once, on close.
 */
function trapFocus(overlay, dialogEl, onEscape) {
  const previouslyFocused = document.activeElement;
  lockScroll();

  function focusables() {
    return Array.from(dialogEl.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null
    );
  }

  const initial = focusables()[0] || dialogEl;
  initial.focus({ preventScroll: true });

  function onKeydown(e) {
    if (e.key === 'Escape') {
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeydown);

  return function teardown() {
    document.removeEventListener('keydown', onKeydown);
    unlockScroll();
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus({ preventScroll: true });
    }
  };
}

export function previewDialog({ title, mediaType, mediaData }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const isVideo = mediaType === 'video';
    overlay.innerHTML = `
      <div class="modal glass-card preview-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
        <button type="button" class="preview-modal-close" data-action="close" aria-label="Close preview">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <div class="modal-title" id="modal-title">${escapeHTML(title)}</div>
        <div class="preview-modal-media" data-preview-media>
          <div class="preview-modal-spinner" data-preview-loading aria-hidden="true"></div>
          <div class="preview-modal-error" data-preview-error style="display:none;">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
            <span>Couldn't load this ${isVideo ? 'video' : 'image'}</span>
          </div>
          ${isVideo
            ? `<video data-preview-el src="${mediaData}" controls autoplay muted playsinline style="opacity:0;"></video>`
            : `<img data-preview-el src="${mediaData}" alt="${escapeHTML(title)}" style="opacity:0;">`}
        </div>
        <div class="modal-actions"><button class="btn btn-primary" data-action="close">Close</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const dialogEl = overlay.querySelector('.modal');
    const mediaEl = overlay.querySelector('[data-preview-el]');
    const loadingEl = overlay.querySelector('[data-preview-loading]');
    const errorEl = overlay.querySelector('[data-preview-error]');

    const onReady = () => {
      loadingEl.style.display = 'none';
      mediaEl.style.opacity = '1';
    };
    const onError = () => {
      loadingEl.style.display = 'none';
      errorEl.style.display = 'flex';
      mediaEl.style.display = 'none';
    };
    mediaEl.addEventListener(isVideo ? 'loadeddata' : 'load', onReady);
    mediaEl.addEventListener('error', onError);
    // Cached images can already be fully decoded by the time this listener
    // attaches, in which case 'load' has already fired and never will
    // again - without this check the spinner would spin forever.
    if (!isVideo && mediaEl.complete && mediaEl.naturalWidth > 0) onReady();

    let teardown;

    function close() {
      teardown();
      if (isVideo) { try { mediaEl.pause(); } catch (e) { /* best effort */ } }
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 250);
      resolve();
    }

    teardown = trapFocus(overlay, dialogEl, close);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
      const action = e.target.closest('[data-action="close"]');
      if (action) close();
    });
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal glass-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
        <div class="modal-title" id="modal-title">${escapeHTML(title)}</div>
        <div class="modal-body">${escapeHTML(message)}</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${escapeHTML(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const dialogEl = overlay.querySelector('.modal');
    let teardown;

    function close(result) {
      teardown();
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 250);
      resolve(result);
    }

    teardown = trapFocus(overlay, dialogEl, () => close(false));

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
      const action = e.target.dataset && e.target.dataset.action;
      if (action === 'cancel') close(false);
      if (action === 'confirm') close(true);
    });
  });
}

export function promptDialog({ title, message, inputType = 'text', inputValue = '', min, max, confirmLabel = 'Save', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal glass-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1" style="max-width:420px;">
        <div class="modal-title" id="modal-title">${escapeHTML(title)}</div>
        <div class="modal-body">${escapeHTML(message)}</div>
        <div class="field mt-4">
          <input type="${inputType}" id="prompt-input" value="${escapeHTML(String(inputValue))}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} style="width:100%;height:46px;padding:0 var(--space-4);border-radius:var(--radius-md);background:var(--color-glass);border:1px solid var(--color-border);color:var(--color-text);font-size:inherit;">
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${escapeHTML(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const dialogEl = overlay.querySelector('.modal');
    const inputEl = overlay.querySelector('#prompt-input');
    let teardown;

    function close(result) {
      teardown();
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 250);
      resolve(result);
    }

    teardown = trapFocus(overlay, dialogEl, () => close(null));

    inputEl.focus({ preventScroll: true });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
      const action = e.target.dataset && e.target.dataset.action;
      if (action === 'cancel') close(null);
      if (action === 'confirm') {
        const value = inputEl.value;
        close({ value });
      }
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = inputEl.value;
        close({ value });
      }
    });
  });
}

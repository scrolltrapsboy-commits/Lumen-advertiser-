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
    overlay.innerHTML = `
      <div class="modal glass-card" style="max-width:560px;" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
        <div class="modal-title" id="modal-title">${escapeHTML(title)}</div>
        <div style="border-radius:var(--radius-md);overflow:hidden;background:#000;aspect-ratio:16/9;margin-bottom:16px;">
          ${mediaType === 'video'
            ? `<video src="${mediaData}" controls autoplay muted style="width:100%;height:100%;object-fit:contain;"></video>`
            : `<img src="${mediaData}" alt="${escapeHTML(title)}" style="width:100%;height:100%;object-fit:contain;">`}
        </div>
        <div class="modal-actions"><button class="btn btn-primary" data-action="close">Close</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const dialogEl = overlay.querySelector('.modal');
    let teardown;

    function close() {
      teardown();
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 250);
      resolve();
    }

    teardown = trapFocus(overlay, dialogEl, close);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
      const action = e.target.dataset && e.target.dataset.action;
      if (action === 'close') close();
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

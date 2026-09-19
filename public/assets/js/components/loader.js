let overlay = null;

export function showLoader(label = 'Loading Lumen') {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'liquid-loader-overlay';
  overlay.innerHTML = `
    <div class="liquid-loader">
      <div class="liquid-blob b1"></div>
      <div class="liquid-blob b2"></div>
      <div class="liquid-blob b3"></div>
      <div class="liquid-loader-core"></div>
    </div>
    <div class="liquid-loader-label">${label}</div>
  `;
  document.body.appendChild(overlay);
  // Capture this call's element locally: if hideLoader() runs before this
  // rAF callback fires (common on a fast/cached auth check), the shared
  // module-level `overlay` variable is already null by then. Reading the
  // local reference instead avoids that null-dereference entirely; adding
  // 'open' to an element that's already been faded out/detached is a
  // harmless no-op.
  const el = overlay;
  requestAnimationFrame(() => el.classList.add('open'));
}

export function hideLoader() {
  if (!overlay) return;
  overlay.classList.remove('open');
  const el = overlay;
  overlay = null;
  setTimeout(() => el.remove(), 320);
}

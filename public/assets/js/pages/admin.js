import { requireAuth } from '../core/auth.js';
import { mountShell, loadTimepickerUI } from '../components/shell.js';
import { showLoader, hideLoader } from '../components/loader.js';
import { getSettings, updatePricing } from '../core/settings.js';
import { ScreenService } from '../services/screen.service.js';
import { AdvertisementService } from '../services/advertisement.service.js';
import { UserService } from '../services/user.service.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { watchLive } from '../core/live.js';
import { showToast } from '../components/toast.js';
import { confirmDialog, promptDialog } from '../components/modal.js';
import { qs, qsa, formatCurrency, animateCount, escapeHTML, formatScreenLabel } from '../core/helpers.js';
import { formatDate, formatTime12h } from '../utils/date.js';
import { slotAvailability } from '../utils/slots.js';
import { createLiquidDropdown } from '../components/liquid-dropdown.js';
import { renderPreview } from '../components/tv-preview.js';
import { validateMediaFile, validateImageDuration } from '../utils/validation.js';
import { calculatePrice, getPricingConfig } from '../services/pricing.service.js';

async function getVideoDuration(src) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = src;
    video.onloadedmetadata = () => {
      resolve(Math.ceil(video.duration));
      URL.revokeObjectURL(video.src);
    };
    video.onerror = () => {
      resolve(60);
      URL.revokeObjectURL(video.src);
    };
  });
}

/**
 * Compresses an image file client-side using canvas.
 * Returns a Promise resolving to a compressed File object.
 */
async function compressImage(file, maxDimension = 1920, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Calculate new dimensions preserving aspect ratio
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round(height * maxDimension / width);
          width = maxDimension;
        } else {
          width = Math.round(width * maxDimension / height);
          height = maxDimension;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Draw with high quality
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      
      // Determine output format - preserve PNG for transparency, use JPEG for photos
      const isPNG = file.type === 'image/png';
      const mimeType = isPNG ? 'image/png' : 'image/jpeg';
      const exportQuality = isPNG ? undefined : quality;
      
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Image compression failed'));
            return;
          }
          const compressedFile = new File([blob], file.name, {
            type: mimeType,
            lastModified: Date.now()
          });
          resolve(compressedFile);
        },
        mimeType,
        exportQuality
      );
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = URL.createObjectURL(file);
  });
}

(async function init() {
  showLoader('Loading Control Center');
  const session = await requireAuth('admin');
  if (!session) return;

  const main = mountShell({ activeHref: '/admin', session });
  hideLoader();
  main.insertAdjacentHTML('beforeend', `
    <div class="page-header">
      <div>
        <div class="eyebrow">Admin</div>
        <h1 style="font-size:var(--fs-heading);margin-top:8px;">Control Center</h1>
      </div>
    </div>
    <div class="admin-tabs" id="tab-bar">
      <button class="admin-tab" data-tab="dashboard">Dashboard</button>
      <button class="admin-tab" data-tab="screens">Screens</button>
      <button class="admin-tab" data-tab="ads">Advertisements</button>
      <button class="admin-tab" data-tab="advertise">Advertise</button>
      <button class="admin-tab" data-tab="users">Users</button>
      <button class="admin-tab" data-tab="analytics">Analytics</button>
      <button class="admin-tab" data-tab="settings">Settings</button>
    </div>
    <div id="tab-content"></div>
  `);

  const content = qs('#tab-content');
  const tabs = ['dashboard', 'screens', 'ads', 'users', 'analytics', 'settings', 'advertise'];
  let currentTab = null;

  function syncSidebarActive(tab) {
    qsa('.sidebar-link').forEach(link => {
      const linkHash = link.getAttribute('href').split('#')[1] || '';
      const isMatch = linkHash === tab || (tab === 'dashboard' && !linkHash);
      link.classList.toggle('active', isMatch);
      if (isMatch) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
  }

  function setActiveTab(tab) {
    qsa('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    syncSidebarActive(tab);
    window.location.hash = tab === 'dashboard' ? '' : tab;
    currentTab = tab;
    render(tab);
  }

  qs('#tab-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) setActiveTab(btn.dataset.tab);
  });

  // The sidebar's admin links are plain <a href="/admin#screens"> anchors.
  // Since they point at the page we're already on, the browser only updates
  // the URL hash instead of reloading — so we must listen for that hash
  // change ourselves and re-render, or the sidebar buttons silently do
  // nothing after the very first tab. setActiveTab() below re-assigns the
  // same hash value it just received, which is a no-op and won't loop.
  window.addEventListener('hashchange', () => {
    const tab = window.location.hash.replace('#', '') || 'dashboard';
    if (tabs.includes(tab) && tab !== currentTab) setActiveTab(tab);
  });

  function render(tab) {
    let result;
    if (tab === 'dashboard') result = renderDashboard();
    else if (tab === 'screens') result = renderScreens();
    else if (tab === 'ads') result = renderAds();
    else if (tab === 'advertise') result = renderAdvertise();
    else if (tab === 'users') result = renderUsers();
    else if (tab === 'analytics') result = renderAnalytics();
    else if (tab === 'settings') result = renderSettings();
    // Each render* function is async and called without await here (tab
    // switches must feel instant). Without this .catch, an unguarded
    // rejection anywhere inside one - most render* functions do have their
    // own try/catch around network calls, but not every one does - would
    // silently no-op, leaving whatever tab was showing before still on
    // screen instead of surfacing the failure.
    if (result && typeof result.catch === 'function') {
      result.catch((err) => {
        console.error(`[Admin] Failed to render "${tab}" tab:`, err);
        showToast({ type: 'error', title: 'Something went wrong', message: 'Try switching tabs again or refresh the page.' });
      });
    }
  }

  // Live updates: whenever ads/screens/users change on the server, silently
  // refresh whichever tab is currently open.
  // Skip rendering for localEmit (actions initiated from this tab) since the
  // click handler already updates the UI — avoids double render/flicker.
  watchLive({
    'ads.json': (data) => { if (!data?.localEmit && ['dashboard', 'ads', 'analytics', 'screens'].includes(currentTab)) render(currentTab); },
    'screens.json': (data) => { if (!data?.localEmit && ['dashboard', 'screens', 'ads', 'analytics'].includes(currentTab)) render(currentTab); },
    'users.json': (data) => { if (!data?.localEmit && (currentTab === 'users' || currentTab === 'dashboard')) render(currentTab); },
    'settings.json': (data) => { if (!data?.localEmit && currentTab === 'settings') render(currentTab); }
  });

  async function renderDashboard() {
    const s = await AnalyticsService.summary();
    let grid = qs('#d-screens');
    if (!grid) {
      content.innerHTML = `
        <div class="stat-grid">
          <div class="glass-card stat-card"><div class="stat-value" id="d-screens">0</div><div class="stat-label">Total Screens</div></div>
          <div class="glass-card stat-card"><div class="stat-value" id="d-online">0</div><div class="stat-label">Online Screens</div></div>
          <div class="glass-card stat-card"><div class="stat-value" id="d-offline">0</div><div class="stat-label">Offline Screens</div></div>
          <div class="glass-card stat-card"><div class="stat-value" id="d-revenue-today">${formatCurrency(0)}</div><div class="stat-label">Today's Revenue</div></div>
        </div>
        <div class="grid grid-3 mt-6">
          <div class="glass-card stat-card"><div class="stat-value" id="d-ads-today">0</div><div class="stat-label">Today's Advertisements</div></div>
          <div class="glass-card stat-card"><div class="stat-value" id="d-photos">0</div><div class="stat-label">Photos</div></div>
          <div class="glass-card stat-card"><div class="stat-value" id="d-videos">0</div><div class="stat-label">Videos</div></div>
        </div>
        <div class="grid grid-3 mt-6">
          <div class="glass-card stat-card"><div class="stat-value" id="d-remaining">0</div><div class="stat-label">Remaining Slots</div></div>
          <div class="glass-card stat-card"><div class="stat-value" id="d-occupied">0</div><div class="stat-label">Occupied Slots</div></div>
          <div class="glass-card stat-card"><div class="stat-value" id="d-revenue">${formatCurrency(0)}</div><div class="stat-label">Total Revenue</div></div>
        </div>
        <div class="grid grid-3 mt-6">
          <div class="glass-card stat-card"><div class="stat-value" id="d-active">0</div><div class="stat-label">Active Advertisements</div></div>
          <div class="glass-card stat-card"><div class="stat-value" id="d-expired">0</div><div class="stat-label">Expired</div></div>
          <div class="glass-card stat-card"><div class="stat-value" id="d-ads">0</div><div class="stat-label">Total Advertisements</div></div>
        </div>
      `;
    }
    animateCount(qs('#d-screens'), s.screens);
    animateCount(qs('#d-online'), s.onlineScreens);
    animateCount(qs('#d-offline'), s.offlineScreens);
    animateCount(qs('#d-ads'), s.ads);
    animateCount(qs('#d-ads-today'), s.todaysAds);
    animateCount(qs('#d-active'), s.active);
    animateCount(qs('#d-expired'), s.expired);
    animateCount(qs('#d-photos'), s.photos);
    animateCount(qs('#d-videos'), s.videos);
    animateCount(qs('#d-remaining'), s.remainingSlots);
    animateCount(qs('#d-occupied'), s.occupiedSlots);
    qs('#d-revenue').textContent = formatCurrency(s.revenue);
    qs('#d-revenue-today').textContent = formatCurrency(s.todaysRevenue);
  }

  async function renderScreens() {
    let searchText = '';
    let statusFilter = 'all';
    let editingId = null;
    let lastScreensFingerprint = '';

    async function initializeTimepickers() {
      await loadTimepickerUI();
      if (typeof TimepickerUI === 'undefined') {
        console.warn('[Admin] TimepickerUI not available');
        return;
      }

      const openInput = qs('#s-open');
      const closeInput = qs('#s-close');

      if (openInput && !openInput.dataset.timepickerInitialized) {
        openInput.dataset.timepickerInitialized = 'true';
        openInput.removeAttribute('readonly');
        try {
          const picker = new TimepickerUI(openInput, {
            ui: { theme: 'glassmorphic' },
            clock: { type: '12h' }
          });
          picker.create();
        } catch (err) {
          console.warn('[Admin] Failed to initialize open time picker:', err);
        }
      }

      if (closeInput && !closeInput.dataset.timepickerInitialized) {
        closeInput.dataset.timepickerInitialized = 'true';
        closeInput.removeAttribute('readonly');
        try {
          const picker = new TimepickerUI(closeInput, {
            ui: { theme: 'glassmorphic' },
            clock: { type: '12h' }
          });
          picker.create();
        } catch (err) {
          console.warn('[Admin] Failed to initialize close time picker:', err);
        }
      }
    }

    content.innerHTML = `
      <div class="grid screens-layout">
        <div class="glass-card">
          <h3 style="margin-bottom:16px;" id="form-title">Create Screen</h3>
          <div class="field"><label>Screen ID (optional)</label><input type="text" id="s-id" placeholder="e.g. SCREEN005"></div>
          <div class="field"><label>Place name</label><input type="text" id="s-place" placeholder="e.g. Lumen Mall Food Court"></div>
          <div class="field"><label>Address</label><input type="text" id="s-address" placeholder="e.g. NH66, Edappally, Kochi"></div>
          <div class="field"><label>Description</label><textarea id="s-desc" placeholder="Optional notes"></textarea></div>
          <div class="grid grid-2">
            <div class="field"><label>Opening time</label><input type="text" id="s-open" value="08:00 AM" autocomplete="off"></div>
            <div class="field"><label>Closing time</label><input type="text" id="s-close" value="07:00 PM" autocomplete="off"></div>
          </div>
          <div class="field"><label>Status</label>
            <div id="s-status-dropdown"></div>
          </div>
          <div class="flex gap-2 mt-6">
            <button class="btn btn-primary btn-block" id="create-screen">Save Screen</button>
            <button class="btn btn-ghost" id="cancel-edit" style="display:none;">Cancel</button>
          </div>
        </div>
        <div>
          <div class="filter-bar" style="margin-bottom:16px;">
            <div class="search-box" style="flex:1;min-width:200px;">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.6"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              <input type="text" id="screen-search-input" placeholder="Search by ID, place or address" style="height:40px;width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--color-border-soft);border-radius:var(--radius-md);color:var(--color-text);padding-right:12px;">
            </div>
            ${['all', 'online', 'offline', 'disabled'].map(f => `<button class="filter-chip ${f === 'all' ? 'active' : ''}" data-screen-filter="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
          </div>
          <div id="screens-list"></div>
        </div>
      </div>
    `;

    // Initialize TimepickerUI for time inputs (safe initialization - only once per input)
    initializeTimepickers();

    // Initialize liquid-glass dropdown for status
    const statusDropdown = createLiquidDropdown({
      container: qs('#s-status-dropdown'),
      id: 's-status-dropdown',
      options: [
        { value: 'online', label: 'Online' },
        { value: 'offline', label: 'Offline' },
        { value: 'disabled', label: 'Disabled' }
      ],
      value: 'online',
      placeholder: 'Select status',
      onChange: (value) => {
        // Value is handled by the form
      }
    });

    function statusOf(s) {
      return s.activeState === 'disabled' ? 'disabled' : s.status;
    }

    // Time format conversion utilities
    function time24to12(time24) {
      if (!time24) return '';
      const [hours, minutes] = time24.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return time24;
      const period = hours >= 12 ? 'PM' : 'AM';
      const hours12 = hours % 12 || 12;
      return `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
    }

    function time12to24(time12) {
      if (!time12) return '';
      const match = time12.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!match) return time12; // Already in 24h format or invalid
      let hours = parseInt(match[1], 10);
      const minutes = match[2];
      const period = match[3].toUpperCase();
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      return `${String(hours).padStart(2, '0')}:${minutes}`;
    }

    async function renderList(force = false) {
      const [all, ads] = await Promise.all([
        ScreenService.list(),
        AdvertisementService.listAll()
      ]);
      const list = all.filter(s => {
        const matchesSearch = !searchText ||
          s.id.toLowerCase().includes(searchText) ||
          s.place.toLowerCase().includes(searchText) ||
          (s.address || '').toLowerCase().includes(searchText);
        const matchesFilter = statusFilter === 'all' || statusOf(s) === statusFilter;
        return matchesSearch && matchesFilter;
      });

      const newFingerprint = JSON.stringify(list.map(s => ({ id: s.id, place: s.place, status: s.status, activeState: s.activeState, openTime: s.openTime, closeTime: s.closeTime })));
      if (!force && newFingerprint === lastScreensFingerprint) return;
      lastScreensFingerprint = newFingerprint;

      qs('#screens-list').innerHTML = list.length ? `
        <div class="grid grid-2">
          ${list.map(s => {
            const avail = slotAvailability(s, ads, 10);
            const st = statusOf(s);
            return `
            <div class="glass-card glass-card--hover">
              <div class="flex items-center justify-between">
                <div style="font-weight:700;">${s.id}</div>
                <span class="badge badge-${st === 'disabled' ? 'disabled' : st}">${st}</span>
              </div>
              <div class="mt-4" style="font-weight:600;">${escapeHTML(s.place)}</div>
              <div class="text-tertiary" style="font-size:.8125rem;margin-top:2px;">${escapeHTML(s.address || 'No address on file')}</div>
              <div class="text-tertiary" style="font-size:.8125rem;margin-top:4px;">${escapeHTML(s.description || 'No description')}</div>
              <div class="text-secondary" style="font-size:.8125rem;margin-top:8px;">${formatTime12h(s.openTime)} \u2013 ${formatTime12h(s.closeTime)} \u00b7 ${avail.remaining}/${avail.max} slots free</div>
              <div class="flex gap-2 mt-4" style="flex-wrap:wrap;">
                <button class="btn btn-sm btn-secondary" data-edit-screen="${s.id}">Edit</button>
                <button class="btn btn-sm btn-secondary" data-toggle-status="${s.id}">Toggle Connection</button>
                <button class="btn btn-sm btn-secondary" data-toggle-active="${s.id}">Toggle Disabled</button>
                <button class="btn btn-sm btn-danger" data-delete-screen="${s.id}">Delete</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      ` : `<div class="glass-card empty-state"><h3>No screens match</h3><p>Try a different search term or filter.</p></div>`;
    }
    await renderList(true);

    function resetForm() {
      editingId = null;
      qs('#form-title').textContent = 'Create Screen';
      qs('#create-screen').textContent = 'Save Screen';
      qs('#cancel-edit').style.display = 'none';
      qs('#s-id').value = ''; qs('#s-id').disabled = false;
      qs('#s-place').value = ''; qs('#s-address').value = ''; qs('#s-desc').value = '';
      qs('#s-open').value = time24to12('08:00'); qs('#s-close').value = time24to12('19:00');
      statusDropdown.setValue('online');
      initializeTimepickers();
    }

    function loadForEdit(s) {
      editingId = s.id;
      qs('#form-title').textContent = `Edit ${s.id}`;
      qs('#create-screen').textContent = 'Save Changes';
      qs('#cancel-edit').style.display = '';
      qs('#s-id').value = s.id; qs('#s-id').disabled = true;
      qs('#s-place').value = s.place;
      qs('#s-address').value = s.address || '';
      qs('#s-desc').value = s.description || '';
      qs('#s-open').value = time24to12(s.openTime);
      qs('#s-close').value = time24to12(s.closeTime);
      statusDropdown.setValue(statusOf(s));
      qs('#s-place').scrollIntoView({ behavior: 'smooth', block: 'center' });
      initializeTimepickers();
    }

    qs('#cancel-edit').addEventListener('click', resetForm);

    qs('#create-screen').addEventListener('click', async () => {
      const place = qs('#s-place').value.trim();
      if (!place) { showToast({ type: 'error', title: 'Place name is required' }); return; }
      const openTime = time12to24(qs('#s-open').value);
      const closeTime = time12to24(qs('#s-close').value);
      if (!openTime || !closeTime) { showToast({ type: 'error', title: 'Set both opening and closing times' }); return; }
      if (openTime === closeTime) { showToast({ type: 'error', title: 'Opening and closing time cannot be the same' }); return; }
      const statusValue = statusDropdown.getValue();
      const status = statusValue === 'disabled' ? 'offline' : statusValue;
      const activeState = statusValue === 'disabled' ? 'disabled' : 'active';
      const payload = { place, address: qs('#s-address').value, description: qs('#s-desc').value, status, activeState, openTime, closeTime };

      if (editingId) {
        const result = await ScreenService.update(editingId, payload);
        if (!result.ok) { showToast({ type: 'error', title: 'Could not update screen', message: result.message }); return; }
        showToast({ type: 'success', title: 'Screen updated', message: result.screen.id });
      } else {
        const result = await ScreenService.create({ id: qs('#s-id').value, ...payload });
        if (!result.ok) { showToast({ type: 'error', title: 'Could not save screen', message: result.message }); return; }
        showToast({ type: 'success', title: 'Screen created', message: result.screen.id });
      }
      resetForm();
      renderList(true);
    });

    qs('#screen-search-input').addEventListener('input', (e) => {
      searchText = e.target.value.trim().toLowerCase();
      renderList(true);
    });

    qs('.filter-bar').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-screen-filter]');
      if (!chip) return;
      statusFilter = chip.dataset.screenFilter;
      qsa('[data-screen-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderList(true);
    });

    qs('#screens-list').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit-screen]');
      const toggleStatus = e.target.closest('[data-toggle-status]');
      const toggleActive = e.target.closest('[data-toggle-active]');
      const del = e.target.closest('[data-delete-screen]');
      if (edit) {
        const s = await ScreenService.get(edit.dataset.editScreen);
        if (s) loadForEdit(s);
      }
      if (toggleStatus) {
        const s = await ScreenService.get(toggleStatus.dataset.toggleStatus);
        await ScreenService.update(s.id, { status: s.status === 'online' ? 'offline' : 'online' });
        renderList(true);
      }
      if (toggleActive) {
        const s = await ScreenService.get(toggleActive.dataset.toggleActive);
        await ScreenService.update(s.id, { activeState: s.activeState === 'active' ? 'disabled' : 'active' });
        renderList(true);
      }
      if (del) {
        const ok = await confirmDialog({ title: 'Delete screen?', message: 'This cannot be undone. Advertisements linked to it will remain in history.', confirmLabel: 'Delete', danger: true });
        if (ok) { await ScreenService.remove(del.dataset.deleteScreen); showToast({ type: 'success', title: 'Screen deleted' }); renderList(true); }
      }
    });
  }

  async function renderAds() {
    let filter = 'all';
    let lastAdsFingerprint = '';

    content.innerHTML = `
      <div class="filter-bar">
        ${['all', 'active', 'expired'].map(f => `<button class="filter-chip ${f === 'all' ? 'active' : ''}" data-ad-filter="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
      </div>
      <div id="ads-grid"></div>
    `;

    async function renderGrid(force = false) {
      const all = (await AdvertisementService.listAll()).sort((a, b) => b.createdAt - a.createdAt);
      const list = filter === 'all' ? all : all.filter(a => a.status === filter);

      const newFingerprint = JSON.stringify(list.map(a => ({ id: a.id, status: a.status, screenId: a.screenId, endDate: a.endDate })));
      if (!force && newFingerprint === lastAdsFingerprint) return;
      lastAdsFingerprint = newFingerprint;

      const grid = qs('#ads-grid');
      grid.innerHTML = list.length ? `
        <div class="grid grid-3">
          ${list.map(ad => `
            <div class="glass-card">
              <div class="flex items-center justify-between">
                <span class="badge badge-${ad.status}">${ad.status}</span>
                <span class="flex items-center gap-2">
                  ${ad.sourceType === 'ADMIN' ? '<span class="badge" style="background:var(--color-accent-dim);color:var(--color-accent);">Admin Ad</span>' : ''}
                  <span class="text-tertiary" style="font-size:.75rem;text-transform:capitalize;">${ad.mediaType}</span>
                </span>
              </div>
              <div class="mt-4" data-open-preview="${ad.id}" style="border-radius:var(--radius-md);overflow:hidden;aspect-ratio:16/9;background:#000;cursor:pointer;position:relative;" title="Click to view fullscreen">
                ${ad.mediaType === 'video' ? `<video src="${ad.mediaUrl}" muted playsinline preload="metadata" loading="lazy"></video>` : `<img src="${ad.mediaUrl}" alt="Advertisement for ${escapeHTML(formatScreenLabel(ad.screenId))}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`}
              </div>
              <div class="mt-4" style="font-weight:600;">${escapeHTML(formatScreenLabel(ad.screenId))}</div>
              <div class="text-tertiary" style="font-size:.8125rem;">${escapeHTML(ad.userEmail)} \u00b7 ${formatDate(ad.endDate)} \u00b7 ${ad.duration}s</div>
              <div class="flex gap-2 mt-4" style="flex-wrap:wrap;">
                ${ad.status === 'active'
                  ? `<button class="btn btn-sm btn-secondary" data-pause="${ad.id}">Pause (mark expired)</button>`
                  : `<button class="btn btn-sm btn-secondary" data-resume="${ad.id}">Resume</button>`}
                ${ad.mediaType === 'video' ? `<button class="btn btn-sm btn-secondary" data-edit-duration="${ad.id}">Edit Duration</button>` : ''}
                <button class="btn btn-sm btn-danger" data-delete-ad="${ad.id}">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : `<div class="glass-card empty-state"><h3>No advertisements found</h3><p>Nothing matches this filter right now.</p></div>`;
    }
    await renderGrid(true);

    qs('.filter-bar').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ad-filter]');
      if (!btn) return;
      filter = btn.dataset.adFilter;
      qsa('[data-ad-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGrid(true);
    });

    qs('#ads-grid').addEventListener('click', async (e) => {
      const pause = e.target.closest('[data-pause]');
      const resume = e.target.closest('[data-resume]');
      const del = e.target.closest('[data-delete-ad]');
      const preview = e.target.closest('[data-open-preview]');
      const editDuration = e.target.closest('[data-edit-duration]');
      if (pause) { await AdvertisementService.setStatus(pause.dataset.pause, 'expired'); showToast({ type: 'info', title: 'Advertisement paused' }); renderGrid(true); }
      if (resume) { await AdvertisementService.setStatus(resume.dataset.resume, 'active'); showToast({ type: 'success', title: 'Advertisement resumed' }); renderGrid(true); }
      if (del) {
        const ok = await confirmDialog({ title: 'Delete advertisement?', message: 'This will permanently remove it.', confirmLabel: 'Delete', danger: true });
        if (ok) { await AdvertisementService.remove(del.dataset.deleteAd); showToast({ type: 'success', title: 'Advertisement deleted' }); renderGrid(true); }
      }
      if (editDuration) {
        const all = await AdvertisementService.listAll();
        const ad = all.find(a => a.id === editDuration.dataset.editDuration);
        if (ad) {
          const videoDuration = await getVideoDuration(ad.mediaUrl);
          // Cap only against the video's real, measured length - never against
          // a fixed 60s ceiling. If the source video is 3 minutes long, the
          // admin can set playback duration anywhere up to 180s.
          const maxAllowed = Math.max(1, Math.floor(videoDuration) || 60);
          const result = await promptDialog({
            title: 'Edit Video Duration',
            message: `Actual video duration: ${videoDuration}s. Enter new duration (1-${maxAllowed}s):`,
            inputType: 'number',
            inputValue: ad.duration,
            min: 1,
            max: maxAllowed,
            confirmLabel: 'Save'
          });
          if (result && result.value !== null && result.value !== undefined) {
            const newDuration = Math.min(Math.max(1, Number(result.value)), maxAllowed);
            if (newDuration !== ad.duration) {
              await AdvertisementService.updateDuration(editDuration.dataset.editDuration, newDuration);
              showToast({ type: 'success', title: 'Duration updated', message: `Changed from ${ad.duration}s to ${newDuration}s` });
              renderGrid(true);
            }
          }
        }
      }
      if (preview) {
        const all = await AdvertisementService.listAll();
        const ad = all.find(a => a.id === preview.dataset.openPreview);
        if (ad) openAdFullscreenPreview(ad);
      }
    });
  }

  /**
   * Fullscreen advertisement viewer. Builds every node with DOM APIs
   * (createElement / textContent / setting .src directly) rather than
   * innerHTML with interpolated ad fields, so nothing in an advertiser's
   * uploaded filename, screen id, or email can be interpreted as markup.
   */
  function openAdFullscreenPreview(ad) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '900';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-icon btn-secondary';
    closeBtn.setAttribute('aria-label', 'Close preview');
    closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;z-index:2;';
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

    const stage = document.createElement('div');
    stage.style.cssText = 'position:relative;width:min(92vw,1100px);max-height:88vh;display:flex;flex-direction:column;gap:16px;align-items:center;';

    const mediaWrap = document.createElement('div');
    mediaWrap.style.cssText = 'width:100%;max-height:72vh;border-radius:var(--radius-lg);overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-floating);';

    let mediaEl;
    if (ad.mediaType === 'video') {
      mediaEl = document.createElement('video');
      mediaEl.controls = true;
      mediaEl.autoplay = true;
      mediaEl.playsInline = true;
      mediaEl.style.cssText = 'max-width:100%;max-height:72vh;';
    } else {
      mediaEl = document.createElement('img');
      mediaEl.alt = `Advertisement for ${formatScreenLabel(ad.screenId)}`;
      mediaEl.style.cssText = 'max-width:100%;max-height:72vh;object-fit:contain;';
    }
    mediaEl.src = ad.mediaUrl;
    mediaWrap.appendChild(mediaEl);

    const info = document.createElement('div');
    info.className = 'glass-card';
    info.style.cssText = 'width:100%;display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between;';

    const left = document.createElement('div');
    const screenLine = document.createElement('div');
    screenLine.style.cssText = 'font-weight:600;font-size:1rem;';
    screenLine.textContent = `Screen ${formatScreenLabel(ad.screenId)}`;
    const metaLine = document.createElement('div');
    metaLine.className = 'text-tertiary';
    metaLine.style.fontSize = '.8125rem';
    metaLine.textContent = `${ad.userEmail || 'Unknown advertiser'} \u00b7 ${ad.duration}s \u00b7 ends ${formatDate(ad.endDate)}`;
    left.appendChild(screenLine);
    left.appendChild(metaLine);

    const badge = document.createElement('span');
    badge.className = `badge badge-${ad.status}`;
    badge.textContent = ad.status;

    info.appendChild(left);
    info.appendChild(badge);

    stage.appendChild(mediaWrap);
    stage.appendChild(info);
    overlay.appendChild(closeBtn);
    overlay.appendChild(stage);
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open-lock');
    requestAnimationFrame(() => overlay.classList.add('open'));

    function close() {
      if (mediaEl.tagName === 'VIDEO') { mediaEl.pause(); mediaEl.removeAttribute('src'); mediaEl.load(); }
      overlay.classList.remove('open');
      document.body.classList.remove('modal-open-lock');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => overlay.remove(), 260);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
  }

  async function renderUsers() {
    let lastUsersFingerprint = '';
    const [users, ads] = await Promise.all([
      UserService.list(),
      AdvertisementService.listAll()
    ]);

    const newFingerprint = JSON.stringify(users.map(u => ({ id: u.id, name: u.name, email: u.email, adsCount: ads.filter(a => a.userId === u.id).length })));
    if (newFingerprint === lastUsersFingerprint && qs('#users-body')) return;
    lastUsersFingerprint = newFingerprint;

    content.innerHTML = `
      <div class="table-wrap as-cards glass-card" style="padding:0;">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Advertisements</th><th>Joined</th><th></th></tr></thead>
          <tbody id="users-body"></tbody>
        </table>
      </div>
      <div id="users-empty" style="display:none;"></div>
    `;
    const body = qs('#users-body');
    const empty = qs('#users-empty');
    if (!users.length) {
      qs('.table-wrap').style.display = 'none';
      empty.style.display = 'block';
      empty.innerHTML = `<div class="glass-card empty-state"><h3>No advertisers yet</h3><p>Accounts will appear here once businesses sign up.</p></div>`;
      return;
    }
    body.innerHTML = users.map(u => `
      <tr>
        <td data-label="Name">${escapeHTML(u.name)}</td>
        <td data-label="Email">${escapeHTML(u.email)}</td>
        <td data-label="Advertisements">${ads.filter(a => a.userId === u.id).length}</td>
        <td data-label="Joined">${formatDate(new Date(u.createdAt).toISOString())}</td>
        <td data-label="Actions"><button class="btn btn-sm btn-danger" data-delete-user="${u.id}">Remove</button></td>
      </tr>
    `).join('');

    body.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-delete-user]');
      if (!del) return;
      const ok = await confirmDialog({ title: 'Remove advertiser?', message: 'Their account will be deleted. Advertisement history is kept for records.', confirmLabel: 'Remove', danger: true });
      if (ok) { await UserService.remove(del.dataset.deleteUser); showToast({ type: 'success', title: 'User removed' }); renderUsers(); }
    });
  }

  async function renderAnalytics() {
    const s = await AnalyticsService.summary();
    content.innerHTML = `
      <div class="stat-grid">
        <div class="glass-card stat-card"><div class="stat-value">${s.screens}</div><div class="stat-label">Total Screens</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${s.onlineScreens}</div><div class="stat-label">Online Screens</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${s.offlineScreens}</div><div class="stat-label">Offline Screens</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${formatCurrency(s.todaysRevenue)}</div><div class="stat-label">Today's Revenue</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${s.todaysAds}</div><div class="stat-label">Today's Advertisements</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${s.photos}</div><div class="stat-label">Photos</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${s.videos}</div><div class="stat-label">Videos</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${s.remainingSlots}</div><div class="stat-label">Remaining Slots</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${s.occupiedSlots}</div><div class="stat-label">Occupied Slots</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${s.active}</div><div class="stat-label">Active Advertisements</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${s.expired}</div><div class="stat-label">Expired</div></div>
        <div class="glass-card stat-card"><div class="stat-value">${formatCurrency(s.revenue)}</div><div class="stat-label">Total Revenue</div></div>
      </div>
    `;
  }

  async function renderSettings() {
    const config = await getSettings({ force: true });
    content.innerHTML = `
      <div class="glass-card" style="max-width:480px;">
        <h3 style="margin-bottom:16px;">Platform Pricing</h3>
        <div class="field"><label>Photo campaign price (\u20b9)</label><input type="number" id="price-photo" value="${config.pricing.photo}"></div>
        <div class="field mt-4"><label>Video campaign price (\u20b9)</label><input type="number" id="price-video" value="${config.pricing.video}"></div>
        <button class="btn btn-primary mt-6" id="save-pricing">Save Pricing</button>
      </div>
      <div class="glass-card mt-8" style="max-width:480px;">
        <h3 style="margin-bottom:16px;">Video Playback Settings</h3>
        <div class="field"><label>Maximum Video Length Accepted at Upload (seconds)</label>
          <input type="number" id="max-video-seconds" value="${config.maxVideoSeconds || 60}" min="1" placeholder="Default: 60 seconds">
          <div class="field-hint">Videos longer than this are rejected on upload, for both advertisers and Admin's own Add Advertisement page. This is the single source of truth used everywhere in the app.</div>
        </div>
        <div class="field mt-4"><label>Default Video Playback Duration (seconds)</label>
          <input type="number" id="default-video-duration" value="${config.defaultVideoDuration || 10}" min="1" placeholder="Default: 10 seconds">
          <div class="field-hint">Default playback duration for video ads. Each individual ad's own playback duration can be edited from the ad list and is capped only by that video's actual length, not by this default.</div>
        </div>
        <button class="btn btn-primary mt-6" id="save-video-settings">Save Video Settings</button>
      </div>
    `;
    qs('#save-pricing').addEventListener('click', async () => {
      const result = await updatePricing({ photo: qs('#price-photo').value, video: qs('#price-video').value });
      if (!result.ok) { showToast({ type: 'error', title: 'Could not update pricing', message: result.message }); return; }
      showToast({ type: 'success', title: 'Pricing updated' });
    });
    qs('#save-video-settings').addEventListener('click', async () => {
      const duration = Number(qs('#default-video-duration').value);
      const maxVideoSeconds = Number(qs('#max-video-seconds').value);
      if (!maxVideoSeconds || maxVideoSeconds < 1) {
        showToast({ type: 'error', title: 'Invalid maximum length', message: 'Maximum video length must be 1 second or more.' });
        return;
      }
      if (!duration || duration < 1) {
        showToast({ type: 'error', title: 'Invalid duration', message: 'Duration must be 1 second or more.' });
        return;
      }
      const result = await updatePricing({ defaultVideoDuration: duration, maxVideoSeconds });
      if (!result.ok) { showToast({ type: 'error', title: 'Could not update video settings', message: result.message }); return; }
      showToast({ type: 'success', title: 'Video settings updated' });
    });
  }

  async function renderAdvertise() {
    let state = {
      type: 'image',
      file: null,
      fileURL: null,
      duration: 5,
      days: 7,
      screenIds: 'all',
      screens: [],
      ads: []
    };

    // This fetch happens BEFORE content.innerHTML is ever assigned below.
    // If it throws (e.g. a transient network hiccup) with no try/catch,
    // this whole async function aborts silently - content is never
    // replaced, so whatever tab was open before "Advertise" was clicked
    // just stays on screen with only a console error, which looks exactly
    // like "Admin -> Advertise renders the wrong content." Guard it and
    // show a real error state (with retry) instead of failing silently.
    let config;
    try {
      config = await getSettings();
    } catch (err) {
      console.error('[Admin] Failed to load settings for Advertise tab:', err);
      content.innerHTML = `
        <div class="glass-card empty-state">
          <h3>Could not load the Advertise form</h3>
          <p>${escapeHTML(err.message || 'A network error occurred.')}</p>
          <button type="button" class="btn btn-secondary mt-4" id="retry-advertise">Retry</button>
        </div>
      `;
      const retryBtn = qs('#retry-advertise');
      if (retryBtn) retryBtn.addEventListener('click', () => renderAdvertise());
      showToast({ type: 'error', title: 'Could not load Advertise tab', message: 'Retry or refresh the page.' });
      return;
    }

    async function refreshScreens() {
      try {
        state.screens = await ScreenService.list();
        state.ads = await AdvertisementService.listAll();
      } catch (err) {
        console.error('[Admin] Failed to load screens/ads:', err);
        showToast({ type: 'error', title: 'Could not load screens', message: 'Refresh the page to try again.' });
        return;
      }
      renderScreenTargeting();
    }

    function updatePrice() {
      if (!pricingConfig) return 0;
      const result = calculatePrice(state.type, state.duration, state.days, pricingConfig);
      qs('#ad-price-type').textContent = `${state.type === 'image' ? 'Image' : 'Video'} \u2014 ${formatCurrency(result.pricePerDay)}/day`;
      qs('#ad-price-total').textContent = formatCurrency(result.totalPrice);
      return result.totalPrice;
    }

    function updateSubmitState() {
      const btn = qs('#submit-advertise');
      let full = false;
      if (state.screenIds !== 'all' && state.screenIds.length > 0) {
        for (const id of state.screenIds) {
          const screen = state.screens.find(s => s.id === id);
          if (screen) {
            const avail = slotAvailability(screen, state.ads, state.duration || 10);
            if (avail.full) { full = true; break; }
          }
        }
      } else if (state.screenIds === 'all') {
        for (const screen of state.screens) {
          if (screen.activeState === 'active') {
            const avail = slotAvailability(screen, state.ads, state.duration || 10);
            if (avail.full) { full = true; break; }
          }
        }
      }
      btn.disabled = !(state.file && (state.screenIds === 'all' || state.screenIds.length > 0)) || full;
      btn.textContent = full ? 'No Slots Available For Selected Screen(s)' : 'Upload Advertisement';
    }

    function renderScreenTargeting() {
      const container = qs('#screen-targeting-container');
      if (!container) return;

      if (!state.screens.length) {
        container.innerHTML = `<div class="field-error-msg">No display screens are available right now.</div>`;
        return;
      }

      let html = `
        <div class="field">
          <label>Target Screens</label>
          <div class="screen-target-actions" style="display:flex;gap:8px;margin-bottom:8px;">
            <button type="button" class="btn btn-sm btn-secondary" data-select-all>Select All</button>
            <button type="button" class="btn btn-sm btn-ghost" data-clear-all>Clear All</button>
          </div>
          <div class="screen-targeting">
            <label class="screen-target-option ${state.screenIds === 'all' ? 'selected' : ''}" data-target="all">
              <span class="target-label">All Screens</span>
              <span class="target-desc">Advertise on all active screens</span>
            </label>
            <div class="target-divider"></div>
            <div class="target-screens-list">
      `;
      
      for (const screen of state.screens) {
        const avail = slotAvailability(screen, state.ads, state.duration || 1);
        const disabled = avail.full || screen.activeState === 'disabled';
        const isSelected = state.screenIds !== 'all' && state.screenIds.includes(screen.id);
        // Real online/offline status from the screen record itself
        // (screen.status, the same field screens.json stores and the same
        // source badge-online/badge-offline use elsewhere) - not assumed or
        // hardcoded, so admin can actually see which targeted screens are
        // live right now before assigning an ad to them.
        const isOnline = screen.status === 'online';
        html += `
              <label class="screen-target-option ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" data-target="${screen.id}" ${disabled ? 'title="No slots available"' : ''}>
                <span class="target-label">${screen.id} \u2014 ${screen.place} <span class="badge badge-${isOnline ? 'online' : 'offline'}" style="margin-left:6px;font-size:0.65rem;vertical-align:middle;">${isOnline ? 'Online' : 'Offline'}</span></span>
                <span class="target-desc">${formatTime12h(screen.openTime)} \u2013 ${formatTime12h(screen.closeTime)} \u00b7 ${avail.full ? 'No Slots Available' : `${avail.remaining} slots left`}</span>
                ${disabled ? '<span class="target-badge disabled">No Slots</span>' : ''}
              </label>
        `;
      }
      
      html += `
            </div>
          </div>
        </div>
      `;
      
      container.innerHTML = html;

      const selectAllBtn = container.querySelector('[data-select-all]');
      const clearAllBtn = container.querySelector('[data-clear-all]');
      if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
          state.screenIds = state.screens
            .filter(s => !(slotAvailability(s, state.ads, state.duration || 1).full || s.activeState === 'disabled'))
            .map(s => s.id);
          renderScreenTargeting();
          updateSubmitState();
        });
      }
      if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
          state.screenIds = [];
          renderScreenTargeting();
          updateSubmitState();
        });
      }

      // Add click handlers
      container.querySelectorAll('.screen-target-option').forEach(el => {
        if (el.classList.contains('disabled')) return;
        el.addEventListener('click', () => {
          const target = el.dataset.target;
          if (target === 'all') {
            state.screenIds = 'all';
          } else {
            if (state.screenIds === 'all') state.screenIds = [];
            const idx = state.screenIds.indexOf(target);
            if (idx >= 0) state.screenIds.splice(idx, 1);
            else state.screenIds.push(target);
          }
          renderScreenTargeting();
          updateSubmitState();
        });
      });
    }

    content.innerHTML = `
      <div class="page-header">
        <div>
          <div class="eyebrow">Admin Advertise</div>
          <h1 style="font-size:var(--fs-heading);margin-top:8px;">Upload Advertisement</h1>
        </div>
      </div>

      <div class="upload-grid">
        <div class="glass-card">
          <div class="field">
            <label>1. Choose media type</label>
            <div class="upload-type-toggle">
              <button type="button" class="type-option selected" data-type="image">
                <span class="type-label">IMAGE</span>
                <span class="type-hint">PNG \u00b7 JPG \u00b7 WEBP</span>
              </button>
              <button type="button" class="type-option" data-type="video">
                <span class="type-label">VIDEO</span>
                <span class="type-hint">MP4 \u00b7 MOV \u00b7 WEBM \u00b7 max ${config.maxVideoSeconds || 60}s</span>
              </button>
            </div>
          </div>

          <div class="field">
            <label>2. Upload file</label>
            <div class="upload-drop" id="drop-zone">
              <input type="file" id="file-input" class="visually-hidden" accept="image/png,image/jpeg,image/webp">
              <svg viewBox="0 0 24 24" width="32" height="32" style="margin:0 auto 12px;color:var(--color-text-tertiary);" fill="none"><path d="M12 16V4M12 4l-4 4M12 4l4 4M5 16v3a1 1 0 001 1h12a1 1 0 001-1v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <div style="font-weight:600;">Click to browse or drop a file</div>
              <div class="text-tertiary" style="font-size:.8125rem;margin-top:4px;" id="drop-hint">PNG, JPG or WEBP up to ${config.maxImageMB || 10}MB</div>
            </div>
            <div id="file-error" class="field-error-msg" style="display:none;margin-top:8px;"></div>
          </div>

          <div class="field" id="duration-field">
            <label>3. Play duration</label>
            <div class="duration-pills" id="duration-pills">
              ${[5,6,7,8,9,10].map((d, i) => `<button type="button" class="pill ${i === 0 ? 'selected' : ''}" data-duration="${d}">${d}s</button>`).join('')}
            </div>
          </div>

          <div class="field">
            <label>4. Campaign length</label>
            <div id="days-dropdown"></div>
          </div>

          <div class="field">
            <label>5. Target screens</label>
            <div id="screen-targeting-container"></div>
            <div id="screen-selected-info" class="mt-4"></div>
          </div>

          <button class="btn btn-primary btn-block mt-6" id="submit-advertise" disabled>Upload Advertisement</button>
        </div>

        <div>
          <div class="glass-card glass-card--floating">
            <div class="eyebrow" style="margin-bottom:12px;">Live TV Preview</div>
            <div class="tv-frame">
              <div class="tv-preview-wrap">
                <div class="tv-preview" id="tv-preview"><span class="tv-preview-empty">Select a file to preview</span></div>
              </div>
              <div class="tv-stand"></div>
              <div class="tv-stand-base"></div>
            </div>
          </div>

          <div class="glass-card mt-6">
            <div class="eyebrow" style="margin-bottom:12px;">Pricing</div>
            <div class="pricing-row" style="border-top:none;padding-top:0;">
              <span class="text-secondary">Media quality</span>
              <span id="ad-price-type">Image \u2014 ${formatCurrency(config.pricing.photo)}</span>
            </div>
            <div class="pricing-row">
              <span class="text-secondary">Total</span>
              <span class="pricing-total" id="ad-price-total">${formatCurrency(config.pricing.photo)}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    function statusOf(s) {
      return s.activeState === 'disabled' ? 'disabled' : s.status;
    }

    let pricingConfig = null;
    async function loadPricingConfig() {
      pricingConfig = await getPricingConfig();
    }
    await loadPricingConfig();

    // Initialize liquid-glass dropdown for days
    const daysDropdown = createLiquidDropdown({
      container: qs('#days-dropdown'),
      id: 'days-dropdown',
      options: config.dayOptions.map(d => ({
        value: String(d),
        label: `${d} day${d > 1 ? 's' : ''}`
      })),
      value: '7',
      placeholder: 'Select campaign length',
      onChange: (value) => {
        state.days = Number(value);
        updatePrice();
      }
    });

    // Type toggle
    function renderDurationPills() {
      const container = qs('#duration-pills');
      let durations;
      if (state.type === 'image') {
        durations = [5, 6, 7, 8, 9, 10];
      } else {
        durations = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
      }
      container.innerHTML = durations.map((d, i) => `<button type="button" class="pill ${i === 0 ? 'selected' : ''}" data-duration="${d}">${d}s</button>`).join('');
      state.duration = durations[0];
    }

    qsa('.type-option').forEach(btn => {
      btn.addEventListener('click', () => {
        qsa('.type-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.type = btn.dataset.type;
        const input = qs('#file-input');
        const durationField = qs('#duration-field');
        if (state.type === 'image') {
          input.accept = 'image/png,image/jpeg,image/webp';
          qs('#drop-hint').textContent = `PNG, JPG or WEBP up to ${config.maxImageMB || 10}MB`;
          durationField.style.display = '';
        } else {
          input.accept = 'video/mp4,video/quicktime,video/webm';
          qs('#drop-hint').textContent = `MP4, MOV or WEBM \u2014 max ${config.maxVideoSeconds || 60} seconds, up to ${config.maxVideoMB || 100}MB`;
          durationField.style.display = 'none';
        }
        renderDurationPills();
        if (state.fileURL) {
          URL.revokeObjectURL(state.fileURL);
        }
        state.file = null;
        state.fileURL = null;
        renderPreview(qs('#tv-preview'), { url: null });
        updatePrice();
        updateSubmitState();
      });
    });

    // Initial render
    renderDurationPills();

    // Duration pills
    qs('#duration-pills').addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      qsa('.pill', qs('#duration-pills')).forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      state.duration = Number(pill.dataset.duration);
      updatePrice();
      updateSubmitState();
    });

    // File select
    const dropZone = qs('#drop-zone');
    const fileInput = qs('#file-input');
    dropZone.addEventListener('click', () => fileInput.click());
    ['dragover', 'dragenter'].forEach(evt => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
    dropZone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    function showFileError(message) {
      const el = qs('#file-error');
      el.textContent = message;
      el.style.display = 'block';
      qs('#drop-zone').classList.add('field-error');
    }
    function hideFileError() {
      const el = qs('#file-error');
      el.style.display = 'none';
      el.textContent = '';
      qs('#drop-zone').classList.remove('field-error');
    }

    async function handleFile(file) {
      hideFileError();
      if (state.fileURL) {
        URL.revokeObjectURL(state.fileURL);
      }
      state.file = null;
      state.fileURL = null;
      renderPreview(qs('#tv-preview'), { url: null });
      updateSubmitState();

      const validation = validateMediaFile(file, config);
      if (!validation.ok) {
        showToast({ type: 'error', title: 'Invalid file', message: validation.message });
        showFileError(validation.message);
        return;
      }
      if (validation.type !== state.type) {
        const msg = `Please select an ${state.type === 'image' ? 'image' : 'video'} file, or switch the media type above.`;
        showToast({ type: 'error', title: 'File type mismatch', message: msg });
        showFileError(msg);
        return;
      }

      const url = URL.createObjectURL(file);

      let processedFile = file;
      let processedUrl = url;

      if (validation.type === 'image') {
        if (file.size > 2 * 1024 * 1024) {
          showToast({ type: 'info', title: 'Optimizing image', message: 'Compressing image for faster upload...' });
          try {
            const compressed = await compressImage(file);
            showToast({ type: 'success', title: 'Image optimized', message: `Reduced from ${(file.size/1024/1024).toFixed(1)}MB to ${(compressed.size/1024/1024).toFixed(1)}MB` });
            URL.revokeObjectURL(url);
            processedFile = compressed;
            processedUrl = URL.createObjectURL(compressed);
          } catch (err) {
            console.warn('Image compression failed, using original:', err);
            showToast({ type: 'warning', title: 'Compression skipped', message: 'Using original image.' });
          }
        }

        const durationCheck = validateImageDuration(state.duration);
        if (!durationCheck.ok) {
          showToast({ type: 'error', title: 'Invalid duration', message: durationCheck.message });
          showFileError(durationCheck.message);
          URL.revokeObjectURL(processedUrl);
          return;
        }
      }

      if (validation.type === 'video') {
        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.src = processedUrl;
        await new Promise(resolve => { probe.onloadedmetadata = resolve; probe.onerror = resolve; });
        const actualSeconds = Math.ceil(probe.duration || 0);
        if (!actualSeconds) {
          const msg = "Could not read this video's duration. Please try a different file.";
          showToast({ type: 'error', title: 'Video unreadable', message: msg });
          showFileError(msg);
          URL.revokeObjectURL(processedUrl);
          return;
        }
        const maxAllowed = config.maxVideoSeconds || 60;
        state.duration = Math.min(actualSeconds, maxAllowed);
        if (actualSeconds > maxAllowed) {
          showToast({ type: 'info', title: 'Playback duration capped', message: `This video is ${actualSeconds}s long; it will play for the first ${maxAllowed}s, the platform's current maximum.` });
        }
        qs('#duration-field').style.display = 'none';
      }

      state.file = processedFile;
      state.fileURL = processedUrl;
      renderPreview(qs('#tv-preview'), { url: processedUrl, type: validation.type });
      updateSubmitState();
      showToast({ type: 'success', title: 'File ready', message: 'Preview updated below.' });
    }

    // Screen picker
    await refreshScreens();

    // Initialize screen targeting UI
    renderScreenTargeting();
    updateSubmitState();

    // Live updates
    watchLive({
      'ads.json': (data) => { if (!data?.localEmit) refreshScreens(); },
      'screens.json': (data) => { if (!data?.localEmit) refreshScreens(); }
    });

    // Submit
    qs('#submit-advertise').addEventListener('click', async () => {
      if (!state.file || !state.screenIds) return;
      const btn = qs('#submit-advertise');
      btn.classList.add('btn-loading');
      btn.disabled = true;

      const result = await AdvertisementService.upload({
        file: state.file,
        screenId: state.screenIds,
        duration: state.duration,
        days: state.days
      });

      if (!result.ok) {
        showToast({ type: 'error', title: 'Upload failed', message: result.message || 'Please try again.' });
        btn.classList.remove('btn-loading');
        btn.disabled = false;
        return;
      }

      showToast({ type: 'success', title: 'Advertisement is live', message: 'It is already showing on the selected screen.' });
      // Previously redirected to /history, which is requireAuth('advertiser')-
      // gated - an admin session hitting it gets immediately bounced back to
      // /admin (defaulting to the Dashboard tab), so this never actually
      // showed the admin their uploaded ad; it just flashed to /history and
      // silently landed on the wrong tab. Switch to the Admin's own
      // Advertisements tab instead (setActiveTab already updates the hash
      // itself), which re-fetches and shows the ad that was just created -
      // matching "refresh admin advertisement list" without leaving the
      // admin panel at all.
      setActiveTab('ads');
    });
  }

  const initialTab = tabs.includes(window.location.hash.replace('#', '')) ? window.location.hash.replace('#', '') : 'dashboard';
  setActiveTab(initialTab);
})();

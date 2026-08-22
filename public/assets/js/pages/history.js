import { requireAuth } from '../core/auth.js';
import { mountShell } from '../components/shell.js';
import { showLoader, hideLoader } from '../components/loader.js';
import { AdvertisementService } from '../services/advertisement.service.js';
import { watchLive } from '../core/live.js';
import { showToast } from '../components/toast.js';
import { confirmDialog, previewDialog } from '../components/modal.js';
import { formatCurrency, qs, qsa, escapeHTML, formatScreenLabel } from '../core/helpers.js';
import { formatDate } from '../utils/date.js';
import { createLiquidDropdown } from '../components/liquid-dropdown.js';

(async function init() {
  showLoader('Loading History');
  const session = await requireAuth('advertiser');
  if (!session) return;

  const main = mountShell({ activeHref: '/history', session });
  hideLoader();
  let activeFilter = 'all';
  let searchText = '';
  let sortBy = 'newest';
  let cachedAds = [];
  let lastHistoryFingerprint = '';

  main.insertAdjacentHTML('beforeend', `
    <div class="page-header">
      <div>
        <div class="eyebrow">Campaigns</div>
        <h1 style="font-size:var(--fs-heading);margin-top:8px;">History</h1>
      </div>
    </div>
    <div class="filter-bar" style="flex-wrap:wrap;gap:var(--space-3);">
      <div class="search-box" style="flex:1;min-width:0;width:100%;max-width:100%;">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.6"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <input type="text" id="history-search" placeholder="Search by screen ID or file name" style="height:40px;width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--color-border-soft);border-radius:var(--radius-md);color:var(--color-text);padding-left:40px;">
      </div>
      <div id="history-sort-dropdown" style="flex:1;min-width:140px;max-width:200px;"></div>
      <div class="filter-chips" style="display:flex;flex-wrap:wrap;gap:var(--space-2);">
        ${['all', 'active', 'expired'].map(f => `<button class="filter-chip ${f === 'all' ? 'active' : ''}" data-filter="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
      </div>
    </div>
    <div class="table-wrap as-cards glass-card" style="padding:0;">
      <table class="data-table">
        <thead><tr><th>Preview</th><th>Screen</th><th>Type</th><th>Duration</th><th>Ends</th><th>Price</th><th>Status</th><th></th></tr></thead>
        <tbody id="history-body"></tbody>
      </table>
    </div>
    <div id="history-empty" style="display:none;"></div>
  `);

  async function getAds() {
    cachedAds = await AdvertisementService.listByUser(session.id);
    return cachedAds;
  }

  async function render(force = false) {
    let list = await getAds();
    if (activeFilter !== 'all') list = list.filter(a => a.status === activeFilter);
    if (searchText) {
      // ad.screenId isn't always a plain string - Admin-sourced ads can
      // store it as 'all' or an array of screen IDs (see ad.controller.js
      // upload()). This same account could see those ads here if an admin
      // account also passes requireAuth('advertiser'), so use the shared
      // formatScreenLabel() helper instead of assuming .toLowerCase()
      // exists directly on ad.screenId, which would throw a TypeError on
      // any array/'all' record and silently break the entire list for
      // that render pass the moment the person typed anything into search.
      list = list.filter(a =>
        formatScreenLabel(a.screenId).toLowerCase().includes(searchText) ||
        (a.fileName || '').toLowerCase().includes(searchText)
      );
    }
    list = list.slice().sort((a, b) => {
      if (sortBy === 'oldest') return a.createdAt - b.createdAt;
      if (sortBy === 'price-high') return b.price - a.price;
      if (sortBy === 'price-low') return a.price - b.price;
      if (sortBy === 'ending-soon') return new Date(a.endDate) - new Date(b.endDate);
      return b.createdAt - a.createdAt;
    });

    const newFingerprint = JSON.stringify(list.map(a => ({ id: a.id, status: a.status, endDate: a.endDate, price: a.price, screenId: a.screenId })));
    if (!force && newFingerprint === lastHistoryFingerprint) return;
    lastHistoryFingerprint = newFingerprint;

    const body = document.getElementById('history-body');
    const wrap = document.querySelector('.table-wrap');
    const empty = document.getElementById('history-empty');

    if (!list.length) {
      wrap.style.display = 'none';
      empty.style.display = 'block';
      empty.innerHTML = `<div class="glass-card empty-state"><h3>No advertisements found</h3><p>Try a different filter or search, or upload a new advertisement.</p></div>`;
      return;
    }
    wrap.style.display = '';
    empty.style.display = 'none';

    body.innerHTML = list.map(ad => `
      <tr>
        <td data-label="Preview"><div style="width:64px;height:40px;border-radius:8px;overflow:hidden;background:#000;cursor:pointer;" data-preview="${ad.id}">
          ${ad.mediaType === 'video' ? `<video src="${ad.mediaUrl}" muted loading="lazy" style="width:100%;height:100%;object-fit:cover;"></video>` : `<img src="${ad.mediaUrl}" alt="Advertisement for ${escapeHTML(ad.screenId)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`}
        </div></td>
        <td data-label="Screen">${escapeHTML(formatScreenLabel(ad.screenId))}</td>
        <td data-label="Type" style="text-transform:capitalize;">${ad.mediaType}</td>
        <td data-label="Duration">${ad.duration}s</td>
        <td data-label="Ends">${formatDate(ad.endDate)}</td>
        <td data-label="Price">${formatCurrency(ad.price)}</td>
        <td data-label="Status"><span class="badge badge-${ad.status}">${ad.status}</span></td>
        <td data-label="Actions">
          <div class="flex gap-2" style="flex-wrap:wrap;justify-content:flex-end;gap:6px;">
            <button class="btn btn-sm btn-secondary" data-preview="${ad.id}" style="padding:6px 10px;font-size:0.75rem;">Preview</button>
            <button class="btn btn-sm btn-secondary" data-renew="${ad.id}" style="padding:6px 10px;font-size:0.75rem;">Renew</button>
            <button class="btn btn-sm btn-secondary" data-duplicate="${ad.id}" style="padding:6px 10px;font-size:0.75rem;">Duplicate</button>
            <button class="btn btn-sm btn-danger" data-delete="${ad.id}" style="padding:6px 10px;font-size:0.75rem;">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  qsa('.filter-chip').forEach(chip => chip.addEventListener('click', () => {
    qsa('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    render(true);
  }));

  qs('#history-search').addEventListener('input', (e) => {
    searchText = e.target.value.trim().toLowerCase();
    render(true);
  });

  // Initialize liquid-glass dropdown for sort
  const sortDropdown = createLiquidDropdown({
    container: qs('#history-sort-dropdown'),
    id: 'history-sort-dropdown',
    options: [
      { value: 'newest', label: 'Newest first' },
      { value: 'oldest', label: 'Oldest first' },
      { value: 'price-high', label: 'Price: high to low' },
      { value: 'price-low', label: 'Price: low to high' },
      { value: 'ending-soon', label: 'Ending soon' }
    ],
    value: 'newest',
    placeholder: 'Sort by',
    onChange: (value) => {
      sortBy = value;
      render(true);
    }
  });

  // Sort dropdown is now handled by the liquid dropdown

  qs('#history-body').addEventListener('click', async (e) => {
    const preview = e.target.closest('[data-preview]');
    const renew = e.target.closest('[data-renew]');
    const duplicate = e.target.closest('[data-duplicate]');
    const del = e.target.closest('[data-delete]');

    if (preview) {
      const ad = cachedAds.find(a => a.id === preview.dataset.preview);
      if (ad) previewDialog({ title: `${formatScreenLabel(ad.screenId)} \u00b7 ${ad.mediaType}`, mediaType: ad.mediaType, mediaData: ad.mediaUrl });
    }
    if (renew) {
      const ok = await confirmDialog({ title: 'Renew campaign?', message: 'This extends the campaign by 7 days, effective immediately.', confirmLabel: 'Renew' });
      if (ok) {
        const result = await AdvertisementService.renew(renew.dataset.renew, 7);
        if (!result.ok) { showToast({ type: 'error', title: 'Could not renew', message: result.message }); return; }
        showToast({ type: 'success', title: 'Campaign renewed' });
        render(true);
      }
    }
    if (duplicate) {
      const result = await AdvertisementService.duplicate(duplicate.dataset.duplicate);
      if (!result.ok) { showToast({ type: 'error', title: 'Could not duplicate', message: result.message }); return; }
      showToast({ type: 'success', title: 'Advertisement duplicated', message: 'A copy was created and is live immediately.' });
      render(true);
    }
    if (del) {
      const ok = await confirmDialog({ title: 'Delete advertisement?', message: 'This will permanently remove it from your history.', confirmLabel: 'Delete', danger: true });
      if (ok) {
        const result = await AdvertisementService.remove(del.dataset.delete);
        if (!result.ok) { showToast({ type: 'error', title: 'Could not delete', message: result.message }); return; }
        showToast({ type: 'success', title: 'Advertisement deleted' });
        render(true);
      }
    }
  });

  render(true);

  // Live updates: reflect uploads/deletes/renewals made elsewhere without a page reload
  // Skip localEmit since the action's click handler already updates the UI
  watchLive({
    'ads.json': (data) => { if (!data?.localEmit) render(); },
    'screens.json': (data) => { if (!data?.localEmit) render(); }
  });
})();

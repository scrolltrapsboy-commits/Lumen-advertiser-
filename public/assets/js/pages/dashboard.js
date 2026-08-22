import { requireAuth } from '../core/auth.js';
import { mountShell } from '../components/shell.js';
import { showLoader, hideLoader } from '../components/loader.js';
import { mountNetworkPreview } from '../components/network-preview.js';
import { AdvertisementService } from '../services/advertisement.service.js';
import { watchLive } from '../core/live.js';
import { formatCurrency, animateCount, escapeHTML, formatScreenLabel } from '../core/helpers.js';
import { formatDate, daysRemaining } from '../utils/date.js';

(async function init() {
  showLoader('Loading Dashboard');
  const session = await requireAuth('advertiser');
  if (!session) return;

  const main = mountShell({ activeHref: '/dashboard', session });
  hideLoader();

  main.insertAdjacentHTML('beforeend', `
    <div class="welcome-banner glass-card">
      <div>
        <div class="eyebrow">Advertiser Portal</div>
        <h1 class="fs-heading" style="font-size:var(--fs-heading);margin-top:8px;">Welcome back, ${escapeHTML(session.name || session.email)}</h1>
        <p class="text-secondary" style="margin-top:8px;">Manage your advertisements and keep every screen filled.</p>
      </div>
      <a href="/upload" class="btn btn-primary">+ Upload Advertisement</a>
    </div>

    <div class="stat-grid mt-8">
      <div class="glass-card stat-card"><div class="stat-value" id="stat-total">0</div><div class="stat-label">Total Ads</div></div>
      <div class="glass-card stat-card"><div class="stat-value" id="stat-running">0</div><div class="stat-label">Running Now</div></div>
      <div class="glass-card stat-card"><div class="stat-value" id="stat-ending">0</div><div class="stat-label">Ending Within 3 Days</div></div>
      <div class="glass-card stat-card"><div class="stat-value" id="stat-spend">${formatCurrency(0)}</div><div class="stat-label">Total Spend</div></div>
    </div>

    <div class="dashboard-layout">
      <div>
        <div class="page-header mt-8" style="margin-bottom:0;"><h2 style="font-size:var(--fs-title);">Recent Advertisements</h2></div>
        <div id="ad-list" class="mt-6"></div>
      </div>
      <div class="mt-8">
        <div class="glass-card glass-card--floating">
          <div class="spatial-screen" style="width:100%;transform:rotateY(-8deg) rotateX(4deg);animation:none;">
            <div class="spatial-screen-panel" style="aspect-ratio:16/11;">
              <div class="spatial-screen-canvas" id="dashboard-network-preview" style="padding:0;">
                <span class="spatial-screen-live" style="z-index:5;"><span class="dot"></span> LIVE</span>
              </div>
            </div>
          </div>
          <div id="dashboard-network-label" class="text-tertiary mt-3" style="font-size:var(--fs-xs);text-align:center;text-transform:uppercase;letter-spacing:0.05em;">Lumen Network</div>
          <a href="/upload" class="btn btn-secondary btn-block mt-6">+ New Advertisement</a>
          <a href="/history" class="btn btn-ghost btn-block mt-3">View History</a>
        </div>
      </div>
    </div>
  `);

  mountNetworkPreview(document.getElementById('dashboard-network-preview'), {
    labelEl: document.getElementById('dashboard-network-label')
  });

  let lastAdListFingerprint = '';

  async function render() {
    const ads = await AdvertisementService.listByUser(session.id);
    const running = ads.filter(a => a.status === 'active').length;
    const endingSoon = ads.filter(a => a.status === 'active' && daysRemaining(a.endDate) <= 3).length;
    const spend = ads.reduce((s, a) => s + a.price, 0);

    animateCount(document.getElementById('stat-total'), ads.length);
    animateCount(document.getElementById('stat-running'), running);
    animateCount(document.getElementById('stat-ending'), endingSoon);
    document.getElementById('stat-spend').textContent = formatCurrency(spend);

    const list = document.getElementById('ad-list');
    const recent = [...ads].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);

    const newFingerprint = JSON.stringify(recent.map(a => ({ id: a.id, status: a.status, screenId: a.screenId, endDate: a.endDate, price: a.price })));
    if (newFingerprint === lastAdListFingerprint) return;
    lastAdListFingerprint = newFingerprint;

    if (!recent.length) {
      list.innerHTML = `
        <div class="glass-card empty-state">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none"><path d="M4 5h16v11H4zM8 20h8M12 16v4" stroke="currentColor" stroke-width="1.4"/></svg>
          <h3>No advertisements yet</h3>
          <p>Upload your first ad and choose a screen to start reaching customers today.</p>
          <a href="/upload" class="btn btn-primary mt-4">Upload Advertisement</a>
        </div>`;
      return;
    }

    list.innerHTML = `
      <div class="grid grid-3">
        ${recent.map(ad => `
          <div class="glass-card glass-card--hover">
            <div class="flex items-center justify-between">
              <span class="badge badge-${ad.status}">${ad.status}</span>
              <span class="text-tertiary" style="font-size:.75rem;">${ad.mediaType === 'video' ? 'Video' : 'Image'}</span>
            </div>
            <div class="mt-4" style="border-radius:var(--radius-md);overflow:hidden;aspect-ratio:16/9;background:#000;">
              ${ad.mediaType === 'video'
                ? `<video src="${ad.mediaUrl}" muted loading="lazy"></video>`
                : `<img src="${ad.mediaUrl}" alt="Advertisement" loading="lazy">`}
            </div>
            <div class="mt-4" style="font-weight:600;">${escapeHTML(formatScreenLabel(ad.screenId))}</div>
            <div class="text-tertiary" style="font-size:.8125rem;">
              ${ad.status === 'expired' ? 'Expired' : `${Math.max(0, daysRemaining(ad.endDate))} days left`} \u00b7 Ends ${formatDate(ad.endDate)}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  await render();

  // Realtime updates: refresh stats and recent ads instantly on change
  // Skip localEmit since the action's click handler already updates the UI
  watchLive({
    'ads.json': (data) => { if (!data?.localEmit) render(); },
    'screens.json': (data) => { if (!data?.localEmit) render(); }
  });
})();

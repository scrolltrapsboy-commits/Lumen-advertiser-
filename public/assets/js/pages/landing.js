import { getSession } from '../core/auth.js';
import { ScreenService } from '../services/screen.service.js';
import { AdvertisementService } from '../services/advertisement.service.js';
import { escapeHTML, formatScreenLabel } from '../core/helpers.js';
import { mountNetworkPreview } from '../components/network-preview.js';
import { watchLive } from '../core/live.js';

/** Auth-aware navbar + CTAs: real session data only, never a hardcoded name. */
async function applyAuthState() {
  const session = await getSession();
  const destination = session ? (session.role === 'admin' ? '/admin' : '/dashboard') : null;

  const navArea = document.getElementById('nav-auth-area');
  if (navArea) {
    navArea.innerHTML = session
      ? `<div class="logged-in-nav" style="display:flex;align-items:center;gap:12px;">
           <span class="user-name" style="font-weight:500;color:var(--color-text);">${escapeHTML(session.name || session.email)}</span>
           <a href="${destination}" class="btn btn-primary btn-sm">Dashboard</a>
         </div>`
      : `<a href="login.html" class="btn btn-ghost btn-sm">Log in</a>
         <a href="signup.html" class="btn btn-primary btn-sm">Get Started</a>`;
  }

  // Hero CTA - for logged in users, show Dashboard button + Upload
  const heroCta = document.getElementById('hero-cta');
  if (heroCta) {
    heroCta.innerHTML = session
      ? `<a href="${destination}" class="btn btn-primary">Dashboard</a>
         <a href="/upload" class="btn btn-secondary">Upload Advertisement</a>`
      : `<a href="signup.html" class="btn btn-primary">Upload Your Advertisement</a>
         <a href="login.html" class="btn btn-secondary">Advertiser Login</a>`;
  }

  // Final CTA - for logged in users, show Dashboard button + Upload
  const finalCta = document.getElementById('final-cta');
  if (finalCta) {
    finalCta.innerHTML = session
      ? `<a href="${destination}" class="btn btn-primary">Go to Dashboard</a>
         <a href="/upload" class="btn btn-secondary">Upload Advertisement</a>`
      : `<a href="signup.html" class="btn btn-primary">Start Your Campaign</a>
         <a href="login.html" class="btn btn-secondary">Advertiser Login</a>`;
  }
}

/** Real screen counts from the public screens endpoint — never a placeholder number. */
async function applyScreenStats() {
  const heroStat = document.getElementById('stat-screens-online');
  const panelStat = document.getElementById('stat-screens-panel');
  try {
    const screens = await ScreenService.list();
    const online = screens.filter((s) => s.status === 'online').length;
    if (heroStat) heroStat.textContent = String(online);
    if (panelStat) panelStat.textContent = `${online} Screen${online === 1 ? '' : 's'}`;
  } catch (err) {
    if (heroStat) heroStat.textContent = '0';
    if (panelStat) panelStat.textContent = '0 Screens';
  }
}

function tickClock() {
  const clockEl = document.getElementById('stat-clock');
  if (!clockEl) return;
  clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Footer's "X of Y screens online" line - same ScreenService.list() source
 * as applyScreenStats()/applyNetworkStageLabels() above, not a second API.
 * Never hardcoded: if Admin adds/removes a screen, the next watchLive tick
 * (wired up below) recalculates this from the current screen list.
 */
async function applyFooterStatus() {
  const el = document.getElementById('footer-network-status');
  if (!el) return;
  try {
    const screens = await ScreenService.list();
    const total = screens.length;
    const online = screens.filter((s) => s.status === 'online').length;
    const allOnline = total > 0 && online === total;
    el.innerHTML = `<span class="dot" style="background:${allOnline ? 'var(--color-success)' : 'var(--color-warning)'};box-shadow:0 0 8px ${allOnline ? 'rgba(62,210,142,0.7)' : 'rgba(245,185,77,0.6)'};"></span> ${
      total === 0
        ? 'Network status unavailable'
        : allOnline
          ? `All systems operational \u00b7 ${online} of ${total} screens online`
          : `${online} of ${total} screens online`
    }`;
  } catch (err) {
    el.innerHTML = '<span class="dot" style="background:var(--color-text-muted);box-shadow:none;"></span> Network status unavailable';
  }
}

/**
 * The "screen network" diagram used 4 fixed CSS-positioned node slots
 * (network-node--n1..n4), one per real screen by array index. That works
 * only while there are <= 4 screens - the default install ships exactly 4,
 * which fully occupies every slot, so any screen added after that
 * (screens[4] and beyond) had no slot to render into and could never
 * appear here, matching the reported "new screen doesn't show on
 * homepage" bug exactly. Rebuilt to generate one node per real screen
 * (visually capped, not data-capped) at a computed position around the
 * center hub, so it scales to however many screens actually exist and
 * updates whenever this runs again (e.g. after a screen is added).
 */
async function applyNetworkStageLabels() {
  const stage = document.querySelector('.network-stage');
  if (!stage) return;

  try {
    const screens = await ScreenService.list();

    // Visual legibility cap on a fixed-size stage - never a cap on which
    // screens count elsewhere (applyScreenStats above already counts every
    // real screen). If there are more than this, still show the first N
    // rather than hiding all of them.
    const MAX_VISIBLE_NODES = 8;
    const shown = screens.slice(0, MAX_VISIBLE_NODES);

    // Remove previously-generated nodes (including the original static
    // n1-n4 markup, which also carries the base .network-node class) and
    // rebuild from the current screen list, leaving the center hub label
    // untouched.
    stage.querySelectorAll('.network-node:not(.network-node--center)').forEach((n) => n.remove());

    const radiusX = 42; // % from stage center
    const radiusY = 40;
    shown.forEach((screen, i) => {
      const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
      const left = 50 + radiusX * Math.cos(angle);
      const top = 50 + radiusY * Math.sin(angle);

      const node = document.createElement('div');
      node.className = 'network-node';
      node.style.left = `${left}%`;
      node.style.top = `${top}%`;
      node.style.transform = 'translate(-50%, -50%)';
      node.style.animationDelay = `${-i * 1.3}s`;

      const dot = document.createElement('span');
      dot.className = 'dot';
      // Real status from the backend, not an assumed/hardcoded color -
      // matches the same online/success vs offline/danger convention used
      // by .badge-online/.badge-offline elsewhere in the app.
      dot.style.background = screen.status === 'online' ? 'var(--color-success)' : 'var(--color-danger)';
      node.appendChild(dot);
      node.appendChild(document.createTextNode(' ' + (screen.place || screen.id)));
      stage.appendChild(node);
    });
  } catch (err) {
    // Leave whatever was already rendered (or just the center hub) rather
    // than throwing - this is a decorative homepage section, never worth
    // breaking the rest of the page load over.
  }
}

applyAuthState();
applyScreenStats();
applyNetworkStageLabels();
applyFooterStatus();
tickClock();
setInterval(tickClock, 30000);

// Reuse the app's existing live-update infrastructure (poll-based version
// stamps, same mechanism history/admin/display already use) instead of a
// second polling system, so the homepage's screen count, network diagram,
// and footer status stay current after Admin adds/edits/removes a screen
// elsewhere, without requiring a manual page reload here.
watchLive({
  'screens.json': () => { applyScreenStats(); applyNetworkStageLabels(); applyFooterStatus(); }
}, { intervalMs: 5000 });

const heroPreviewEl = document.getElementById('hero-network-preview');
if (heroPreviewEl) mountNetworkPreview(heroPreviewEl);

async function applyMiniCampaigns() {
  const container = document.querySelector('.mini-campaign');
  if (!container) return;
  try {
    const ads = await AdvertisementService.listAll();
    const activeAds = ads.filter(a => a.status === 'active').slice(0, 3);
    if (activeAds.length === 0) {
      container.innerHTML = '<div class="text-tertiary" style="text-align:center;padding:var(--space-4);">No active campaigns yet</div>';
      return;
    }
    container.innerHTML = activeAds.map(ad => {
      // ad.screenId can be an array (Admin multi-screen targeting) or the
      // literal string 'all', not just a single screen ID string. Passing
      // an array straight through escapeHTML() silently stringifies it via
      // Array.prototype.toString() into "SCREEN001,SCREEN002,SCREEN003" -
      // rendered as if that comma-joined text were one single screen name,
      // which is exactly the corrupted-looking label being reported.
      return `
      <div class="mini-campaign-row"><span>${escapeHTML(formatScreenLabel(ad.screenId))}</span><span class="badge badge-${ad.status}">${ad.status}</span></div>
    `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div class="text-tertiary" style="text-align:center;padding:var(--space-4);">Unable to load campaigns</div>';
  }
}
applyMiniCampaigns();

async function applyMiniAnalytics() {
  const container = document.querySelector('.mini-analytics-bars');
  if (!container) return;
  try {
    const ads = await AdvertisementService.listAll();
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const counts = days.map(() => 0);
    ads.forEach(ad => {
      const created = new Date(ad.createdAt).getTime();
      if (now - created < weekMs) {
        const dayIdx = new Date(ad.createdAt).getDay();
        counts[dayIdx]++;
      }
    });
    const maxCount = Math.max(...counts, 1);
    container.innerHTML = counts.map((count, i) => `
      <span style="height:${(count / maxCount) * 100}%;" title="${days[i]}: ${count} ads"></span>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="text-tertiary" style="text-align:center;width:100%;padding:var(--space-4);">Unable to load analytics</div>';
  }
}
applyMiniAnalytics();

import { logout } from '../core/auth.js';

/**
 * Loads TimepickerUI from CDN with a pinned version to avoid breaking changes.
 * Includes graceful error handling to prevent syntax errors from breaking the page.
 * If the CDN package is unavailable, falls back to a simple native time input enhancement.
 */
export async function loadTimepickerUI() {
  if (typeof TimepickerUI !== 'undefined') return;
  
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      // Pin to a specific version to avoid breaking changes from @latest
      script.src = 'https://cdn.jsdelivr.net/npm/@timepicker-ui/core@1.0.0/dist/timepicker-ui.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('TimepickerUI failed to load'));
      document.head.appendChild(script);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/@timepicker-ui/core@1.0.0/dist/timepicker-ui.min.css';
      document.head.appendChild(link);
    });
  } catch (err) {
    console.warn('[Admin] TimepickerUI CDN unavailable, using native time inputs with custom picker:', err);
    // Fallback: provide a simple time picker implementation
    if (typeof window.TimepickerUI === 'undefined') {
      window.TimepickerUI = createSimpleTimepicker();
    }
  }
}

/**
 * Simple time picker fallback implementation
 * Provides a basic UI for time selection without external dependencies
 */
function createSimpleTimepicker() {
  return class SimpleTimepicker {
    constructor(input, options = {}) {
      this.input = input;
      this.options = options;
      this.isOpen = false;
      this.selectedTime = input.value || '08:00 AM';
    }
    
    create() {
      // Add click handler to show picker
      this.input.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
      
      // Add keyboard support
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          e.preventDefault();
          this.open();
        }
      });
      
      // Close on outside click
      document.addEventListener('click', (e) => {
        if (this.isOpen && !this.picker.contains(e.target) && e.target !== this.input) {
          this.close();
        }
      });
    }
    
    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }
    
    open() {
      if (this.isOpen) return;
      this.isOpen = true;
      this.renderPicker();
      document.body.appendChild(this.picker);
      // Position picker below input
      const rect = this.input.getBoundingClientRect();
      this.picker.style.position = 'fixed';
      this.picker.style.top = `${rect.bottom + 4}px`;
      this.picker.style.left = `${rect.left}px`;
      this.picker.style.zIndex = '1000';
      this.input.setAttribute('aria-expanded', 'true');
    }
    
    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      if (this.picker && this.picker.parentNode) {
        this.picker.remove();
      }
      this.input.setAttribute('aria-expanded', 'false');
    }
    
    renderPicker() {
      this.picker = document.createElement('div');
      this.picker.className = 'simple-timepicker';
      this.picker.style.cssText = `
        background: var(--color-bg-elevated, #0a0c11);
        border: 1px solid var(--color-border, rgba(255,255,255,0.1));
        border-radius: var(--radius-md, 16px);
        padding: 12px;
        box-shadow: var(--shadow-lg, 0 18px 48px rgba(0,0,0,0.46));
        backdrop-filter: var(--blur-md, blur(22px));
        -webkit-backdrop-filter: var(--blur-md, blur(22px));
        min-width: 200px;
      `;
      
      const [hours, minutes, period] = this.parseTime(this.input.value || '08:00 AM');
      
      this.picker.innerHTML = `
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.7rem; color: var(--color-text-tertiary); text-transform: uppercase;">Hour</label>
            <select id="tp-hour" style="background: var(--color-glass); border: 1px solid var(--color-border); border-radius: 8px; padding: 8px; color: var(--color-text);">
              ${Array.from({length: 12}, (_, i) => i + 1).map(h => 
                `<option value="${h}" ${h === hours ? 'selected' : ''}>${h}</option>`
              ).join('')}
            </select>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.7rem; color: var(--color-text-tertiary); text-transform: uppercase;">Minute</label>
            <select id="tp-minute" style="background: var(--color-glass); border: 1px solid var(--color-border); border-radius: 8px; padding: 8px; color: var(--color-text);">
              ${[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => 
                `<option value="${String(m).padStart(2, '0')}" ${String(m).padStart(2, '0') === minutes ? 'selected' : ''}>${String(m).padStart(2, '0')}</option>`
              ).join('')}
            </select>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.7rem; color: var(--color-text-tertiary); text-transform: uppercase;">Period</label>
            <select id="tp-period" style="background: var(--color-glass); border: 1px solid var(--color-border); border-radius: 8px; padding: 8px; color: var(--color-text);">
              <option value="AM" ${period === 'AM' ? 'selected' : ''}>AM</option>
              <option value="PM" ${period === 'PM' ? 'selected' : ''}>PM</option>
            </select>
          </div>
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border-soft);">
          <button type="button" id="tp-cancel" class="btn btn-ghost btn-sm">Cancel</button>
          <button type="button" id="tp-ok" class="btn btn-primary btn-sm">OK</button>
        </div>
      `;
      
      this.picker.querySelector('#tp-ok').addEventListener('click', () => {
        const hour = this.picker.querySelector('#tp-hour').value;
        const minute = this.picker.querySelector('#tp-minute').value;
        const period = this.picker.querySelector('#tp-period').value;
        this.input.value = `${hour}:${minute} ${period}`;
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
        this.close();
      });
      
      this.picker.querySelector('#tp-cancel').addEventListener('click', () => {
        this.close();
      });
    }
    
    parseTime(timeStr) {
      const match = String(timeStr).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (!match) return [8, '00', 'AM'];
      let hour = parseInt(match[1], 10);
      const minute = match[2];
      const period = match[3] || 'AM';
      return [hour, minute, period.toUpperCase()];
    }
  };
}

const ADVERTISER_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { href: '/upload', label: 'Upload Advertisement', icon: 'upload' },
  { href: '/history', label: 'History', icon: 'clock' },
  { href: '/settings', label: 'Settings', icon: 'settings' }
];

const ADMIN_NAV = [
  { href: '/admin', hash: '', label: 'Dashboard', icon: 'grid' },
  { href: '/admin', hash: 'screens', label: 'Screens', icon: 'tv' },
  { href: '/admin', hash: 'ads', label: 'Advertisements', icon: 'image' },
  { href: '/admin', hash: 'users', label: 'Users', icon: 'users' },
  { href: '/admin', hash: 'analytics', label: 'Analytics', icon: 'chart' },
  { href: '/admin', hash: 'settings', label: 'Settings', icon: 'settings' }
];

// Landing page is the home for the logo - never redirects to dashboard
const LOGO_HREF = '/';

const ICONS = {
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  upload: '<path d="M12 16V4M12 4l-4 4M12 4l4 4M5 16v3a1 1 0 001 1h12a1 1 0 001-1v-3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  settings: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M9 21h6M12 17v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M21 16l-5.5-5.5L3 20" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  users: '<circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 8.2a3 3 0 010 5.9M21 20c0-2.7-1.9-5-4.5-5.7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  chart: '<path d="M4 20V10M12 20V4M20 20v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
};

export function mountShell({ activeHref, session }) {
  const isAdmin = session && session.role === 'admin';
  const nav = isAdmin ? ADMIN_NAV : ADVERTISER_NAV;
  const currentHash = window.location.hash.replace('#', '');

  function isActive(item) {
    if (item.hash !== undefined) return item.href === activeHref && item.hash === currentHash;
    return item.href === activeHref;
  }

  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <button class="sidebar-overlay" id="sidebar-overlay" aria-hidden="true" tabindex="-1"></button>
    <aside class="sidebar glass" id="sidebar" aria-label="Main navigation">
      <a class="brand" href="${LOGO_HREF}">
        <span class="brand-mark"></span> Lumen
      </a>
      <nav class="sidebar-nav">
        ${nav.map(item => `
          <a class="sidebar-link ${isActive(item) ? 'active' : ''}" href="${item.href}${item.hash ? '#' + item.hash : ''}" ${isActive(item) ? 'aria-current="page"' : ''}>
            <svg viewBox="0 0 24 24">${ICONS[item.icon]}</svg>
            <span>${item.label}</span>
          </a>`).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="glass-card" style="padding:16px;margin-bottom:12px;">
          <div style="font-weight:600;font-size:.9rem;">${session ? session.name || session.email : ''}</div>
          <div class="text-tertiary" style="font-size:.75rem;">${session ? session.role : ''}</div>
        </div>
        <button class="btn btn-ghost btn-block" id="logout-btn">Log out</button>
      </div>
    </aside>
    <main class="main-content" id="main-content"></main>
  `;
  document.body.prepend(shell);

  const topbar = document.createElement('div');
  topbar.className = 'flex items-center justify-between';
  topbar.style.marginBottom = '24px';
  topbar.innerHTML = `
    <button class="btn btn-icon btn-secondary sidebar-toggle" id="sidebar-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="sidebar">
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
    <div></div>
  `;
  document.getElementById('main-content').appendChild(topbar);

  document.getElementById('logout-btn').addEventListener('click', logout);

  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('visible');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('sidebar-locked');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sidebar-locked');
  }
  function toggleSidebar() {
    if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
  }

  if (toggle) toggle.addEventListener('click', toggleSidebar);
  overlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });
  sidebar.querySelectorAll('.sidebar-link').forEach(link => link.addEventListener('click', closeSidebar));

  return document.getElementById('main-content');
}

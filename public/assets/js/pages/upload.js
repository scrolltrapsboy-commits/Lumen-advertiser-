import { requireAuth } from '../core/auth.js';
import { mountShell } from '../components/shell.js';
import { showLoader, hideLoader } from '../components/loader.js';
import { getSettings } from '../core/settings.js';
import { ScreenService } from '../services/screen.service.js';
import { AdvertisementService } from '../services/advertisement.service.js';
import { apiFetch } from '../core/api.js';
import { renderPreview } from '../components/tv-preview.js';
import { showToast } from '../components/toast.js';
import { qs, qsa, formatCurrency, escapeHTML } from '../core/helpers.js';
import { validateMediaFile, validateImageDuration } from '../utils/validation.js';
import { slotAvailability } from '../utils/slots.js';
import { formatTime12h } from '../utils/date.js';
import { watchLive } from '../core/live.js';
import { calculatePrice, getPricingConfig } from '../services/pricing.service.js';
import { createLiquidDropdown } from '../components/liquid-dropdown.js';

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
  showLoader('Preparing Upload Studio');
  const session = await requireAuth('advertiser');
  if (!session) return;

  const config = await getSettings();
  const main = mountShell({ activeHref: '/upload', session });
  hideLoader();

  main.insertAdjacentHTML('beforeend', `
    <div class="page-header">
      <div>
        <div class="eyebrow">New Campaign</div>
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
              <span class="type-hint">PNG · JPG · WEBP</span>
            </button>
            <button type="button" class="type-option" data-type="video">
              <span class="type-label">VIDEO</span>
              <span class="type-hint">MP4 · MOV · WEBM · max ${config.maxVideoSeconds || 60}s</span>
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
            ${config.durations.map((d, i) => `<button type="button" class="pill ${i === 1 ? 'selected' : ''}" data-duration="${d}">${d}s</button>`).join('')}
          </div>
        </div>

        <div class="field">
          <label>4. Campaign length</label>
          <div id="days-dropdown"></div>
        </div>

        <div class="field">
          <label>5. Select display screen</label>
          <div id="screen-dropdown"></div>
          <div id="screen-selected-info" class="mt-4"></div>
        </div>

        <div class="field" id="business-field" style="display:none;">
          <label>6. Select business</label>
          <div class="text-tertiary" style="font-size:.8125rem;margin-bottom:8px;" id="business-location-hint"></div>
          <input type="text" id="business-search-input" placeholder="Search shop/business name" autocomplete="off" disabled>
          <div id="business-search-results" class="mt-4"></div>
          <div id="business-selected-info" class="mt-4"></div>
        </div>

        <div id="verification-status" class="mt-4" style="display:none;"></div>

        <button class="btn btn-primary btn-block mt-6" id="submit-upload" disabled>Upload Advertisement</button>
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
            <span id="price-type">Image \u2014 ${formatCurrency(config.pricing.photo)}</span>
          </div>
          <div class="pricing-row">
            <span class="text-secondary">Total</span>
            <span class="pricing-total" id="price-total">${formatCurrency(config.pricing.photo)}</span>
          </div>
        </div>
      </div>
    </div>
  `);

  const state = {
    type: 'image',
    file: null,
    fileURL: null,
    duration: config.durations[0],
    days: 7,
    screenId: null,
    businessId: null,
    businessName: null
  };

  let pricingConfig = null;
  async function loadPricingConfig() {
    pricingConfig = await getPricingConfig();
  }
  await loadPricingConfig();

  function updatePrice() {
    if (!pricingConfig) return 0;
    const result = calculatePrice(state.type, state.duration, state.days, pricingConfig);
    qs('#price-type').textContent = `${state.type === 'image' ? 'Image' : 'Video'} \u2014 ${formatCurrency(result.pricePerDay)}/day`;
    qs('#price-total').textContent = formatCurrency(result.totalPrice);
    return result.totalPrice;
  }
  updatePrice();

  function updateSubmitState() {
    const btn = qs('#submit-upload');
    let full = false;
    if (state.screenId) {
      const screen = screens.find(s => s.id === state.screenId);
      if (screen) full = slotAvailability(screen, ads, state.duration || 10).full;
    }
    // A business must be selected before upload is allowed, per the
    // advertiser-flow spec. state.businessName (not necessarily a resolved
    // businessId) is enough - if nearby search itself is unavailable
    // (Places not configured, or the screen has no registered location
    // yet), the business field falls back to free-text entry instead of
    // hard-blocking every advertiser upload forever - see
    // renderBusinessField() below.
    btn.disabled = !(state.file && state.screenId && state.businessName) || full;
    btn.textContent = full ? 'No Slots Available For Selected Screen' : 'Upload Advertisement';
  }

  // Type toggle
  function renderDurationPills() {
    const container = qs('#duration-pills');
    let durations;
    if (state.type === 'image') {
      durations = [5, 6, 7, 8, 9, 10];
    } else {
      // Video durations: 5-60 seconds in 5-second increments, but max will be
      // limited by actual video duration after file selection
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
        // Hide duration field for video - duration is auto-detected
        durationField.style.display = 'none';
      }
      renderDurationPills();
      if (state.fileURL) {
        URL.revokeObjectURL(state.fileURL);
      }
      state.file = null;
      state.fileURL = null;
      hideFileError();
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
    if (state.screenId) {
      const screen = screens.find(s => s.id === state.screenId);
      if (screen) renderScreenInfo(screen);
    }
    updateScreenDropdown();
    updateSubmitState();
    updatePrice();
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
      // Compress large images client-side to optimize upload
      if (file.size > 2 * 1024 * 1024) { // Compress if > 2MB
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
      // Effective playback duration is MIN(admin's configured maximum, actual
      // video length) - the video itself is never rejected just for being
      // longer than the configured maximum; playback is simply capped.
      const maxAllowed = config.maxVideoSeconds || 60;
      state.duration = Math.min(actualSeconds, maxAllowed);
      if (actualSeconds > maxAllowed) {
        showToast({ type: 'info', title: 'Playback duration capped', message: `This video is ${actualSeconds}s long; it will play for the first ${maxAllowed}s, the platform's current maximum.` });
      }
      // Hide duration pills for video
      qs('#duration-field').style.display = 'none';
    }

    state.file = processedFile;
    state.fileURL = processedUrl;
    renderPreview(qs('#tv-preview'), { url: processedUrl, type: validation.type });
    updateSubmitState();
    showToast({ type: 'success', title: 'File ready', message: 'Preview updated below.' });
  }

  // Screen picker — load defensively so a transient API hiccup on either
  // call can never silently break the rest of page init (days dropdown,
  // submit button, etc).
  let screens = [];
  let ads = [];
  try {
    screens = await ScreenService.list();
  } catch (err) {
    console.error('[Upload] Failed to load screens:', err);
    showToast({ type: 'error', title: 'Could not load screens', message: 'Refresh the page to try again.' });
  }
  try {
    ads = await AdvertisementService.listAll();
  } catch (err) {
    console.error('[Upload] Failed to load advertisements:', err);
  }

  async function refreshScreensAndAds() {
    try {
      screens = await ScreenService.list();
      ads = await AdvertisementService.listAll();
    } catch (err) {
      console.error('[Upload] Failed to refresh screens/ads:', err);
      return;
    }
    updateScreenDropdown();
    if (state.screenId) {
      const screen = screens.find(s => s.id === state.screenId);
      if (screen) renderScreenInfo(screen);
    }
    updateSubmitState();
  }

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
      updateScreenDropdown();
    }
  });

  // Initialize liquid-glass dropdown for screens
  let screenDropdown = null;

  function updateScreenDropdown() {
    const screenListEl = qs('#screen-dropdown');
    if (!screens.length) {
      screenDropdown = null;
      screenListEl.innerHTML = `<div class="field-error-msg">No display screens are available right now. Please refresh or contact support.</div>`;
      return;
    }

    const options = screens.map(s => {
      const avail = slotAvailability(s, ads, state.duration || 1);
      const disabled = avail.full || s.activeState === 'disabled';
      return {
        value: s.id,
        label: `${s.id} — ${s.place}`,
        disabled,
        meta: { avail, status: s.status, place: s.place }
      };
    });

    if (screenDropdown) {
      screenDropdown.setOptions(options);
    } else {
      const container = qs('#screen-dropdown');
      screenDropdown = createLiquidDropdown({
        container,
        id: 'screen-dropdown',
        options,
        placeholder: 'Select a screen',
        onChange: (value, option) => {
          if (!option.disabled) {
            state.screenId = value;
            const screen = screens.find(s => s.id === value);
            if (screen) {
              renderScreenInfo(screen);
              renderBusinessField(screen);
              updateSubmitState();
            }
          }
        },
        renderOption: (opt) => `
          <div style="display:flex;flex-direction:column;gap:4px;width:100%;">
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
              <span style="font-weight:600;font-size:.875rem;">${escapeHTML(opt.value)} \u2014 ${escapeHTML(opt.meta.place)}</span>
              <span class="badge badge-${opt.meta.status === 'online' ? 'online' : 'offline'}" style="flex-shrink:0;font-size:0.65rem;">${opt.meta.status === 'online' ? 'Online' : 'Offline'}</span>
            </div>
            <span class="text-tertiary" style="font-size:.7rem;">${formatTime12h(opt.meta.avail.openTime)} \u2013 ${formatTime12h(opt.meta.avail.closeTime)} \u00b7 ${opt.meta.avail.full ? 'No Slots Available' : `${opt.meta.avail.remaining} slots left`}</span>
          </div>
        `
      });
    }
  }

  function renderScreenInfo(screen) {
    const avail = slotAvailability(screen, ads, state.duration || 10);
    const currentAds = ads.filter(a => a.screenId === screen.id && a.status === 'active').length;
    const live = screen.status === 'online' && screen.activeState === 'active';
    qs('#screen-selected-info').innerHTML = `
      <div class="glass-card" style="padding:16px;">
        <div class="flex items-center justify-between">
          <div style="font-weight:600;font-size:.875rem;">${screen.id} \u2014 ${screen.place}</div>
          <span class="badge badge-${live ? 'available' : 'offline'}">${live ? 'Live' : screen.status}</span>
        </div>
        <div class="text-tertiary" style="font-size:.75rem;margin-top:4px;">${formatTime12h(screen.openTime)} \u2013 ${formatTime12h(screen.closeTime)} operating window</div>
        <div class="grid grid-3 mt-4" style="gap:8px;">
          <div><div class="text-tertiary" style="font-size:.6875rem;text-transform:uppercase;">Remaining Slots</div><div style="font-weight:700;">${avail.remaining}</div></div>
          <div><div class="text-tertiary" style="font-size:.6875rem;text-transform:uppercase;">Used Slots</div><div style="font-weight:700;">${avail.used}</div></div>
          <div><div class="text-tertiary" style="font-size:.6875rem;text-transform:uppercase;">Max Slots</div><div style="font-weight:700;">${avail.max}</div></div>
          <div><div class="text-tertiary" style="font-size:.6875rem;text-transform:uppercase;">Current Ads</div><div style="font-weight:700;">${currentAds}</div></div>
          <div><div class="text-tertiary" style="font-size:.6875rem;text-transform:uppercase;">Today's Capacity</div><div style="font-weight:700;">${avail.max}</div></div>
          <div><div class="text-tertiary" style="font-size:.6875rem;text-transform:uppercase;">Live Status</div><div style="font-weight:700;color:${live ? 'var(--color-success)' : 'var(--color-text-tertiary)'};">${live ? 'Online' : 'Offline'}</div></div>
        </div>
        ${avail.full ? `<div class="field-error-msg mt-4">No Slots Available For Selected Screen</div>` : ''}
      </div>`;
  }

  // Debounced nearby-business search against /api/places/nearby, restricted
  // to the selected screen's registered location and radius (screen's
  // location is the primary source, not the advertiser's own GPS, per the
  // spec). Falls back to manual free-text entry - never hard-blocks the
  // whole upload flow - if the endpoint reports it isn't configured for
  // this screen/deployment yet (see PLACES_NOT_CONFIGURED /
  // SCREEN_LOCATION_NOT_CONFIGURED below).
  let businessSearchTimer = null;
  let businessSearchAvailable = true;

  function selectBusiness(name, id) {
    state.businessName = name;
    state.businessId = id || null;
    qs('#business-selected-info').innerHTML = `
      <div class="glass-card" style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-weight:600;font-size:.875rem;">${escapeHTML(name)}</span>
        <button type="button" class="btn btn-secondary" id="business-change-btn" style="padding:4px 12px;font-size:.75rem;">Change</button>
      </div>`;
    qs('#business-search-results').innerHTML = '';
    qs('#business-search-input').value = name;
    qs('#business-search-input').style.display = 'none';
    qs('#business-change-btn').addEventListener('click', () => {
      state.businessName = null;
      state.businessId = null;
      qs('#business-selected-info').innerHTML = '';
      qs('#business-search-input').style.display = '';
      qs('#business-search-input').value = '';
      qs('#business-search-input').focus();
      updateSubmitState();
    });
    updateSubmitState();
  }

  async function runBusinessSearch(screen, query) {
    const resultsEl = qs('#business-search-results');
    if (!businessSearchAvailable) return;
    resultsEl.innerHTML = `<div class="text-tertiary" style="font-size:.8125rem;">Searching\u2026</div>`;
    try {
      const res = await apiFetch(`/api/places/nearby?screenId=${encodeURIComponent(screen.id)}&query=${encodeURIComponent(query)}`);
      if (!res.results || res.results.length === 0) {
        resultsEl.innerHTML = `<div class="text-tertiary" style="font-size:.8125rem;">No nearby businesses matched \u201c${escapeHTML(query)}\u201d within range. You can still type the exact business name above and continue.</div>`;
        return;
      }
      resultsEl.innerHTML = res.results.map(r => `
        <button type="button" class="screen-target-option" style="width:100%;text-align:left;margin-bottom:6px;" data-business-id="${escapeHTML(r.id)}" data-business-name="${escapeHTML(r.name)}">
          <span class="target-label">${escapeHTML(r.name)}</span>
          <span class="target-desc">${r.distanceM != null ? (r.distanceM >= 1000 ? `${(r.distanceM / 1000).toFixed(1)} km` : `${r.distanceM} m`) : ''}${r.address ? ` \u00b7 ${escapeHTML(r.address)}` : ''}</span>
        </button>
      `).join('');
      qsa('[data-business-id]', resultsEl).forEach(btn => {
        btn.addEventListener('click', () => selectBusiness(btn.dataset.businessName, btn.dataset.businessId));
      });
    } catch (err) {
      // apiFetch() throws Error with the parsed JSON response attached as
      // err.body (see core/api.js) - the backend's error `code` lives at
      // err.body.code, not err.code directly.
      const code = err && err.body && err.body.code;
      if (code === 'PLACES_NOT_CONFIGURED' || code === 'SCREEN_LOCATION_NOT_CONFIGURED') {
        // Not an error state for the advertiser - just means this
        // deployment/screen doesn't have nearby search wired up yet. Fall
        // back to manual entry rather than showing a scary error or
        // blocking upload entirely.
        businessSearchAvailable = false;
        resultsEl.innerHTML = '';
        qs('#business-location-hint').textContent = 'Nearby business search is temporarily unavailable. Type your business name to continue.';
        return;
      }
      resultsEl.innerHTML = `<div class="field-error-msg">Nearby business search is temporarily unavailable. Type your business name to continue.</div>`;
    }
  }

  function renderBusinessField(screen) {
    const field = qs('#business-field');
    const input = qs('#business-search-input');
    field.style.display = '';
    input.disabled = false;
    qs('#business-location-hint').textContent = `Near ${screen.place}`;
    businessSearchAvailable = true;
    // Selecting a different screen invalidates whatever business was
    // chosen against the previous screen's location/radius.
    state.businessName = null;
    state.businessId = null;
    qs('#business-selected-info').innerHTML = '';
    input.value = '';
    input.style.display = '';
    qs('#business-search-results').innerHTML = '';

    input.oninput = () => {
      clearTimeout(businessSearchTimer);
      const query = input.value.trim();
      // Manually-typed name still counts as "selected" for gating/matching
      // purposes even before/without picking a search result, so upload
      // never gets permanently stuck if nearby search is unavailable.
      state.businessName = query || null;
      state.businessId = null;
      updateSubmitState();
      if (!query) { qs('#business-search-results').innerHTML = ''; return; }
      businessSearchTimer = setTimeout(() => runBusinessSearch(screen, query), 350);
    };
  }

  updateScreenDropdown();
  updateSubmitState();

  // Live updates: keep screen availability/slot counts current while the
  // advertiser is deciding, without a page reload.
  // Skip localEmit since local actions already refresh via click handlers
  watchLive({
    'ads.json': (data) => { if (!data?.localEmit) refreshScreensAndAds(); },
    'screens.json': (data) => { if (!data?.localEmit) refreshScreensAndAds(); }
  });

  // Submit
  qs('#submit-upload').addEventListener('click', async () => {
    if (!state.file || !state.screenId || !state.businessName) return;
    const btn = qs('#submit-upload');
    const statusEl = qs('#verification-status');
    btn.classList.add('btn-loading');
    btn.disabled = true;
    statusEl.style.display = '';
    statusEl.innerHTML = `<div class="glass-card" style="padding:12px 16px;font-size:.8125rem;">Verifying advertisement\u2026</div>`;

    const result = await AdvertisementService.upload({
      file: state.file,
      screenId: state.screenId,
      duration: state.duration,
      days: state.days,
      businessName: state.businessName,
      businessId: state.businessId
    });

    if (!result.ok) {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
      updateSubmitState();

      // Distinguish the verification-specific failure states (see
      // ad.controller.js upload()) from a generic upload error, per the
      // spec's required VERIFYING / VERIFIED / REJECTED UI states.
      if (result.code === 'BUSINESS_MISMATCH') {
        statusEl.innerHTML = `
          <div class="glass-card" style="padding:12px 16px;border-color:var(--color-danger);">
            <div style="font-weight:600;color:var(--color-danger);">\u2715 Advertisement verification failed</div>
            <div class="text-tertiary mt-4" style="font-size:.8125rem;">${escapeHTML(result.message || '')}</div>
            <div class="text-tertiary mt-4" style="font-size:.75rem;">Selected business: ${escapeHTML(result.body?.selectedBusiness || state.businessName)}</div>
          </div>`;
      } else if (result.code === 'CONTENT_REJECTED') {
        statusEl.innerHTML = `
          <div class="glass-card" style="padding:12px 16px;border-color:var(--color-danger);">
            <div style="font-weight:600;color:var(--color-danger);">\u2715 Advertisement verification failed</div>
            <div class="text-tertiary mt-4" style="font-size:.8125rem;">${escapeHTML(result.message || '')}</div>
          </div>`;
      } else if (result.code === 'VERIFICATION_UNAVAILABLE') {
        statusEl.innerHTML = `
          <div class="glass-card" style="padding:12px 16px;border-color:var(--color-warning);">
            <div style="font-weight:600;color:var(--color-warning);">Advertisement verification is temporarily unavailable.</div>
            <div class="text-tertiary mt-4" style="font-size:.8125rem;">Please try again.</div>
          </div>`;
      } else {
        statusEl.style.display = 'none';
        showToast({ type: 'error', title: 'Upload failed', message: result.message || 'Please try again.' });
      }
      return;
    }

    statusEl.innerHTML = `<div class="glass-card" style="padding:12px 16px;border-color:var(--color-success);"><div style="font-weight:600;color:var(--color-success);">\u2713 Advertisement verified</div></div>`;

    showToast({ type: 'success', title: 'Advertisement is live', message: 'It is already showing on the selected screen.' });
    setTimeout(() => { window.location.href = '/history'; }, 900);
  });
})();

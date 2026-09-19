import { apiFetch } from './api.js';

let cached = null;

/** Fetch platform settings (pricing, durations, limits, etc). Cached per page load. */
export async function getSettings({ force = false } = {}) {
  if (cached && !force) return cached;
  const res = await apiFetch('/api/settings');
  cached = res.settings;
  return cached;
}

export async function updatePricing(payload) {
  try {
    const res = await apiFetch('/api/settings', { method: 'PUT', body: payload });
    cached = res.settings;
    return { ok: true, settings: res.settings };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

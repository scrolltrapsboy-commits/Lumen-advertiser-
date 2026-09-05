import { apiFetch, apiUpload } from '../core/api.js';

export const AdvertisementService = {
  async listAll() {
    const res = await apiFetch('/api/ads');
    return res.ads;
  },
  async listByUser(userId) {
    const all = await this.listAll();
    return all.filter(ad => ad.userId === userId);
  },
  async listByScreen(screenId) {
    const all = await this.listAll();
    return all.filter(ad => ad.screenId === screenId);
  },
  /** Uploads a new advertisement. `file` is a File object; screenId/duration/days describe the campaign. businessName/businessId are advertiser-flow-only (see upload.js) - omitted entirely for Admin uploads, which never go through business verification. */
  async upload({ file, screenId, duration, days, businessName, businessId }) {
    const formData = new FormData();
    formData.append('file', file);
    // FormData values are coerced to strings. Appending an array directly
    // (e.g. from Admin's multi-screen targeting) would silently collapse it
    // via Array.prototype.toString() into a single comma-joined string like
    // "SCREEN001,SCREEN002", which the backend would then treat as one
    // malformed screen ID instead of two real ones. JSON-encode arrays so
    // the backend can parse them back into a real list.
    formData.append('screenId', Array.isArray(screenId) ? JSON.stringify(screenId) : screenId);
    formData.append('duration', duration);
    formData.append('days', days);
    if (businessName) formData.append('businessName', businessName);
    if (businessId) formData.append('businessId', businessId);
    try {
      const res = await apiUpload('/api/upload', formData);
      return { ok: true, ad: res.ad };
    } catch (err) {
      // Preserve the backend's structured error (code, selectedBusiness,
      // confidence - see ad.controller.js upload()) so the caller can show
      // the right verification-failure state instead of a generic message.
      return { ok: false, message: err.message, code: err.body && err.body.code, body: err.body };
    }
  },
  async setStatus(id, status) {
    try {
      const res = await apiFetch(`/api/ads/${id}/status`, { method: 'PUT', body: { status } });
      return { ok: true, ad: res.ad };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  },
  async remove(id) {
    try {
      await apiFetch(`/api/ads/${id}`, { method: 'DELETE' });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  },
  async renew(id, additionalDays = 7) {
    try {
      const res = await apiFetch(`/api/ads/${id}/renew`, { method: 'PUT', body: { days: additionalDays } });
      return { ok: true, ad: res.ad };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  },
  async duplicate(id) {
    try {
      const res = await apiFetch(`/api/ads/${id}/duplicate`, { method: 'POST' });
      return { ok: true, ad: res.ad };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  },
  async updateDuration(id, duration) {
    try {
      const res = await apiFetch(`/api/ads/${id}/duration`, { method: 'PUT', body: { duration } });
      return { ok: true, ad: res.ad };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
};

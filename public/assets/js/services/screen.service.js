import { apiFetch } from '../core/api.js';

export const ScreenService = {
  async list() {
    const res = await apiFetch('/api/screens');
    return res.screens;
  },
  async get(id) {
    try {
      const res = await apiFetch(`/api/screens/${id}`);
      return res.screen;
    } catch (err) {
      return null;
    }
  },
  async create(payload) {
    try {
      const res = await apiFetch('/api/screens', { method: 'POST', body: payload });
      return { ok: true, screen: res.screen };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  },
  async update(id, patch) {
    try {
      const res = await apiFetch(`/api/screens/${id}`, { method: 'PUT', body: patch });
      return { ok: true, screen: res.screen };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  },
  async remove(id) {
    try {
      await apiFetch(`/api/screens/${id}`, { method: 'DELETE' });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
};

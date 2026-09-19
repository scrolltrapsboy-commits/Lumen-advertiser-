import { apiFetch } from '../core/api.js';

export const UserService = {
  async list() {
    const res = await apiFetch('/api/users');
    return res.users;
  },
  async remove(id) {
    try {
      await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
};

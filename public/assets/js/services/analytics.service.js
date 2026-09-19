import { apiFetch } from '../core/api.js';

export const AnalyticsService = {
  async summary() {
    const res = await apiFetch('/api/analytics');
    return res.analytics;
  }
};

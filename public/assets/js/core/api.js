import { emitLiveChange } from './live.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function parseResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  let body = null;
  if (contentType.includes('application/json')) {
    body = await res.json().catch(() => null);
  }
  if (!res.ok) {
    const message = (body && body.message) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function notifyMutation(path) {
  if (path.includes('/ads') || path.includes('/upload')) {
    emitLiveChange('ads.json');
    emitLiveChange('analytics.json');
  } else if (path.includes('/screens')) {
    emitLiveChange('screens.json');
    emitLiveChange('analytics.json');
  } else if (path.includes('/users')) {
    emitLiveChange('users.json');
    emitLiveChange('analytics.json');
  } else if (path.includes('/settings')) {
    emitLiveChange('settings.json');
  }
}

/** JSON request helper. Always sends/receives credentials for session cookies. */
export async function apiFetch(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { ...JSON_HEADERS, ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await parseResponse(res);
  if (method.toUpperCase() !== 'GET') {
    notifyMutation(path);
  }
  return data;
}

/** Multipart upload helper (does not set Content-Type so the browser adds the boundary). */
export async function apiUpload(path, formData) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
  const data = await parseResponse(res);
  notifyMutation(path);
  return data;
}

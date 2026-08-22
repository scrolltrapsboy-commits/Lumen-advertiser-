import { apiFetch } from './api.js';

let cachedSession;
let cachedPromise = null;

/** Fetch (and lightly cache within the page lifecycle) the current session user, or null. */
export async function getSession({ force = false } = {}) {
  if (!force && cachedSession !== undefined) return cachedSession;
  if (!cachedPromise) {
    cachedPromise = apiFetch('/api/auth/session')
      .then((res) => {
        cachedSession = res.user || null;
        cachedPromise = null;
        return cachedSession;
      })
      .catch(() => {
        cachedSession = null;
        cachedPromise = null;
        return null;
      });
  }
  return cachedPromise;
}

function invalidateSession() {
  cachedSession = undefined;
  cachedPromise = null;
}

export async function isAuthenticated() {
  return !!(await getSession());
}

export async function login(email, password) {
  try {
    const result = await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } });
    invalidateSession();
    return { ok: true, role: result.role, redirect: result.redirect };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export async function signup({ name, email, password }) {
  try {
    const result = await apiFetch('/api/auth/signup', { method: 'POST', body: { name, email, password } });
    invalidateSession();
    return { ok: true, redirect: result.redirect };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export async function resetPassword(email, newPassword) {
  try {
    await apiFetch('/api/auth/reset-password', { method: 'POST', body: { email, password: newPassword } });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export async function updateProfileName(name) {
  try {
    const result = await apiFetch('/api/auth/profile', { method: 'PUT', body: { name } });
    invalidateSession();
    return { ok: true, user: result.user };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    invalidateSession();
    window.location.href = '/login';
  }
}

/** Guard a page. role: 'admin' | 'advertiser' | null (any authenticated user). Resolves to the session or null (already redirected). */
export async function requireAuth(role = null) {
  const session = await getSession();
  if (!session) {
    window.location.href = '/login';
    return null;
  }
  if (role && session.role !== role) {
    window.location.href = session.role === 'admin' ? '/admin' : '/dashboard';
    return null;
  }
  return session;
}

export async function redirectIfAuthenticated() {
  const session = await getSession();
  if (session) {
    window.location.href = session.role === 'admin' ? '/admin' : '/dashboard';
  }
}

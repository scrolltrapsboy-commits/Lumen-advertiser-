/**
 * Real-time event bus and live state watcher.
 *
 * 1. `emitLiveChange(key)`: Triggers local registered handlers immediately (0ms)
 *    when a user performs a local action via fetch/AJAX.
 * 2. `watchLive(handlers, { intervalMs = 1000 })`: Polls GET /api/meta on a low-overhead
 *    interval using fetch + async/await, firing per-resource callbacks only when a version stamp
 *    actually changes. This keeps every page "live" across tabs & devices without
 *    reloading or recreating the DOM unnecessarily.
 */

const liveBus = new EventTarget();

export function emitLiveChange(key, metaData = {}) {
  liveBus.dispatchEvent(new CustomEvent(`live:${key}`, { detail: metaData }));
}

export function watchLive(handlers, { intervalMs = 1000 } = {}) {
  let lastVersions = null;
  let timer = null;
  let controller = null;
  let stopped = false;
  let backoff = intervalMs;

  // 1. Instantly handle local mutations via liveBus
  const localListeners = [];
  Object.keys(handlers).forEach(key => {
    const listener = (e) => {
      if (!stopped && handlers[key]) {
        handlers[key]({ versions: lastVersions || {}, localEmit: true, detail: e.detail });
      }
    };
    liveBus.addEventListener(`live:${key}`, listener);
    localListeners.push({ key, listener });
  });

  // 2. Poll server for version stamp updates from other tabs/users
  async function tick() {
    if (stopped) return;
    controller = new AbortController();
    try {
      const res = await fetch('/api/meta', { credentials: 'include', signal: controller.signal });
      if (!res.ok) throw new Error('meta request failed');
      const body = await res.json();
      backoff = intervalMs;

      if (lastVersions) {
        Object.keys(body.versions || {}).forEach(key => {
          if (body.versions[key] !== lastVersions[key] && handlers[key]) {
            handlers[key](body);
          }
        });
      }
      lastVersions = body.versions;
    } catch (err) {
      if (err.name !== 'AbortError') {
        backoff = Math.min(backoff * 1.5, 10000);
      }
    } finally {
      if (!stopped) timer = setTimeout(tick, backoff);
    }
  }

  tick();

  return function stop() {
    stopped = true;
    clearTimeout(timer);
    if (controller) controller.abort();
    localListeners.forEach(({ key, listener }) => {
      liveBus.removeEventListener(`live:${key}`, listener);
    });
  };
}

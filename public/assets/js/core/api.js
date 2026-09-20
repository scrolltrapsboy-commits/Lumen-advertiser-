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

/**
 * ONE source of truth for how long a single advertisement upload (the
 * whole multipart request: transfer + server-side processing + response)
 * may take before the client gives up. Videos are the reason this is
 * generous: a 100-500MB upload on a ordinary connection takes minutes,
 * and a client-side timeout shorter than the real transfer time makes
 * the browser abandon an upload the server would happily finish. Keep
 * in sync with the server's own request timeout (REQUEST_TIMEOUT_MS in
 * server.js), which must always be >= this value.
 */
export const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** Multipart upload helper (does not set Content-Type so the browser adds the boundary).
 *
 * Uses XHR rather than fetch because fetch can neither carry an upload
 * timeout nor report upload progress. The promise resolves ONLY on the
 * server's real response - never earlier - so the UI can never claim
 * success while bytes are still in flight.
 *
 * @param {string} path
 * @param {FormData} formData
 * @param {{ onProgress?: (info: {percent:number|null, loaded:number, total:number}) => void, timeoutMs?: number }} [opts]
 *   onProgress fires with real byte progress while the body is being
 *   sent (percent is null if the total size is unknown), and stops once
 *   the transfer completes (the remaining server-processing time is
 *   covered by the same timeout, not fabricated progress).
 */
export function apiUpload(path, formData, opts = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.timeout = opts.timeoutMs || UPLOAD_TIMEOUT_MS;
    xhr.responseType = 'json';
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!opts.onProgress) return;
      const total = event.lengthComputable ? event.total : 0;
      opts.onProgress({
        percent: total ? Math.round((event.loaded / total) * 100) : null,
        loaded: event.loaded,
        total
      });
    };

    xhr.onload = async () => {
      let body = null;
      if (xhr.responseType === 'json' && xhr.response !== null) {
        body = xhr.response;
      } else {
        try { body = JSON.parse(xhr.responseText); } catch (e) { body = null; }
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const err = new Error((body && body.message) || `Request failed (${xhr.status})`);
        err.status = xhr.status;
        err.body = body;
        reject(err);
        return;
      }
      notifyMutation(path);
      resolve(body);
    };

    // A genuinely elapsed timeout means the request was aborted
    // client-side - report that honestly (the server may still complete
    // it, so the UI must NOT say "uploaded", it must say "timed out").
    xhr.ontimeout = () => {
      const err = new Error('Upload timed out. Your connection may be too slow for this file - try a smaller file or a faster network.');
      err.status = 0;
      err.code = 'UPLOAD_TIMEOUT';
      reject(err);
    };
    xhr.onerror = () => {
      const err = new Error('Network error while uploading. Please check your connection and try again.');
      err.status = 0;
      err.code = 'UPLOAD_NETWORK_ERROR';
      reject(err);
    };
    xhr.onabort = () => {
      const err = new Error('Upload cancelled.');
      err.status = 0;
      err.code = 'UPLOAD_ABORTED';
      reject(err);
    };

    xhr.send(formData);
  });
}

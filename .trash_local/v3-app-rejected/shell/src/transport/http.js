/**
 * HTTP transport adapter. Used when `transport=wifi` (phone → OPi5 directly).
 *
 * Sprint 1 scope: GET / POST against the Flask backend, JSON in/out.
 * Sprint 2 will add WebSocket subscriptions and the cache-class layer.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 * @param {object} [opts]
 * @returns {Promise<any>}
 */
export async function request(method, path, body, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout_ms ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} on ${method} ${path}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  } finally {
    clearTimeout(t);
  }
}

export const http = {
  get:  (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put:  (path, body, opts) => request('PUT', path, body, opts),
  del:  (path, opts) => request('DELETE', path, undefined, opts),
};

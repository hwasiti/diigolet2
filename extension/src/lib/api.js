// Diigo "chappai" client for the service worker. Speaks the toolbar dialect (ct=tb: a form POST answered with
// plain JSON) to www.diigo.com, which was verified to accept it with the browser's diigo.com cookies. Every call
// has a timeout and turns transport/format problems into DiigoError so callers can never hang.
import { payloads, PRIVACY, PROTOCOL_VERSION } from '../../../src/bookmarklet/diigo.js';

export const SERVER = 'https://www.diigo.com';
export { PRIVACY };

export class DiigoError extends Error {
  constructor(kind, message, detail) { super(message); this.kind = kind; this.detail = detail; }
}

export function apiUrl(cmd, user, clientVersion) {
  return SERVER + '/chappai/pv=' + PROTOCOL_VERSION + '/ct=tb/cv=' + encodeURIComponent(clientVersion) + '/user=' + encodeURIComponent(user || '') + '/cmd=' + encodeURIComponent(cmd) + '/';
}

export function formBody(cmd, payload, user, transId) {
  return new URLSearchParams({ cmd, v: String(PROTOCOL_VERSION), _nocache: String(Math.random()), json: JSON.stringify(payload), user: user || '', transId: String(transId) });
}

/** Parse a chappai reply: plain JSON, or the JSONP wrapper the `let` dialect uses. */
export function parseReply(text) {
  const t = String(text).trim();
  const m = /^[\w$.]+\(([\s\S]*)\)\s*;?$/.exec(t);
  return JSON.parse(m ? m[1] : t);
}

/**
 * createClient({ clientVersion, fetchImpl, timeoutMs }) -> { call, load, add, del, saveWith }
 * `call` resolves with the parsed reply {code, user, result, ...} or rejects with a DiigoError of kind
 * network | timeout | http | badjson. A reply with code !== 1 is returned as is; callers decide.
 */
export function createClient({ clientVersion = '0', fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  let seq = 0;
  async function call(cmd, payload, user) {
    const transId = ++seq;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetchImpl(apiUrl(cmd, user, clientVersion), {
        method: 'POST', body: formBody(cmd, payload, user, transId), credentials: 'include', signal: ctl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (e) {
      const aborted = e && e.name === 'AbortError';
      throw new DiigoError(aborted ? 'timeout' : 'network', aborted ? 'Diigo did not answer in time' : 'Could not reach Diigo', String(e));
    } finally { clearTimeout(timer); }
    if (!resp.ok) throw new DiigoError('http', 'Diigo answered HTTP ' + resp.status, resp.status);
    const text = await resp.text();
    let data;
    try { data = parseReply(text); } catch { throw new DiigoError('badjson', 'Diigo did not answer with JSON', text.slice(0, 200)); }
    if (!data || typeof data !== 'object') throw new DiigoError('badjson', 'Diigo did not answer with JSON', text.slice(0, 200));
    return data;
  }
  return {
    call,
    /** Bookmark state, signed-in user and annotations of a URL. */
    load: (url, user) => call('bm_loadBookmark', payloads.load(url), user),
    /** Add a text highlight to an existing bookmark (a = {id, content, extra}). */
    add: (urlId, a, user) => call('annotation_add', payloads.add(urlId, a), user),
    del: (urlId, id, user) => call('annotation_delete', payloads.del(urlId, id), user),
    /** Create the bookmark together with its first highlight. */
    saveWith: (url, title, a, mode, user) => call('bm_saveBookmark', payloads.saveWith(url, title, a, mode), user),
  };
}

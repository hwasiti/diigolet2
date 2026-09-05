// Diigo "chappai" protocol as spoken by the original Diigolet bookmarklet (ct=let) on www.diigo.com.
// Responses are JSONP wrapped in diigolet.callback({...}) with {code, user, result, cmd, transId}.
export const PROTOCOL_VERSION = 13;
export const CLIENT_VERSION = '5.0b7';
export const DATA_SERVER = 'https://www.diigo.com';
export const PRIVACY = { PUBLIC: 0, PRIVATE: 2 };
export const TYPE_TEXT = 0;

export function jsonpUrl(cmd, payload, user, transId) {
  const q = new URLSearchParams({
    cmd, v: String(PROTOCOL_VERSION), _nocache: String(Math.random()),
    json: JSON.stringify(payload), user: user || '', transId: String(transId),
  });
  return `${DATA_SERVER}/chappai/pv=${PROTOCOL_VERSION}/ct=let/cv=${CLIENT_VERSION}/user=${encodeURIComponent(user || '')}/cmd=${cmd}/?${q}`;
}

/** Diigo's highlight id: MD5(content + user + urlId + nth). */
export const annotationId = (md5, content, user, urlId, nth) => md5(content + user + urlId + nth);

/** The server's urlId is MD5 of the URL; a bare origin is hashed without its trailing slash. */
export function urlIdFor(md5, url) {
  let u = url;
  try {
    const p = new URL(url);
    if (p.pathname === '/' && !p.search) u = url.replace(/\/$/, '');
  } catch { /* hash as given */ }
  return md5(u);
}

export const payloads = {
  load: (url) => ({ url, what: 'bookmarkInfo annotations pageComments' }),
  add: (urlId, a) => ({ urlId, id: a.id, content: a.content, type: TYPE_TEXT, extra: a.extra, groups: [] }),
  del: (urlId, id) => ({ urlId, id }),
  saveWith: (url, title, a, mode = PRIVACY.PRIVATE) => ({
    url, mode, title, tags: '', description: '', unread: false,
    annotation: { id: a.id, content: a.content, type: TYPE_TEXT, extra: a.extra },
  }),
};

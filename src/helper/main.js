// Diigolet 2 helper: the brain. Runs on our own origin (GitHub Pages) as a hidden frame or a popup opened by
// the bookmarklet, talks to Diigo with JSONP (carrying the visitor's own diigo.com cookies) and holds every
// piece of Diigo logic, so the bookmark itself stays tiny and this file can be updated without reinstalling.
//
// Security model: origin-bound. Every request names the page URL it concerns; the helper only proceeds when
// that URL belongs to the origin that sent the message, and it derives urlIds from its own Diigo replies. A
// hostile page embedding this helper can therefore only touch highlights on its own pages, which Diigo's public
// JSONP endpoint already allows any page to do. Nothing is stored.
import { md5 } from '../bookmarklet/md5.js';
import { canonicalUrl } from '../bookmarklet/url.js';
import { payloads, annotationId, PRIVACY } from '../bookmarklet/diigo.js';
import { stripWs } from '../bookmarklet/text.js';
import { contentFor, nthFor, locate } from './anchor.js';

const PV = 13, CV = '5.0b7', SERVER = 'https://www.diigo.com';
let seq = 0;
const pending = new Map();
const pages = new Map(); // canonical URL -> { urlId, saved, user, title }

window.diigolet = {
  callback(resp) {
    const key = String(resp && resp.transId);
    const p = pending.get(key);
    if (!p) return;
    pending.delete(key);
    clearTimeout(p.timer);
    p.script.remove();
    p.resolve(resp);
  },
};

function jsonp(cmd, payload, user) {
  return new Promise((resolve, reject) => {
    const transId = String(++seq);
    const q = new URLSearchParams({ cmd, v: String(PV), _nocache: String(Math.random()), json: JSON.stringify(payload), user: user || '', transId });
    const s = document.createElement('script');
    s.src = `${SERVER}/chappai/pv=${PV}/ct=let/cv=${CV}/user=${encodeURIComponent(user || '')}/cmd=${cmd}/?${q}`;
    const timer = setTimeout(() => { pending.delete(transId); s.remove(); reject('timeout'); }, 20000);
    s.onerror = () => { clearTimeout(timer); pending.delete(transId); s.remove(); reject('network'); };
    pending.set(transId, { resolve, reject, timer, script: s });
    document.head.appendChild(s);
  });
}

const sameOrigin = (url, origin) => { try { return new URL(url).origin === origin; } catch { return false; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function pageState(m) {
  const url = canonicalUrl(m.url);
  let st = pages.get(url);
  if (!st) pages.set(url, (st = { url, alt: m.url.replace(/#.*$/, ''), urlId: null, saved: false, user: null, known: false, title: m.title || url }));
  if (m.title) st.title = m.title;
  return st;
}

/** Ask Diigo about the page: bookmark state, signed-in user and its highlights (from the exact URL too). */
async function load(st) {
  const resp = await jsonp('bm_loadBookmark', payloads.load(st.url), st.user);
  if (resp.code !== 1 || !resp.result) throw 'Diigo refused';
  st.user = resp.user || null;
  st.urlId = resp.result.urlId;
  st.saved = !!resp.result.saved;
  st.known = true;
  if (resp.result.bookmarkInfo && resp.result.bookmarkInfo.title) st.title = resp.result.bookmarkInfo.title;
  const anns = (resp.result.annotations || []).filter((a) => a.type === 0);
  if (st.alt !== st.url) {
    try {
      const r2 = await jsonp('bm_loadBookmark', payloads.load(st.alt), st.user);
      if (r2.code === 1 && r2.result) for (const a of r2.result.annotations || []) if (a.type === 0 && !anns.some((x) => x.id === a.id)) anns.push(a);
    } catch { /* best effort */ }
  }
  return { user: st.user, urlId: st.urlId, saved: st.saved, anns };
}

/** Load, then place each highlight in the page's text T: {id, s, e, color}; unlocatable ones are left out. */
async function loadInto(st, T) {
  const r = await load(st);
  const anns = [];
  for (const a of r.anns) {
    const at = locate(a.content, T, (a.extra && a.extra.nth) || 1);
    if (at) anns.push({ id: a.id, s: at.s, e: at.e, color: (a.extra && a.extra.color) || 'yellow' });
  }
  return { user: r.user, anns };
}

/** Save a new highlight from the page's raw selection text, the end-node prefix length x and body text T. */
async function add(st, m) {
  if (!st.known) await load(st);
  if (!st.user) throw 'Sign in to Diigo';
  const content = contentFor(m.raw), nth = nthFor(stripWs(m.raw), m.T, m.x);
  const a = { id: annotationId(md5, content, st.user, st.urlId, nth), content, extra: { nth, color: m.color, top: m.top, left: m.left } };
  // Re-saving an existing bookmark wipes its tags, so bm_saveBookmark is used only when Diigo said "unsaved".
  const first = !st.saved;
  const resp = first
    ? await jsonp('bm_saveBookmark', payloads.saveWith(st.url, st.title, a, PRIVACY.PRIVATE), st.user)
    : await jsonp('annotation_add', payloads.add(st.urlId, a), st.user);
  if (resp.user === null) { st.user = null; throw 'Sign in to Diigo'; }
  if (resp.code !== 1) throw 'Diigo refused';
  st.saved = true;
  if (resp.result && resp.result.urlId) st.urlId = resp.result.urlId;
  return { id: a.id, nth };
}

async function del(st, m) {
  if (!st.known) await load(st);
  const resp = await jsonp('annotation_delete', payloads.del(st.urlId, m.id), st.user);
  if (resp.code !== 1) throw 'Diigo refused';
  // Diigo answers "success" to deletes it does not perform on some bookmarks: check.
  await wait(1200);
  const check = await jsonp('bm_loadBookmark', payloads.load(st.url), st.user);
  const kept = !!(check.result && (check.result.annotations || []).some((x) => x.id === m.id));
  return { ok: true, kept };
}

const status = document.getElementById('status');
const say = (t) => { if (status) status.textContent = t; };

window.addEventListener('message', async (ev) => {
  const m = ev.data;
  if (!m || m.t !== 'dl2' || !ev.source) return;
  // Answer whoever hails us: an existing helper window may be adopted by a page that did not open it.
  if (m.hello) { ev.source.postMessage({ t: 'dl2', ready: true }, ev.origin); return; }
  if (m.bye) { say('Done. Closing…'); setTimeout(() => window.close(), 150); return; }
  if (!m.id || m.v !== 3) return;
  const reply = (r) => ev.source.postMessage(Object.assign({ t: 'dl2', id: m.id }, r), ev.origin);
  if (!/^https?:\/\//.test(ev.origin) || typeof m.url !== 'string' || !sameOrigin(m.url, ev.origin)) return reply({ ok: false, e: 'Forbidden' });
  const st = pageState(m);
  const text = typeof m.T === 'string' && m.T.length <= 4e6;
  try {
    let r;
    if (m.cmd === 'load' && text) r = await loadInto(st, m.T);
    else if (m.cmd === 'add' && text && typeof m.raw === 'string' && m.raw.length <= 4000 && Number.isInteger(m.x)) r = await add(st, m);
    else if (m.cmd === 'del' && typeof m.ann === 'string') r = await del(st, { id: m.ann });
    else return reply({ ok: false, e: 'Bad request' });
    say(st.user ? 'Connected to Diigo as ' + st.user : 'Diigo did not recognise a signed-in user');
    reply({ ok: true, r });
  } catch (e) {
    say('Diigo request failed: ' + e);
    reply({ ok: false, e: String(e) });
  }
});

const owner = window.opener || (window.parent !== window ? window.parent : null);
if (owner) {
  owner.postMessage({ t: 'dl2', ready: true }, '*');
  say(window.parent !== window ? 'Ready.' : 'Talking to Diigo… This window closes itself on phones; on desktop, leave it open while highlighting.');
} else {
  say('This window could not connect back to the page (the site isolates popups). You can close it.');
}

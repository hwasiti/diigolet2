// Diigolet 2 service worker. Rules that the official extension breaks, kept here on purpose:
//  - every listener is registered synchronously at top level, so the event that wakes the worker is never lost;
//  - nothing that matters lives in worker globals: sign-in state and per-tab page state sit in
//    chrome.storage.session and are recomputed on demand;
//  - every message gets a reply, every Diigo call has a timeout, and a Diigo reply that names no user marks the
//    session as expired instead of being ignored.
import { createClient, DiigoError, PRIVACY } from './lib/api.js';
import { LOGIN_COOKIE, COOKIE_URL, userFromCookieValue, isLoginCookieChange, isHighlightablePage } from './lib/auth.js';
import { canonicalUrl } from '../../src/bookmarklet/url.js';
import { md5 } from '../../src/bookmarklet/md5.js';
import { annotationId } from '../../src/bookmarklet/diigo.js';

const VERSION = __VERSION__;
const SIGN_IN_URL = 'https://www.diigo.com/sign-in';
const SIGN_OUT_URL = 'https://www.diigo.com/sign-out';
const DEFAULT_PREFS = { autoload: true, color: 'yellow', privateDefault: true };
const api = createClient({ clientVersion: VERSION });
const session = chrome.storage.session;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- preferences (synced) ---------------------------------------------------------------------------------
async function getPrefs() {
  const { prefs } = await chrome.storage.sync.get('prefs');
  return { ...DEFAULT_PREFS, ...(prefs || {}) };
}
async function setPrefs(patch) {
  const prefs = { ...(await getPrefs()), ...patch };
  await chrome.storage.sync.set({ prefs });
  broadcast({ t: 'prefs-changed', prefs });
  return prefs;
}

// ---- sign-in state ---------------------------------------------------------------------------------------
// auth = { user: name from the cookie or null, stale: Diigo answered "no user" although the cookie exists }
async function readCookieUser() {
  try {
    const c = await chrome.cookies.get({ url: COOKIE_URL, name: LOGIN_COOKIE });
    return c ? userFromCookieValue(c.value) : null;
  } catch { return null; }
}
async function getAuth(refresh = false) {
  const { auth } = await session.get('auth');
  if (auth && !refresh) return auth;
  const user = await readCookieUser();
  const next = { user, stale: auth && auth.user === user ? !!auth.stale : false, signedIn: !!user && !(auth && auth.user === user && auth.stale) };
  await session.set({ auth: next });
  return next;
}
async function markStale() {
  const auth = await getAuth();
  if (!auth.user) return auth;
  const next = { ...auth, stale: true, signedIn: false };
  await session.set({ auth: next });
  await authChanged(next);
  return next;
}
async function authChanged(auth) {
  await setIcon(auth.signedIn);
  broadcast({ t: 'auth-changed', auth });
  if (auth.signedIn) {
    // Bring the page the user was on back to the front once the sign-in tab did its job.
    const { signinFrom } = await session.get('signinFrom');
    if (signinFrom) { await session.remove('signinFrom'); try { await chrome.tabs.update(signinFrom, { active: true }); } catch { /* tab gone */ } }
  } else {
    const all = await session.get(null);
    await session.remove(Object.keys(all).filter((k) => k.startsWith('tab:')));
    for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) badge(tab.id, '');
  }
}
async function setIcon(signedIn) {
  const p = (s) => `icons/icon-${signedIn ? '' : 'off-'}${s}.png`;
  try { await chrome.action.setIcon({ path: { 16: p(16), 32: p(32) } }); } catch { /* ignore */ }
}
function broadcast(msg) {
  chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).then((tabs) => { for (const t of tabs) chrome.tabs.sendMessage(t.id, msg).catch(() => {}); });
  chrome.runtime.sendMessage(msg).catch(() => {}); // popup / options, if open
}
function badge(tabId, text, color = '#1f5fbf') {
  chrome.action.setBadgeText({ tabId, text: String(text) }).catch(() => {});
  if (text) chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

// ---- per-tab page state ----------------------------------------------------------------------------------
// tab:<id> = { url (canonical), exact, urlId, saved, title, known, count }
const key = (tabId) => 'tab:' + tabId;
async function pageState(tabId, url, title) {
  const canon = canonicalUrl(url);
  const cur = (await session.get(key(tabId)))[key(tabId)];
  if (cur && cur.url === canon) { if (title) cur.title = title; return cur; }
  return { url: canon, exact: url.replace(/#.*$/, ''), urlId: null, saved: false, title: title || canon, known: false, count: 0 };
}
const savePage = (tabId, st) => session.set({ [key(tabId)]: st });

/** Ask Diigo about the page. Answers {user, saved, anns} and records the urlId. */
async function loadPage(tabId, st) {
  const auth = await getAuth();
  const resp = await api.load(st.url, auth.user);
  if (resp.code !== 1 || !resp.result) throw new DiigoError('refused', 'Diigo refused to load the page');
  if (!resp.user) { await markStale(); throw new DiigoError('signin', 'Sign in to Diigo'); }
  st.urlId = resp.result.urlId;
  st.saved = !!resp.result.saved;
  st.known = true;
  if (resp.result.bookmarkInfo && resp.result.bookmarkInfo.title) st.title = resp.result.bookmarkInfo.title;
  const anns = (resp.result.annotations || []).filter((a) => a.type === 0);
  if (st.exact !== st.url) {
    try {
      const r2 = await api.load(st.exact, auth.user);
      if (r2.code === 1 && r2.result) for (const a of r2.result.annotations || []) if (a.type === 0 && !anns.some((x) => x.id === a.id)) anns.push(a);
    } catch { /* best effort */ }
  }
  st.count = anns.length;
  await savePage(tabId, st);
  badge(tabId, anns.length ? anns.length : '');
  return {
    user: resp.user, saved: st.saved,
    anns: anns.map((a) => ({ id: a.id, content: a.content, nth: (a.extra && a.extra.nth) || 1, color: (a.extra && a.extra.color) || 'yellow', user: a.user || null, mine: !a.user || a.user === resp.user })),
  };
}

async function addHighlight(tabId, st, m) {
  if (!st.known) await loadPage(tabId, st);
  const auth = await getAuth();
  if (!auth.signedIn) throw new DiigoError('signin', 'Sign in to Diigo');
  const prefs = await getPrefs();
  const a = { id: annotationId(md5, m.content, auth.user, st.urlId, m.nth), content: m.content, extra: { nth: m.nth, color: m.color, top: m.top | 0, left: m.left | 0 } };
  // Re-saving an existing bookmark wipes its tags, so bm_saveBookmark is only used when Diigo said "unsaved".
  const resp = st.saved
    ? await api.add(st.urlId, a, auth.user)
    : await api.saveWith(st.url, st.title, a, prefs.privateDefault ? PRIVACY.PRIVATE : PRIVACY.PUBLIC, auth.user);
  if (resp.user === null) { await markStale(); throw new DiigoError('signin', 'Sign in to Diigo'); }
  if (resp.code !== 1) throw new DiigoError('refused', 'Diigo refused the highlight');
  st.saved = true;
  if (resp.result && resp.result.urlId) st.urlId = resp.result.urlId;
  st.count++;
  await savePage(tabId, st);
  badge(tabId, st.count);
  return { id: a.id };
}

async function deleteHighlight(tabId, st, id) {
  if (!st.known) await loadPage(tabId, st);
  const auth = await getAuth();
  const resp = await api.del(st.urlId, id, auth.user);
  if (resp.code !== 1) throw new DiigoError('refused', 'Diigo refused to remove the highlight');
  // Diigo answers "success" to deletes it does not perform on some bookmarks: check.
  await wait(1200);
  const check = await api.load(st.url, auth.user);
  const kept = !!(check.result && (check.result.annotations || []).some((x) => x.id === id));
  if (!kept) { st.count = Math.max(0, st.count - 1); await savePage(tabId, st); badge(tabId, st.count || ''); }
  return { kept };
}

// ---- message router ---------------------------------------------------------------------------------------
async function handle(m, sender) {
  const tab = sender.tab;
  const tabId = tab ? tab.id : m.tabId;
  const url = (tab && tab.url) || sender.url || m.url;
  switch (m.t) {
    case 'auth': return getAuth(m.refresh);
    case 'prefs': return getPrefs();
    case 'set-prefs': return setPrefs(m.prefs || {});
    case 'version': return { version: VERSION };
    case 'load': {
      if (!isHighlightablePage(url)) throw new DiigoError('page', 'Not a web page');
      const auth = await getAuth();
      if (!auth.signedIn) return { user: null, saved: false, anns: [], signedIn: false, stale: auth.stale };
      const st = await pageState(tabId, url, m.title);
      return { ...(await loadPage(tabId, st)), signedIn: true };
    }
    case 'add': {
      if (!isHighlightablePage(url)) throw new DiigoError('page', 'Not a web page');
      if (typeof m.content !== 'string' || !m.content || m.content.length > 20000 || !Number.isInteger(m.nth)) throw new DiigoError('bad', 'Bad highlight');
      const st = await pageState(tabId, url, m.title);
      return addHighlight(tabId, st, m);
    }
    case 'del': {
      if (typeof m.id !== 'string') throw new DiigoError('bad', 'Bad request');
      const st = await pageState(tabId, url, m.title);
      return deleteHighlight(tabId, st, m.id);
    }
    case 'tab-state': return (await session.get(key(m.tabId)))[key(m.tabId)] || null;
    case 'open-signin': {
      if (tabId) await session.set({ signinFrom: tabId });
      await chrome.tabs.create({ url: SIGN_IN_URL, index: tab ? tab.index + 1 : undefined });
      return { ok: true };
    }
    case 'open-signout': { await chrome.tabs.create({ url: SIGN_OUT_URL }); return { ok: true }; }
    case 'open-library': {
      const auth = await getAuth();
      await chrome.tabs.create({ url: auth.user ? `https://www.diigo.com/user/${encodeURIComponent(auth.user)}` : 'https://www.diigo.com/' });
      return { ok: true };
    }
    case 'inject': {
      // The popup asks for this when a tab predates the extension (no content script yet).
      await chrome.scripting.executeScript({ target: { tabId: m.tabId }, files: ['dist/content.js'] });
      return { ok: true };
    }
    default: throw new DiigoError('bad', 'Unknown request ' + m.t);
  }
}
const describe = (e) => ({ kind: e && e.kind || 'error', message: (e && e.message) || String(e) });

chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  if (!m || typeof m.t !== 'string') return false;
  handle(m, sender).then((r) => sendResponse({ ok: true, r }), (e) => sendResponse({ ok: false, e: describe(e) }));
  return true;
});

// ---- events ------------------------------------------------------------------------------------------------
chrome.cookies.onChanged.addListener((info) => {
  if (!isLoginCookieChange(info)) return;
  session.remove('auth').then(() => getAuth(true)).then(authChanged);
});

chrome.tabs.onRemoved.addListener((tabId) => { session.remove(key(tabId)); });
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) session.remove(key(tabId)); // navigation (including single-page pushState): forget the page
});

function tellActiveTab(msg) {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => { if (tab) chrome.tabs.sendMessage(tab.id, msg).catch(() => {}); });
}
chrome.commands.onCommand.addListener((name) => tellActiveTab({ t: 'command', name }));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'dl2-highlight' && tab) chrome.tabs.sendMessage(tab.id, { t: 'command', name: 'highlight-selection' }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'dl2-highlight', title: 'Highlight in Diigo', contexts: ['selection'] });
  });
});
chrome.runtime.onStartup.addListener(() => { getAuth(true).then((a) => setIcon(a.signedIn)); });
// A fresh worker (install, update, or restart after idle) re-reads the cookie; nothing else is assumed.
getAuth(true).then((a) => setIcon(a.signedIn));

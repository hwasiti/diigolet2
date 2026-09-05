// Diigolet 2: a self-contained Diigo highlighter bookmarklet.
// Everything the page needs is in this bundle, so a site's Content Security Policy has nothing to refuse.
import { md5 } from './md5.js';
import { canonicalUrl } from './url.js';
import * as T from './text.js';
import { createRenderer } from './render.js';
import { createTransport } from './transport.js';
import { store } from './store.js';
import { createUi } from './ui.js';
import { payloads, annotationId, jsonpUrl, urlIdFor, PRIVACY } from './diigo.js';

// The install page replaces the placeholder string with {h: helperOrigin, u: username}.
const CFG = window.__dl2cfg || "%%DL2_CFG%%";
const DEV_CFG = { h: 'http://localhost:8765', u: '' };
const MIN_CHARS = 5, MAX_CHARS = 2000, MAX_ENCODED = 3600;

(function boot() {
  if (window.__dl2) { window.__dl2.toggle(); return; }
  const app = createApp(typeof CFG === 'string' ? DEV_CFG : CFG);
  window.__dl2 = app;
  app.start();
})();

function createApp(cfg) {
  const href = location.href;
  const url = canonicalUrl(href);
  const alt = href.replace(/#.*$/, '');
  const ctx = {
    url, title: document.title || url,
    user: store.get('user', '') || cfg.u || '',
    urlId: null, saved: false, signedIn: null,
    // `known` is true only after Diigo itself told us whether this page is bookmarked. Re-saving an
    // existing bookmark blind wipes its tags and description, so the first highlight is never sent
    // through bm_saveBookmark until the state is known.
    known: false,
    anns: new Map(),
  };
  const renderer = createRenderer();
  const ui = createUi({ onColor: highlightSelection, onPen: onPenTap, onRemove: removeHighlight });
  const transport = createTransport({ helper: cfg.h, onMode: (m) => ui.setMode(m) });
  let draft = null, draftTimer = 0, snap = null;
  const cacheKey = 'page:' + url;

  async function start() {
    ui.mount();
    ui.setStatus('Connecting…');
    paintCached();
    const mode = await transport.init();
    if (mode === 'frame') await load();
    else ui.setStatus(ctx.anns.size ? `${ctx.anns.size} cached · tap pen to connect` : 'Tap the pen to connect', 'warn');
  }

  function fresh() { snap = T.snapshot(); return snap; }

  function place(a, pending) {
    const s = snap || fresh();
    const txt = T.stripWs(T.html2txt(a.content));
    const pos = T.seek(s, txt, (a.extra && a.extra.nth) || 1);
    ctx.anns.set(a.id, a);
    if (!pos) { a._lost = true; return false; }
    a._lost = false;
    renderer.paint(a.id, T.toRange(pos), (a.extra && a.extra.color) || 'yellow', pending);
    return true;
  }

  function slim(a) {
    return { id: a.id, content: a.content, type: 0, extra: a.extra, user: a.user, _pending: !!a._pending, _failed: !!a._failed };
  }

  function cacheWrite() {
    const anns = {};
    for (const a of ctx.anns.values()) anns[a.id] = slim(a);
    store.set(cacheKey, { urlId: ctx.urlId, saved: ctx.saved, known: ctx.known, anns });
  }

  function paintCached() {
    const c = store.get(cacheKey);
    if (!c) return;
    ctx.urlId = c.urlId || null;
    ctx.saved = !!c.saved;
    ctx.known = !!c.known;
    fresh();
    for (const a of Object.values(c.anns || {})) place(a, a._pending || a._failed);
    ui.setCount(ctx.anns.size);
  }

  function noteUser(resp) {
    if (resp && resp.user) {
      ctx.user = resp.user; ctx.signedIn = true; store.set('user', resp.user);
    } else if (resp && resp.user === null) {
      ctx.signedIn = false;
    }
  }

  async function load() {
    try {
      ui.setStatus('Loading…');
      const resp = await transport.call('bm_loadBookmark', payloads.load(url), ctx.user);
      noteUser(resp);
      if (resp.code !== 1 || !resp.result) throw Object.assign(new Error('load rejected'), { code: 'rejected' });
      const res = resp.result;
      ctx.urlId = res.urlId || ctx.urlId;
      ctx.saved = !!res.saved;
      ctx.known = true;
      if (res.bookmarkInfo && res.bookmarkInfo.title) ctx.title = res.bookmarkInfo.title;
      // Server view wins: forget cached copies that Diigo no longer has, keep unsaved local ones.
      for (const [id, a] of [...ctx.anns]) if (!a._pending && !a._failed) { renderer.unpaint(id); ctx.anns.delete(id); }
      fresh();
      for (const a of res.annotations || []) if (a.type === 0) place(a, false);
      if (alt !== url) {
        try {
          const r2 = await transport.call('bm_loadBookmark', payloads.load(alt), ctx.user);
          if (r2.code === 1 && r2.result && r2.result.annotations) {
            for (const a of r2.result.annotations) if (a.type === 0 && !ctx.anns.has(a.id)) place({ ...a, _foreignUrl: alt }, false);
          }
        } catch { /* secondary URL is best effort */ }
      }
      cacheWrite();
      ui.setCount(ctx.anns.size);
      if (ctx.signedIn === false) ui.setStatus('Not signed in to Diigo', 'warn');
      else ui.setStatus(summary(), 'ok');
      retryFailed();
    } catch (e) {
      ui.setStatus('Diigo unreachable: ' + (e.code || e.message), 'warn');
    }
  }

  function summary() {
    const n = ctx.anns.size, lost = [...ctx.anns.values()].filter((a) => a._lost).length;
    return `${n} highlight${n === 1 ? '' : 's'}${lost ? ` (${lost} not found on page)` : ''}`;
  }

  function currentSelection() {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    if (ui.contains(r.commonAncestorContainer)) return null;
    if (T.stripWs(r.toString()).length < MIN_CHARS) return null;
    return r.cloneRange();
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const r = currentSelection();
      if (r) { draft = { range: r, at: Date.now() }; ui.showPalette(true); }
      else if (draft && Date.now() - draft.at > 8000) { draft = null; ui.showPalette(false); }
    }, 120);
  });

  document.addEventListener('pointerup', (ev) => {
    if (ui.contains(ev.target)) return;
    setTimeout(() => {
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed) return;
      ui.offerRemove(renderer.idAtPoint(ev.clientX, ev.clientY));
    }, 0);
  });

  async function highlightSelection(color) {
    const d = draft;
    if (!d) { ui.toast('Select some text first'); return; }
    fresh();
    const desc = T.describeRange(d.range, snap);
    if (desc.txt.length < MIN_CHARS) { ui.toast('Selection too short'); return; }
    if (desc.txt.length > MAX_CHARS || encodeURIComponent(desc.content).length > MAX_ENCODED) { ui.toast('Selection too long for Diigo'); return; }
    if (!ctx.user) { ui.toast('Diigo username unknown: connect first'); return; }
    const urlId = ctx.urlId || urlIdFor(md5, url);
    const rect = d.range.getBoundingClientRect();
    const a = {
      id: annotationId(md5, desc.content, ctx.user, urlId, desc.nth),
      content: desc.content, type: 0, user: ctx.user,
      extra: { nth: desc.nth, color, top: round(rect.top + window.scrollY), left: round(rect.left + window.scrollX) },
      _pending: true,
    };
    if (ctx.anns.has(a.id)) { ui.toast('Already highlighted'); return; }
    renderer.paint(a.id, d.range, color, true);
    ctx.anns.set(a.id, a);
    draft = null;
    ui.showPalette(false);
    const sel = document.getSelection();
    if (sel) sel.removeAllRanges();
    ui.setCount(ctx.anns.size);
    cacheWrite();
    await save(a, urlId);
  }

  async function save(a, urlId) {
    const first = !ctx.saved;
    if (first && !ctx.known) {
      // Unknown state: do not risk bm_saveBookmark on an existing bookmark. Keep it pending until connected.
      a._failed = true; a._pending = true;
      cacheWrite();
      ui.setStatus('Connect to Diigo to save this page’s first highlight', 'warn');
      ui.toast('Tap the pen to connect; the highlight is kept and saved then');
      return;
    }
    const cmd = first ? 'bm_saveBookmark' : 'annotation_add';
    const payload = first ? payloads.saveWith(url, ctx.title, a, PRIVACY.PRIVATE) : payloads.add(urlId, a);
    if (transport.mode() === 'none') {
      if (!transport.navigate(jsonpUrl(cmd, payload, ctx.user, Date.now() % 1e6))) { markFailed(a, 'blocked'); return; }
      a._pending = false; a._failed = false; a._unconfirmed = true; ctx.saved = true;
      renderer.setPending(a.id, false);
      cacheWrite();
      ui.setStatus('Sent to Diigo (unconfirmed)', 'warn');
      return;
    }
    if (first) ctx.saved = true; // so a second quick highlight does not re-save the bookmark
    try {
      ui.setStatus('Saving…');
      const resp = await transport.call(cmd, payload, ctx.user);
      noteUser(resp);
      if (resp.code !== 1) throw Object.assign(new Error('rejected'), { code: resp.user === null ? 'signin' : 'rejected' });
      ctx.saved = true; ctx.known = true;
      if (resp.result && resp.result.urlId) ctx.urlId = resp.result.urlId;
      a._pending = false; a._failed = false;
      renderer.setPending(a.id, false);
      cacheWrite();
      ui.setStatus('Saved · ' + summary(), 'ok');
    } catch (e) {
      if (first) ctx.saved = false;
      markFailed(a, e.code || e.message);
    }
  }

  function markFailed(a, why) {
    a._failed = true; a._pending = true;
    cacheWrite();
    ui.setStatus('Save failed: ' + why, 'bad');
    ui.toast(why === 'signin'
      ? 'Diigo does not see your login here. Sign in to diigo.com (or allow third-party cookies), then tap the pen.'
      : 'Save failed. Tap the pen to retry.');
  }

  async function retryFailed() {
    for (const a of [...ctx.anns.values()]) if (a._failed) await save(a, ctx.urlId || urlIdFor(md5, url));
  }

  async function removeHighlight(id) {
    const a = ctx.anns.get(id);
    if (!a) return;
    if (a.user && ctx.user && a.user !== ctx.user) { ui.toast('Not your highlight'); return; }
    renderer.unpaint(id);
    ctx.anns.delete(id);
    ui.setCount(ctx.anns.size);
    cacheWrite();
    const urlId = ctx.urlId || urlIdFor(md5, url);
    if (a._pending && !a._unconfirmed) return; // never reached the server
    if (transport.mode() === 'none') { transport.navigate(jsonpUrl('annotation_delete', payloads.del(urlId, id), ctx.user, Date.now() % 1e6)); return; }
    try {
      const resp = await transport.call('annotation_delete', payloads.del(urlId, id), ctx.user);
      noteUser(resp);
      ui.setStatus(resp.code === 1 ? 'Removed · ' + summary() : 'Remove rejected', resp.code === 1 ? 'ok' : 'bad');
    } catch (e) {
      ui.setStatus('Remove failed: ' + (e.code || e.message), 'bad');
    }
  }

  async function onPenTap() {
    if (transport.mode() === 'none') {
      try {
        ui.setStatus('Connecting…');
        await transport.openPopup();
        await load();
      } catch (e) {
        ui.setStatus(e.code === 'blocked' ? 'Popup blocked; saves go out unconfirmed'
          : e.code === 'coop' ? 'This site isolates popups; saves go out unconfirmed'
          : 'Helper unreachable; saves go out unconfirmed', 'warn');
        ui.toast('Highlights are still sent to Diigo, but cannot be confirmed or re-loaded on this site.');
      }
      return;
    }
    if (ctx.signedIn === false) { window.open('https://www.diigo.com/sign-in', '_blank'); ui.toast('Sign in, then tap the pen again'); ctx.signedIn = null; return; }
    if ([...ctx.anns.values()].some((a) => a._failed)) { await retryFailed(); return; }
    if (draft) { ui.showPalette(true); return; }
    await load();
    ui.toast('Select text, then tap a colour');
  }

  return {
    start,
    toggle: () => ui.toggle(),
    version: __VERSION__,
    // Debug hooks for automated testing; not used by the UI.
    debug: {
      highlight: highlightSelection,
      remove: removeHighlight,
      reload: load,
      connect: onPenTap,
      state: () => ({ url: ctx.url, user: ctx.user, urlId: ctx.urlId, saved: ctx.saved, signedIn: ctx.signedIn, mode: transport.mode(), usesApi: renderer.usesApi(), status: ui.getStatus(),
        anns: [...ctx.anns.values()].map((a) => ({ id: a.id, nth: a.extra && a.extra.nth, color: a.extra && a.extra.color, pending: !!a._pending, failed: !!a._failed, lost: !!a._lost, content: a.content.slice(0, 60) })) }),
    },
  };
}

function round(n) { return Math.round(n * 1000) / 1000; }

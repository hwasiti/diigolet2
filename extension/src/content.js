// Diigolet 2 content script: paints Diigo highlights with the CSS Custom Highlight API (no DOM wrappers, so the
// page's own scripts and styles are left alone) and shows a small colour bubble on selections. All Diigo traffic
// goes through the service worker; this file only knows the page's DOM and Diigo's text model
// (src/bookmarklet/text.js: whitespace-free body text, `content` + `nth` anchoring).
import { snapshot, describeRange, seek, toRange, stripWs, html2txt } from '../../src/bookmarklet/text.js';
import { isHighlightablePage } from './lib/auth.js';
import { nthAtRangeEnd } from './lib/anchor.js';

(() => {
  if (window.top !== window || !isHighlightablePage(location.href) || window.__dl2ext) return;
  if (!('highlights' in CSS) || typeof Highlight === 'undefined') return;
  window.__dl2ext = true;

  const VERSION = __VERSION__;
  const COLORS = ['yellow', 'blue', 'green', 'pink'];
  const HEX = { yellow: '#fff59d', blue: '#b3e5fc', green: '#c5e1a5', pink: '#f8bbd0' };
  const MAX_CHARS = 3000; // Diigo's limit on whitespace-free characters per highlight
  const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

  // ---- talking to the worker ---------------------------------------------------------------------------
  const call = (m) => new Promise((res, rej) => {
    let sent;
    try {
      sent = chrome.runtime.sendMessage(m, (r) => {
        const err = chrome.runtime.lastError;
        if (err) return rej({ kind: 'noworker', message: err.message });
        if (!r) return rej({ kind: 'noreply', message: 'No reply from the extension' });
        r.ok ? res(r.r) : rej(r.e);
      });
    } catch (e) { rej({ kind: 'noworker', message: String(e && e.message || e) }); }
    return sent;
  });

  // ---- painting ----------------------------------------------------------------------------------------
  const groups = {};
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(COLORS.map((c) => { groups[c] = new Highlight(); CSS.highlights.set('dl2-' + c, groups[c]); return `::highlight(dl2-${c}){background-color:${HEX[c]};color:#111}`; }).join(''));
  const adopt = () => { if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; };
  adopt();
  const anns = new Map(); // id -> {id, color, range, txt, nth, content, mine}
  const paint = (a) => { (groups[a.color] || groups.yellow).add(a.range); };
  const unpaint = (a) => { for (const g of Object.values(groups)) g.delete(a.range); };
  const state = { user: null, signedIn: false, loaded: false, shown: true, pen: false, prefs: { autoload: true, color: 'yellow' } };

  function locate(a, S) {
    const txt = stripWs(html2txt(a.content));
    if (!txt) return null;
    // Fewer occurrences than the stored nth means the page changed: the official client then paints the last
    // occurrence, which is usually the wrong text; we report the highlight as not found instead.
    const pos = seek(S, txt, a.nth);
    return pos ? toRange(pos) : null;
  }

  // ---- UI: a closed shadow root with its own stylesheet, appended outside <body> so it is never part of the text ----
  const host = document.createElement('dl2-ui');
  host.setAttribute('data-dl2', '');
  host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;overflow:visible';
  const root = host.attachShadow({ mode: 'closed' });
  const css = new CSSStyleSheet();
  css.replaceSync(`
    :host{all:initial}
    *{box-sizing:border-box;font:13px/1.3 system-ui,sans-serif;color:#222}
    .bubble{position:fixed;z-index:2147483647;display:none;align-items:center;gap:6px;padding:6px;background:#fff;border-radius:22px;box-shadow:0 2px 10px rgba(0,0,0,.28);white-space:nowrap}
    .bubble.on{display:flex}
    button{all:initial;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;border:2px solid rgba(0,0,0,.15);font:700 13px system-ui,sans-serif;color:#333}
    button:hover{border-color:rgba(0,0,0,.5)}
    button.del{background:#fff;color:#c22;font-size:15px}
    button.del.off{display:none}
    .toast{position:fixed;right:14px;bottom:14px;z-index:2147483647;display:none;align-items:center;gap:10px;max-width:60vw;padding:8px 12px;background:#222;color:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);font-size:13px}
    .toast.on{display:flex}
    .toast.ok{background:#1b5e20}.toast.err{background:#b71c1c}.toast.warn{background:#5d4037}
    .toast button{width:auto;height:auto;padding:4px 10px;border-radius:14px;border:1px solid #fff;color:#fff;background:transparent;font-weight:600}
  `);
  root.adoptedStyleSheets = [css];
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  const dots = COLORS.map((c) => { const b = document.createElement('button'); b.style.background = HEX[c]; b.title = 'Highlight ' + c; b.addEventListener('click', () => highlight(c)); return b; });
  const del = document.createElement('button'); del.className = 'del off'; del.textContent = '✕'; del.title = 'Remove this highlight from Diigo'; del.addEventListener('click', () => remove(hit));
  bubble.append(...dots, del);
  const toastEl = document.createElement('div'); toastEl.className = 'toast';
  const toastText = document.createElement('span'); const toastBtn = document.createElement('button'); toastBtn.hidden = true;
  toastEl.append(toastText, toastBtn);
  root.append(bubble, toastEl);
  for (const el of [bubble, toastEl]) el.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the page selection
  (document.documentElement || document).appendChild(host);

  let toastTimer;
  function toast(text, kind = '', action) {
    clearTimeout(toastTimer);
    toastText.textContent = text;
    toastEl.className = 'toast on ' + kind;
    toastBtn.hidden = !action;
    if (action) { toastBtn.textContent = action.label; toastBtn.onclick = () => { hideToast(); action.run(); }; }
    else toastTimer = setTimeout(hideToast, 3500);
  }
  const hideToast = () => { toastEl.className = 'toast'; };
  const signInAction = { label: 'Sign in', run: () => call({ t: 'open-signin' }).catch(() => {}) };
  function fail(e) {
    const kind = e && e.kind, msg = (e && e.message) || String(e);
    if (kind === 'signin') return toast('Sign in to Diigo to highlight', 'warn', signInAction);
    if (kind === 'noworker' && /invalidated|closed/i.test(msg)) return toast('Diigolet was updated — reload this page', 'warn', { label: 'Reload', run: () => location.reload() });
    toast(msg, 'err');
  }

  // ---- selection tracking ------------------------------------------------------------------------------
  let draft = null, hit = null;
  function showBubble(rect) {
    bubble.classList.add('on');
    const w = bubble.offsetWidth || 160, h = bubble.offsetHeight || 40;
    let top = rect.top - h - 8; if (top < 4) top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - w / 2; left = Math.max(4, Math.min(left, innerWidth - w - 4));
    bubble.style.top = Math.min(top, innerHeight - h - 4) + 'px'; bubble.style.left = left + 'px';
  }
  const hideBubble = () => { bubble.classList.remove('on'); };
  const hitAt = (node, offset) => { for (const a of anns.values()) { try { if (a.range.isPointInRange(node, offset)) return a; } catch { /* detached */ } } return null; };
  function onSelection() {
    const s = getSelection();
    if (!s || !s.rangeCount) { draft = hit = null; return hideBubble(); }
    const r = s.getRangeAt(0);
    if (host.contains(r.commonAncestorContainer)) return; // clicks inside our own UI
    hit = hitAt(r.startContainer, r.startOffset) || (s.isCollapsed ? null : hitAt(r.endContainer, Math.max(0, r.endOffset - 1)));
    draft = !s.isCollapsed && stripWs(r.toString()) ? r.cloneRange() : null;
    del.classList.toggle('off', !hit);
    for (const d of dots) d.style.display = draft ? '' : 'none';
    if (!draft && !hit) return hideBubble();
    let rect = (draft || hit.range).getBoundingClientRect();
    if (!rect.width && !rect.height) { const rs = (draft || hit.range).getClientRects(); if (rs.length) rect = rs[rs.length - 1]; }
    showBubble(rect);
  }
  document.addEventListener('selectionchange', debounce(onSelection, 120));
  document.addEventListener('mouseup', () => { if (state.pen && draft && !host.contains(document.activeElement)) setTimeout(() => { if (draft) highlight(state.prefs.color); }, 60); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideBubble(); draft = null; } }, true);

  // ---- highlight / remove / load -----------------------------------------------------------------------
  async function highlight(color) {
    const r = draft; if (!r) return;
    draft = null; hideBubble();
    const S = snapshot();
    const d = describeRange(r, S);
    if (!d.txt) return;
    d.nth = nthAtRangeEnd(r, S, d.txt);
    if (d.txt.length > MAX_CHARS) return toast(`Too long: Diigo allows up to ${MAX_CHARS} characters per highlight`, 'err');
    const rect = r.getBoundingClientRect();
    const a = { color, range: r.cloneRange(), txt: d.txt, nth: d.nth, content: d.content, mine: true };
    paint(a);
    getSelection().removeAllRanges();
    state.prefs.color = color;
    call({ t: 'set-prefs', prefs: { color } }).catch(() => {});
    try {
      const { id } = await call({ t: 'add', url: location.href, title: document.title, content: d.content, nth: d.nth, color, top: rect.top + scrollY, left: rect.left + scrollX });
      a.id = id; anns.set(id, a); state.loaded = true;
      toast('Saved to Diigo', 'ok');
    } catch (e) { unpaint(a); fail(e); }
  }
  async function remove(a) {
    if (!a) return;
    hit = null; hideBubble(); getSelection().removeAllRanges();
    try {
      const { kept } = await call({ t: 'del', url: location.href, id: a.id });
      if (kept) return toast('Diigo kept the highlight (it may belong to a group)', 'err');
      unpaint(a); anns.delete(a.id);
      toast('Removed from Diigo', 'ok');
    } catch (e) { fail(e); }
  }
  function clearAll() { for (const a of anns.values()) unpaint(a); anns.clear(); state.loaded = false; }
  async function load(quiet) {
    let r;
    try { r = await call({ t: 'load', url: location.href, title: document.title }); } catch (e) { if (!quiet) fail(e); return; }
    clearAll();
    state.signedIn = !!r.signedIn; state.user = r.user || null;
    if (!r.signedIn) { if (!quiet) toast(r.stale ? 'Your Diigo session expired — sign in again' : 'Sign in to Diigo', 'warn', signInAction); return; }
    const S = snapshot();
    let lost = 0;
    for (const x of r.anns) {
      const range = locate(x, S);
      if (!range) { lost++; continue; }
      const a = { id: x.id, color: COLORS.includes(x.color) ? x.color : 'yellow', range, txt: stripWs(html2txt(x.content)), nth: x.nth, content: x.content, mine: x.mine };
      anns.set(x.id, a);
      if (state.shown) paint(a);
    }
    state.loaded = true;
    if (!quiet) toast(anns.size ? `${anns.size} highlight${anns.size === 1 ? '' : 's'} on this page${lost ? ` (${lost} not found)` : ''}` : 'No highlights on this page yet', 'ok');
  }
  function setShown(on) {
    state.shown = on;
    for (const a of anns.values()) on ? paint(a) : unpaint(a);
  }

  // ---- keep highlights in place on live pages ----------------------------------------------------------
  function relocateAll() {
    if (!anns.size) return;
    const S = snapshot();
    for (const a of anns.values()) {
      if (stripWs(a.range.toString()) === a.txt) continue;
      unpaint(a);
      const range = locate(a, S);
      if (range) { a.range = range; if (state.shown) paint(a); }
    }
  }
  new MutationObserver(debounce(() => { adopt(); relocateAll(); }, 700)).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  let href = location.href.replace(/#.*$/, '');
  const urlCheck = () => {
    const now = location.href.replace(/#.*$/, '');
    if (now === href) return;
    href = now; clearAll(); hideBubble();
    if (state.prefs.autoload) load(true);
  };
  setInterval(urlCheck, 1000);
  addEventListener('popstate', urlCheck);

  // ---- messages from the worker / popup --------------------------------------------------------------
  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (!m || typeof m.t !== 'string') return false;
    switch (m.t) {
      case 'status': reply({ version: VERSION, loaded: state.loaded, shown: state.shown, pen: state.pen, count: anns.size, user: state.user, signedIn: state.signedIn, url: location.href }); return false;
      case 'set':
        if ('pen' in m) { state.pen = !!m.pen; toast(state.pen ? 'Pen on: every selection is highlighted' : 'Pen off'); }
        if ('shown' in m) setShown(!!m.shown);
        if (m.reload) load(false);
        reply({ ok: true }); return false;
      case 'command':
        if (m.name === 'highlight-selection') { if (!draft) onSelection(); draft ? highlight(state.prefs.color) : toast('Select some text first', 'warn'); }
        else if (m.name === 'toggle-highlights') { state.loaded ? setShown(!state.shown) : load(false); }
        else if (m.name === 'remove-highlight') { if (!hit) onSelection(); hit ? remove(hit) : toast('Put the cursor inside a highlight first', 'warn'); }
        reply({ ok: true }); return false;
      case 'auth-changed':
        state.signedIn = !!(m.auth && m.auth.signedIn); state.user = m.auth ? m.auth.user : null;
        if (state.signedIn) { hideToast(); if (state.prefs.autoload && !state.loaded) load(true); }
        else clearAll();
        return false;
      case 'prefs-changed': state.prefs = { ...state.prefs, ...m.prefs }; return false;
      default: return false;
    }
  });

  // Debug hook for the test harness (visible only in the extension's isolated world).
  window.__dl2ext = { version: VERSION, status: () => ({ loaded: state.loaded, shown: state.shown, pen: state.pen, signedIn: state.signedIn, user: state.user, count: anns.size, bubble: bubble.classList.contains('on'), draft: !!draft, hit: !!hit, toast: toastEl.classList.contains('on') ? toastText.textContent : '' }) };

  call({ t: 'prefs' }).then((p) => { state.prefs = { ...state.prefs, ...p }; if (state.prefs.autoload) load(true); }).catch(() => {});
})();

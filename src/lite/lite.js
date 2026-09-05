// Diigolet 2 client. Chrome for Android caps a bookmark's address at 5,000 characters and Chrome Sync drops
// large bookmarks, so this page-side part only does what needs the page's DOM: collect the text nodes, map
// text offsets to ranges, paint with the CSS Custom Highlight API, show a bare UI, and talk to the helper.
// The helper (our origin, no size limit, updates itself) does all matching, ids and Diigo calls; the page
// sends it the whitespace-free body text. Names are terse on purpose; the minified size is what ships.
const HELPER = (window.__dl2cfg || "%%DL2_CFG%%").h;

// Running the bookmark again on a page reloads its highlights.
if (window.__dl2) window.__dl2();
else boot();

function boot() {
  const D = document, W = (s) => s.replace(/\s+/g, '');
  // Diigolet's tag blacklist, reduced to the tags whose text nodes can appear under body (title: inline SVG).
  // Our own elements hang off <html>, outside the walk.
  const BL = /^(button|noscript|script|select|style|textarea|title)$/i;
  // S = {L: [{n, o, l}] text node with its whitespace-free offset and length, T: whitespace-free body text}
  const snap = () => {
    const w = D.createTreeWalker(D.body, 5, (n) => n.nodeType == 3 ? 1 : BL.test(n.tagName) ? 2 : 3), L = [];
    let n, T = '';
    while ((n = w.nextNode())) { const t = W(n.nodeValue); if (t) { L.push({ n, o: T.length, l: t.length }); T += t; } }
    return { L, T };
  };
  // Real character offset of the k-th non-whitespace character in v (end: one past it).
  const real = (v, k, end) => { let c = 0; for (let i = 0; i < v.length; i++) if (!/\s/.test(v[i]) && c++ == k) return end ? i + 1 : i; return v.length; };
  // Range for whitespace-free offsets [s, e] (inclusive end).
  const rangeAt = (S, s, e) => {
    let a, b;
    for (const z of S.L) { if (!a && s >= z.o && s < z.o + z.l) a = z; if (e >= z.o && e < z.o + z.l) { b = z; break; } }
    if (!a || !b) return;
    const r = D.createRange();
    r.setStart(a.n, real(a.n.nodeValue, s - a.o)); r.setEnd(b.n, real(b.n.nodeValue, e - b.o, 1));
    return r;
  };
  // x = length of body text up to and including the selection's last text node (Diigo's nth rule).
  const prefix = (r, S) => { let x = S.T.length; for (const z of S.L) if (r.intersectsNode(z.n)) x = z.o + z.l; return x; };

  // ---- painting ---------------------------------------------------------------------------------------
  const COLORS = ['yellow', 'blue', 'green', 'pink'], HEX = ['#ff9', '#abd5ff', '#b2e57e', '#fcc'], G = {};
  const sh = new CSSStyleSheet();
  sh.replaceSync(COLORS.map((c, i) => { G[c] = new Highlight(); CSS.highlights.set('dl2' + c, G[c]); return `::highlight(dl2${c}){background:${HEX[i]};color:#111}`; }).join(''));
  D.adoptedStyleSheets = [...D.adoptedStyleSheets, sh];
  const paint = (r, c) => { r = r.cloneRange(); (G[c] || G.yellow).add(r); return r; };
  // A = painted highlights {r: live range, id: Diigo annotation id}; S = last snapshot; draft = selection to
  // save; hit = highlight under the selection (offered for removal); at = when draft/hit were last refreshed.
  const A = [];
  let S, draft, hit, at, dt;

  // ---- UI (plain elements with CSSOM styles; `all:initial` keeps the page's stylesheet out) ------------
  const mk = (t, css, x) => { const e = D.createElement(t); e.style.cssText = 'all:initial;font:14px system-ui;text-align:center;cursor:pointer;' + css; if (x) e.textContent = x; return e; };
  const box = mk('div', 'position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;gap:8px;background:#fff;border-radius:30px;padding:5px 12px;border:1px solid #bbb');
  const stat = mk('span', 'max-width:40vw;overflow:hidden;white-space:nowrap');
  const pen = mk('button', 'width:44px;height:44px;border-radius:50%;color:#fff;font:700 20px system-ui', '✎');
  // One dot per colour, then a cross that removes the highlight under the selection.
  const dots = [...COLORS, 0].map((c, i) => { const d = mk('button', 'display:none;width:30px;height:30px;border-radius:50%;border:2px solid #0003;background:' + (HEX[i] || '#eee'), c ? '' : '✕'); d.onclick = () => c ? hi(c) : rm(); return d; });
  // The hidden helper frame (display, not the hidden attribute: page styles must not surface it).
  const frame = mk('iframe', 'display:none');
  box.append(stat, ...dots, pen); D.documentElement.append(box, frame);
  box.onpointerdown = (e) => e.preventDefault();
  window.__dl2 = load;
  const say = (t, k) => { stat.textContent = t; stat.style.color = k || '#333'; };
  const pal = () => dots.forEach((d, i) => { d.style.display = (i < 4 ? draft : hit) ? '' : 'none'; });
  // Drops the pending selection and offer, clears the native selection, and shows a status.
  const clr = (t) => { draft = hit = 0; pal(); getSelection().removeAllRanges(); say(t); };

  // ---- helper channel ---------------------------------------------------------------------------------
  const org = new URL(HELPER).origin, page = HELPER + '/helper.html?v=' + __BUILD__;
  const mobile = navigator.maxTouchPoints > 1;
  let mode = 0, pop, seq = 0, onReady;
  const pend = {};
  addEventListener('message', (e) => {
    const m = e.data;
    if (e.origin != org || !m || m.t != 'dl2') return;
    if (m.ready) return onReady && onReady(e.source);
    const p = pend[m.id];
    if (p) { delete pend[m.id]; p(m); }
  });
  // Hail the helper until it answers (an existing window answers whoever asks); a handle that turns `closed`
  // while waiting was severed by the page's Cross-Origin-Opener-Policy.
  const shake = (w, ms) => new Promise((res, rej) => {
    const t0 = Date.now(), iv = setInterval(() => { w.closed ? f(rej, 'Popups isolated') : Date.now() - t0 > ms ? f(rej, 'Helper unreachable') : w.postMessage({ t: 'dl2', hello: 1 }, org); }, 250);
    const f = (g, v) => { clearInterval(iv); onReady = 0; g(v); };
    onReady = (s) => s == w && f(res);
  });
  const penMode = () => { pen.style.background = mode || mobile ? '#1f5fbf' : '#777'; };
  const live = () => mode == 1 ? frame.contentWindow : mode == 2 && pop && !pop.closed ? pop : (mode = 0, penMode(), 0);
  const call = (cmd, d) => new Promise((res, rej) => {
    const id = ++seq, t = setTimeout(() => { delete pend[id]; rej('Timed out'); }, 20000);
    pend[id] = (m) => { clearTimeout(t); m.ok ? res(m.r) : rej(m.e); };
    live().postMessage({ t: 'dl2', v: 3, id, cmd, url: location.href, title: D.title, ...d }, org);
  });
  // Runs fn over a channel; opens the popup when needed (user gesture) and, on phones, closes it after.
  const session = async (fn) => {
    let opened;
    if (!live()) {
      pop = open(page, 'dl2', 'popup,width=460,height=380');
      if (!pop) throw 'Popup blocked';
      try { await shake(pop, 8000); } catch (e) { pop.close(); pop = 0; throw e; }
      mode = 2; opened = 1; penMode();
    }
    try { return await fn(); }
    finally { if (opened && mobile) { pop.postMessage({ t: 'dl2', bye: 1 }, org); pop.close(); pop = 0; mode = 0; penMode(); } }
  };

  // ---- highlights -------------------------------------------------------------------------------------
  const sum = () => A.length + ' highlight' + (A.length == 1 ? '' : 's');
  async function load() {
    say('Loading');
    try {
      S = snap();
      const r = await session(() => call('load', { T: S.T }));
      for (const c in G) G[c].clear();
      A.length = hit = 0;
      for (const a of r.anns) { const g = rangeAt(S, a.s, a.e); if (g) A.push({ r: paint(g, a.color), id: a.id }); }
      say(r.user ? sum() : 'Sign in to Diigo', r.user ? 'green' : '#a60');
    } catch (e) { say(e, '#a60'); }
  }
  async function hi(o) {
    const d = draft; if (!d) return;
    S = snap();
    const raw = d.toString(), b = d.getBoundingClientRect(), r = paint(d, o);
    clr('Saving');
    try {
      A.push({ r, id: (await session(() => call('add', { raw, x: prefix(d, S), T: S.T, color: o, top: b.top + scrollY | 0, left: b.left + scrollX | 0 }))).id });
      say('Saved · ' + sum(), 'green');
    } catch (e) { G[o].delete(r); say(e, '#c22'); }
  }
  async function rm() {
    const h = hit; if (!h) return;
    clr('Removing');
    try {
      const r = await session(() => call('del', { ann: h.id }));
      if (r.kept) return say('Diigo kept it', '#c22');
      for (const c in G) G[c].delete(h.r);
      A.splice(A.indexOf(h), 1); say('Removed · ' + sum(), 'green');
    } catch (e) { say(e, '#c22'); }
  }

  pen.onclick = load;
  D.addEventListener('selectionchange', () => {
    clearTimeout(dt);
    dt = setTimeout(() => {
      const s = getSelection(), r = s.rangeCount && s.getRangeAt(0), n = Date.now();
      // A caret or selection inside a painted highlight offers that highlight for removal.
      if (r) { hit = A.find((a) => a.r.isPointInRange(r.startContainer, r.startOffset)); at = n; }
      // A collapsed or short selection keeps the draft and the offer for 8 s: phones may clear the selection
      // before a tap on the palette lands.
      if (r && !s.isCollapsed && !box.contains(r.commonAncestorContainer) && W(r.toString()).length > 4) draft = r.cloneRange();
      else if (n - at > 8000) draft = hit = 0;
      pal();
    }, 120);
  });

  say('Connecting');
  (async () => {
    try {
      frame.src = page;
      await shake(frame.contentWindow, 6000); mode = 1;
    } catch { frame.remove(); }
    penMode();
    mode ? load() : say('Tap pen to load', '#a60');
  })();
}

// Touch-first UI in a closed shadow root: a pen button at the bottom-right that never fights Android's
// own selection toolbar, a colour palette that appears once text is selected, a status line and toasts.
// Styles go in through a constructed stylesheet (CSSOM) so strict style-src policies cannot block them.
import { COLORS } from './render.js';

const CSS = `
:host{all:initial}
.bar{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483647;display:flex;align-items:center;gap:8px;font:14px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;-webkit-user-select:none;user-select:none;touch-action:manipulation}
.panel{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #d6d6d6;border-radius:28px;padding:6px 8px 6px 12px;box-shadow:0 4px 18px rgba(0,0,0,.18)}
.status{max-width:42vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#333}
.status.ok{color:#1b7f4b}.status.warn{color:#a66a00}.status.bad{color:#b3261e}
.palette{display:none;gap:8px}.palette.on{display:flex}
.dot{width:34px;height:34px;border-radius:50%;border:2px solid rgba(0,0,0,.18);padding:0;cursor:pointer;box-sizing:border-box}
.dot:active{transform:scale(.92)}
.remove{display:none;border:1px solid #b3261e;color:#b3261e;background:#fff;border-radius:16px;padding:7px 10px;font:600 13px system-ui,sans-serif;cursor:pointer}.remove.on{display:block}
.pen{width:48px;height:48px;border-radius:50%;border:0;background:#1f5fbf;color:#fff;font:700 22px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);position:relative;display:flex;align-items:center;justify-content:center;padding:0}
.pen.none{background:#6b6b6b}.pen.popup,.pen.oneshot{background:#3b7dd8}
.count{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#ffe86b;color:#111;font:700 11px/18px system-ui,sans-serif;padding:0 4px;display:none;box-sizing:border-box;text-align:center}.count.on{display:block}
.toast{position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:#222;color:#fff;padding:8px 12px;border-radius:8px;font:13px system-ui,sans-serif;max-width:82vw;z-index:2147483647;display:none}.toast.on{display:block}
button:focus-visible{outline:2px solid #1f5fbf;outline-offset:2px}
`;

export function createUi(handlers) {
  const host = document.createElement('div');
  host.setAttribute('data-dl2', '');
  const root = host.attachShadow({ mode: 'closed' });
  let styled = false;
  if (typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
      styled = true;
    } catch { /* fall through */ }
  }
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const btn = (cls, label, text) => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    return b;
  };

  const bar = el('div', 'bar');
  const panel = el('div', 'panel');
  const status = el('div', 'status');
  const palette = el('div', 'palette');
  const remove = btn('remove', 'Remove highlight', 'Remove highlight');
  const pen = btn('pen', 'Diigolet', '✎');
  const count = el('span', 'count');
  const toast = el('div', 'toast');
  pen.appendChild(count);
  panel.append(status, palette, remove);
  bar.append(panel, pen);
  root.append(bar, toast);

  for (const c of Object.keys(COLORS)) {
    const b = btn('dot ' + c, c + ' highlight');
    b.style.backgroundColor = COLORS[c];
    b.addEventListener('click', (ev) => { ev.preventDefault(); handlers.onColor(c); });
    palette.appendChild(b);
  }
  let removeId = null, removeTimer = 0, toastTimer = 0;
  remove.addEventListener('click', (ev) => { ev.preventDefault(); if (removeId) handlers.onRemove(removeId); offerRemove(null); });
  pen.addEventListener('click', (ev) => { ev.preventDefault(); handlers.onPen(); });
  // Keep the page's text selection alive when the user taps our controls.
  host.addEventListener('pointerdown', (ev) => ev.preventDefault());

  function offerRemove(id) {
    clearTimeout(removeTimer);
    removeId = id;
    remove.classList.toggle('on', !!id);
    if (id) removeTimer = setTimeout(() => offerRemove(null), 6000);
  }

  return {
    mount() { if (!host.isConnected) document.documentElement.appendChild(host); },
    toggle() { host.style.display = host.style.display === 'none' ? '' : 'none'; },
    contains(node) { return !!node && (host === node || host.contains(node)); },
    setStatus(text, kind) { status.textContent = text; status.className = 'status' + (kind ? ' ' + kind : ''); },
    getStatus() { return status.textContent; },
    setMode(mode) { pen.className = 'pen ' + mode; },
    setCount(n) { count.textContent = String(n); count.classList.toggle('on', n > 0); },
    showPalette(on) { palette.classList.toggle('on', !!on); if (on) offerRemove(null); },
    offerRemove,
    toast(msg, ms = 2600) {
      clearTimeout(toastTimer);
      toast.textContent = msg;
      toast.classList.add('on');
      toastTimer = setTimeout(() => toast.classList.remove('on'), ms);
    },
  };
}

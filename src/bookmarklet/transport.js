// How the page talks to Diigo despite the page's CSP.
//  frame : hidden iframe of our helper page (postMessage RPC; needs frame-src to allow it)
//  popup : the same helper page in a window opened on a user tap (postMessage RPC)
//  navigation : fire-and-forget top-level GET to diigo.com (works everywhere, no confirmation)
export function createTransport({ helper, onMode }) {
  let mode = 'none';
  let frame = null, popup = null, seq = 0, readyResolve = null;
  const pending = new Map();
  // `helper` is a base URL that may carry a path (https://user.github.io/diigolet2); message origins never do.
  const origin = new URL(helper).origin;

  window.addEventListener('message', (ev) => {
    if (ev.origin !== origin) return;
    const m = ev.data;
    if (!m || m.t !== 'dl2') return;
    if (m.ready) { readyResolve && readyResolve(ev.source); return; }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.resp);
    else p.reject(Object.assign(new Error(m.error || 'helper error'), { code: m.error || 'helper' }));
  });

  function waitReady(ms) {
    return new Promise((res, rej) => {
      readyResolve = res;
      setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    });
  }

  const target = () => (mode === 'frame' ? frame.contentWindow : mode === 'popup' && popup && !popup.closed ? popup : null);

  async function init() {
    try {
      frame = document.createElement('iframe');
      frame.setAttribute('data-dl2', '');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      const st = frame.style;
      st.position = 'fixed'; st.width = '0'; st.height = '0'; st.border = '0'; st.left = '-9999px'; st.top = '0';
      frame.src = helper + '/helper.html';
      document.documentElement.appendChild(frame);
      const src = await waitReady(4000);
      if (src !== frame.contentWindow) throw new Error('unexpected source');
      mode = 'frame';
    } catch {
      if (frame) frame.remove();
      frame = null;
      mode = 'none';
    }
    onMode(mode);
    return mode;
  }

  /** Must be called from a user gesture. */
  async function openPopup() {
    if (popup && !popup.closed && mode === 'popup') return mode;
    popup = window.open(helper + '/helper.html#popup', 'dl2helper', 'popup=yes,width=460,height=380');
    if (!popup) throw Object.assign(new Error('popup blocked'), { code: 'blocked' });
    await waitReady(8000);
    mode = 'popup';
    onMode(mode);
    return mode;
  }

  function call(cmd, payload, user) {
    const win = target();
    if (!win) return Promise.reject(Object.assign(new Error('no channel'), { code: 'nochannel' }));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      win.postMessage({ t: 'dl2', v: 1, id, cmd, payload, user }, origin);
    });
  }

  /** Top-level GET to diigo.com; the tab closes itself after the request has had time to land. */
  function navigate(url) {
    const w = window.open(url, '_blank');
    if (w) setTimeout(() => { try { w.close(); } catch { /* already gone */ } }, 4000);
    return !!w;
  }

  return { init, openPopup, call, navigate, mode: () => mode };
}

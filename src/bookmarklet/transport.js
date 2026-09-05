// How the page talks to Diigo despite the page's CSP.
//  frame   : hidden iframe of our helper page (postMessage RPC); needs the page to allow embedding us
//  popup   : the helper page opened on a user tap. On desktop it is a small window kept open; on phones
//            there are no popup windows, so it is a one-shot round trip: the helper tab opens, serves the
//            session and closes itself, which drops the user back on the article automatically
//  navigate: fire-and-forget top-level GET to diigo.com; works everywhere but cannot confirm or read
export function createTransport({ helper, pageUrl, oneShot, onMode }) {
  let mode = 'none';
  let frame = null, popup = null, seq = 0, readyResolve = null;
  const pending = new Map();
  // `helper` is a base URL that may carry a path (https://user.github.io/diigolet2); message origins never do.
  const origin = new URL(helper).origin;
  // Phones and tablets have no popup windows, only tabs. Chrome's "Desktop site" mode on Android spoofs a
  // Linux desktop UA (and a stylus can make hover/pointer media queries look like a desktop), so also treat a
  // multi-touch device that is not Windows, macOS or ChromeOS as a phone.
  const ua = navigator.userAgent;
  const mobile = typeof oneShot === 'boolean' ? oneShot
    : (!!(navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|Mobile/i.test(ua)
      || (navigator.maxTouchPoints > 1 && !/Windows NT|Macintosh|CrOS/.test(ua)));

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

  const popupLive = () => !!popup && !popup.closed;

  const target = () => {
    if (mode === 'frame') return frame.contentWindow;
    if (mode === 'popup') {
      if (popupLive()) return popup;
      // The user closed the helper window: fall back so the pen offers to reconnect.
      popup = null; mode = 'none'; onMode(mode);
    }
    return null;
  };

  const hasChannel = () => !!target();

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
      const src = await waitReady(6000);
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

  /** Must be called from a user gesture. Throws with code blocked | coop | timeout. */
  async function openPopup() {
    if (mode === 'popup' && popupLive()) return mode;
    popup = window.open(helper + '/helper.html#popup', 'dl2helper', 'popup=yes,width=460,height=380');
    if (!popup) throw Object.assign(new Error('popup blocked'), { code: 'blocked' });
    // A page served with Cross-Origin-Opener-Policy gets a severed handle: the popup can never answer.
    if (popup.closed) { popup = null; throw Object.assign(new Error('opener isolated'), { code: 'coop' }); }
    try {
      await waitReady(8000);
    } catch (e) {
      try { popup.close(); } catch { /* ignore */ }
      popup = null;
      throw e;
    }
    mode = 'popup';
    onMode(mode);
    return mode;
  }

  function closePopup() {
    if (popup) {
      try { popup.postMessage({ t: 'dl2', bye: true }, origin); } catch { /* ignore */ }
      try { popup.close(); } catch { /* ignore */ }
    }
    popup = null;
    if (mode === 'popup') { mode = 'none'; onMode(mode); }
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
      // `url` lets a fresh helper verify that the urlId being written belongs to this page.
      win.postMessage({ t: 'dl2', v: 1, id, cmd, payload, user, url: pageUrl }, origin);
    });
  }

  /**
   * Run fn(call) over a channel. Uses the frame or the live popup when there is one; otherwise opens the
   * popup (needs a user gesture) and, on phones, closes it again afterwards. Rejects with code 'nochannel'
   * (reason in .reason) when no channel could be established.
   */
  async function session(fn) {
    let opened = false;
    if (!hasChannel()) {
      try {
        await openPopup();
        opened = true;
      } catch (e) {
        throw Object.assign(new Error('no channel'), { code: 'nochannel', reason: e.code || 'error' });
      }
    }
    try {
      return await fn(call);
    } finally {
      if (opened && mobile) closePopup();
    }
  }

  /** Top-level GET to diigo.com; the tab closes itself after the request has had time to land. */
  function navigate(url) {
    const w = window.open(url, '_blank');
    if (w) setTimeout(() => { try { w.close(); } catch { /* already gone */ } }, 4000);
    return !!w;
  }

  return { init, session, call, navigate, closePopup, hasChannel, mode: () => mode, oneShot: () => mobile, popupLive };
}

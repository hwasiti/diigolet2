// Diigolet 2 helper: relays Diigo API calls for the bookmarklet running inside other sites.
//
// Security model: the relay is origin-bound. A message is only honoured if the URL it concerns belongs to
// the origin that sent the message (the page the bookmarklet runs in), and highlight writes are only
// accepted for urlIds this helper has itself learned from that origin's loads or saves. A hostile page
// embedding this helper can therefore only touch highlights on its own pages, which it could already do
// by calling Diigo's public JSONP endpoint directly. Nothing is stored; that also keeps it working under
// third-party storage partitioning. It talks to Diigo with JSONP, which carries the visitor's own
// diigo.com cookies.
(function () {
  const ALLOW = new Set(['bm_loadBookmark', 'annotation_add', 'annotation_delete', 'bm_saveBookmark']);
  const PV = 13, CV = '5.0b7', SERVER = 'https://www.diigo.com';
  let seq = 0;
  const pending = new Map();
  const knownUrlIds = new Map(); // origin -> Set of urlIds seen in that origin's own responses

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

  function sameOrigin(url, origin) {
    try { return new URL(url).origin === origin; } catch { return false; }
  }

  function learn(origin, resp) {
    const id = resp && resp.result && resp.result.urlId;
    if (!id) return;
    let set = knownUrlIds.get(origin);
    if (!set) knownUrlIds.set(origin, (set = new Set()));
    set.add(id);
  }

  function knows(origin, urlId) {
    const set = knownUrlIds.get(origin);
    return !!(set && typeof urlId === 'string' && set.has(urlId));
  }

  async function allowed(m, origin, user) {
    if (!/^https?:\/\//.test(origin)) return false;
    const p = m.payload;
    switch (m.cmd) {
      case 'bm_loadBookmark':
      case 'bm_saveBookmark':
        return typeof p.url === 'string' && sameOrigin(p.url, origin);
      case 'annotation_add':
      case 'annotation_delete': {
        if (knows(origin, p.urlId)) return true;
        // A fresh helper (phones open one per session) has learned nothing yet: ask Diigo which urlId the
        // sender's own page URL maps to, and accept only if it matches the one being written.
        if (typeof m.url !== 'string' || !sameOrigin(m.url, origin)) return false;
        try { learn(origin, await jsonp('bm_loadBookmark', { url: m.url, what: 'bookmarkInfo' }, user)); } catch { return false; }
        return knows(origin, p.urlId);
      }
      default:
        return false;
    }
  }

  const status = document.getElementById('status');
  const say = (t) => { if (status) status.textContent = t; };

  window.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (!m || m.t !== 'dl2' || !ev.source) return;
    if (m.bye) { say('Done. Closing…'); setTimeout(() => window.close(), 150); return; }
    if (!m.id) return;
    const reply = (r) => ev.source.postMessage(Object.assign({ t: 'dl2', id: m.id }, r), ev.origin);
    if (!ALLOW.has(m.cmd) || typeof m.payload !== 'object' || m.payload === null) return reply({ ok: false, error: 'badcmd' });
    const user = typeof m.user === 'string' ? m.user.slice(0, 64) : '';
    if (!(await allowed(m, ev.origin, user))) return reply({ ok: false, error: 'forbidden' });
    try {
      const resp = await jsonp(m.cmd, m.payload, user);
      learn(ev.origin, resp);
      say(resp && resp.user ? 'Connected to Diigo as ' + resp.user : 'Diigo did not recognise a signed-in user');
      reply({ ok: true, resp });
    } catch (e) {
      say('Diigo request failed: ' + e);
      reply({ ok: false, error: String(e) });
    }
  });

  const owner = window.opener || (window.parent !== window ? window.parent : null);
  if (owner) {
    owner.postMessage({ t: 'dl2', ready: true }, '*');
    say(window.parent !== window ? 'Ready.' : 'Talking to Diigo… This window closes itself on phones; on desktop, leave it open while highlighting.');
  } else {
    say('This window could not connect back to the page (the site isolates popups). You can close it; highlights on that site are sent to Diigo directly, without confirmation.');
  }
})();

// Diigolet 2 helper: relays Diigo API calls for the bookmarklet running inside other sites.
// It only answers messages carrying the pairing token stored in this browser, so a random page that
// embeds this frame cannot drive the visitor's Diigo account. It talks to Diigo with JSONP, which
// carries the visitor's own diigo.com cookies.
(function () {
  const ALLOW = new Set(['bm_loadBookmark', 'annotation_add', 'annotation_delete', 'bm_saveBookmark']);
  const PV = 13, CV = '5.0b7', SERVER = 'https://www.diigo.com';
  let seq = 0;
  const pending = new Map();

  window.diigolet = {
    callback(resp) {
      const p = pending.get(String(resp && resp.transId));
      if (!p) return;
      pending.delete(String(resp.transId));
      clearTimeout(p.timer);
      p.script.remove();
      p.resolve(resp);
    },
  };

  function token() {
    try { return localStorage.getItem('dl2token') || ''; } catch { return ''; }
  }

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

  const status = document.getElementById('status');
  const say = (t) => { if (status) status.textContent = t; };

  window.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (!m || m.t !== 'dl2' || !m.id || !ev.source) return;
    const reply = (r) => ev.source.postMessage(Object.assign({ t: 'dl2', id: m.id }, r), ev.origin);
    const tk = token();
    if (!tk) return reply({ ok: false, error: 'unpaired' });
    if (typeof m.token !== 'string' || m.token !== tk) return reply({ ok: false, error: 'badtoken' });
    if (!ALLOW.has(m.cmd) || typeof m.payload !== 'object' || m.payload === null) return reply({ ok: false, error: 'badcmd' });
    try {
      const resp = await jsonp(m.cmd, m.payload, typeof m.user === 'string' ? m.user.slice(0, 64) : '');
      say(resp && resp.user ? 'Connected to Diigo as ' + resp.user : 'Diigo did not recognise a signed-in user');
      reply({ ok: true, resp });
    } catch (e) {
      say('Diigo request failed: ' + e);
      reply({ ok: false, error: String(e) });
    }
  });

  const owner = window.opener || (window.parent !== window ? window.parent : null);
  if (owner) owner.postMessage({ t: 'dl2', ready: true, paired: !!token() }, '*');
  say(token() ? 'Ready. Keep this tab open while highlighting.' : 'This browser is not paired yet. Open the install page to pair it.');
})();

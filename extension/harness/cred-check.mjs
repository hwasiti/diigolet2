// Does a worker fetch to www.diigo.com carry the login cookies without `credentials: 'include'`? (The official
// extension omits the option.) Runs with the Diigolet 2 extension in the logged-in profile; read-only.
import { launch, swEval, sleep, HARNESS } from './launch.mjs';
import path from 'node:path';
const browser = await launch({ extensions: [path.resolve(HARNESS, '..')], headless: !process.env.HEADED });
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('dist/bg.js'), { timeout: 15000 })).url()).host;
  const r = await swEval(browser, extId, async () => {
    const out = {};
    for (const [label, host, init] of [
      ['www default credentials', 'https://www.diigo.com', {}],
      ['www credentials:include', 'https://www.diigo.com', { credentials: 'include' }],
      ['www credentials:omit', 'https://www.diigo.com', { credentials: 'omit' }],
      ['toolbar3 default credentials', 'https://toolbar3.diigo.com', {}],
      ['toolbar3 credentials:include', 'https://toolbar3.diigo.com', { credentials: 'include' }],
    ]) {
      try {
        const body = new URLSearchParams({ cmd: 'bm_loadBookmark', v: '13', _nocache: String(Math.random()), json: JSON.stringify({ url: 'https://example.org/', what: 'bookmarkInfo' }), user: '', transId: '1' });
        const resp = await fetch(host + '/chappai/pv=13/ct=tb/cv=test/user=/cmd=bm_loadBookmark/', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, ...init });
        const text = await resp.text();
        let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
        out[label] = { status: resp.status, user: j ? j.user : 'not JSON: ' + text.slice(0, 60) };
      } catch (e) { out[label] = String(e); }
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
} finally { await browser.close(); }

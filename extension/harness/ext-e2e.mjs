// End-to-end test of the Diigolet 2 extension in the logged-in profile: load a page, highlight a sentence,
// reload and see it painted again, survive a worker restart, remove it, and confirm each step against Diigo.
import { launch, stopWorkers, sleep, HARNESS } from './launch.mjs';
import path from 'node:path';

const EXT = path.resolve(HARNESS, '..');
const PAGE = process.env.PAGE || 'https://developer.mozilla.org/en-US/docs/Web/API/Range';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await launch({ extensions: [EXT], headless: !process.env.HEADED });
const swLog = [];
let failures = 0;
const check = (name, ok, detail = '') => { log((ok ? 'PASS' : 'FAIL') + ' ' + name, detail); if (!ok) failures++; };

async function worker() {
  const t = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('dist/bg.js'), { timeout: 15000 });
  const s = await t.createCDPSession();
  await s.send('Runtime.enable');
  s.on('Runtime.consoleAPICalled', (e) => swLog.push('[sw ' + e.type + '] ' + e.args.map((a) => a.value ?? a.description ?? '').join(' ')));
  s.on('Runtime.exceptionThrown', (e) => swLog.push('[sw EXC] ' + (e.exceptionDetails.exception?.description || e.exceptionDetails.text)));
  return t.worker();
}
const tabIdOf = (sw, url) => sw.evaluate((u) => chrome.tabs.query({ url: u.replace(/#.*$/, '') + '*' }).then((t) => t[0] && t[0].id), url);
const status = (sw, tabId) => sw.evaluate((id) => chrome.tabs.sendMessage(id, { t: 'status' }), tabId);
const command = (sw, tabId, name) => sw.evaluate((id, n) => chrome.tabs.sendMessage(id, { t: 'command', name: n }), tabId, name);
const painted = (page) => page.evaluate(() => { let n = 0; for (const [k, h] of CSS.highlights) if (k.startsWith('dl2-')) n += h.size; return n; });
const diigoAnns = (sw, url) => sw.evaluate(async (u) => {
  const r = await chrome.runtime.sendMessage({ t: 'tab-state', tabId: -1 }).catch(() => null); // worker cannot message itself; use the API directly
  const body = new URLSearchParams({ cmd: 'bm_loadBookmark', v: '13', _nocache: String(Math.random()), json: JSON.stringify({ url: u, what: 'bookmarkInfo annotations' }), user: '', transId: '9' });
  const resp = await fetch('https://www.diigo.com/chappai/pv=13/ct=tb/cv=test/user=/cmd=bm_loadBookmark/', { method: 'POST', body, credentials: 'include' });
  const j = await resp.json();
  return { user: j.user, saved: j.result && j.result.saved, anns: ((j.result && j.result.annotations) || []).map((a) => ({ id: a.id, content: a.content, nth: a.extra && a.extra.nth, color: a.extra && a.extra.color })) };
}, url);

try {
  let sw = await worker();
  const auth = await sw.evaluate(() => chrome.cookies.get({ url: 'https://www.diigo.com/', name: 'diigoandlogincookie' }).then((c) => c ? c.value.split('-.-')[1] : null));
  check('test profile is signed in to Diigo', !!auth, auth);

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'load' });
  await sleep(2500);
  const tabId = await tabIdOf(sw, PAGE);
  let st = await status(sw, tabId);
  check('content script answers and auto-loaded', st && st.loaded && st.signedIn, JSON.stringify(st));
  const before = await diigoAnns(sw, PAGE);
  log('Diigo before:', JSON.stringify(before).slice(0, 300));

  // Highlight the second paragraph of the article
  await page.evaluate(() => { const ps = [...document.querySelectorAll('article p, main p')].filter((p) => p.innerText.trim().length > 60); const p = ps[1] || ps[0]; const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const selected = await page.evaluate(() => getSelection().toString().replace(/\s+/g, ' ').trim());
  await sleep(400);
  await command(sw, tabId, 'highlight-selection');
  await sleep(3500);
  st = await status(sw, tabId);
  check('highlight saved (count 1)', st.count === 1, JSON.stringify(st));
  check('one range painted', (await painted(page)) === 1);
  const after = await diigoAnns(sw, PAGE);
  const mine = after.anns.find((a) => !before.anns.some((b) => b.id === a.id));
  check('Diigo stores the highlight', !!mine, JSON.stringify(mine).slice(0, 200));
  check('stored content matches the selection', !!mine && mine.content.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') === selected, (mine && mine.content.slice(0, 80)) + ' | ' + selected.slice(0, 80));

  // Reload: the highlight must be found and painted again
  await page.reload({ waitUntil: 'load' });
  await sleep(3000);
  st = await status(sw, tabId);
  check('after reload: loaded with count 1', st.loaded && st.count === 1, JSON.stringify(st));
  check('after reload: painted', (await painted(page)) === 1);

  // Worker restart: everything still works
  await stopWorkers(browser);
  await sleep(500);
  await command(sw = await worker(), tabId, 'toggle-highlights');
  await sleep(400);
  check('after worker stop: toggle hides', (await painted(page)) === 0);
  await command(sw, tabId, 'toggle-highlights');
  await sleep(400);
  check('after worker stop: toggle shows', (await painted(page)) === 1);
  const authAfter = await sw.evaluate(() => new Promise((r) => { const l = (m, s, rep) => {}; chrome.storage.session.get('auth', (v) => r(v.auth)); }));
  check('after worker stop: auth known', !!(authAfter && authAfter.signedIn), JSON.stringify(authAfter));

  // Remove: put the caret inside the highlight and send the command
  await page.evaluate(() => { const h = [...CSS.highlights].find(([k]) => k.startsWith('dl2-'))[1]; const r = [...h][0]; getSelection().removeAllRanges(); getSelection().collapse(r.startContainer, r.startOffset + 2); });
  await sleep(400);
  await command(sw, tabId, 'remove-highlight');
  await sleep(4000);
  st = await status(sw, tabId);
  check('removed (count 0)', st.count === 0, JSON.stringify(st));
  check('nothing painted', (await painted(page)) === 0);
  const final = await diigoAnns(sw, PAGE);
  check('Diigo no longer has it', !final.anns.some((a) => mine && a.id === mine.id));
  check('no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  log('worker log:', swLog.join('\n  ') || '(quiet)');
  log(failures ? `${failures} FAILURE(S)` : 'ALL PASSED');
} catch (e) { log('CRASHED', e.stack || e); failures++; }
finally { await browser.close(); process.exit(failures ? 1 : 0); }

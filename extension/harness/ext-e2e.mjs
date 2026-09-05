// End-to-end test of the Diigolet 2 extension in the logged-in profile: load a page, highlight a sentence,
// reload and see it painted again, survive a worker restart, remove it, and confirm each step against Diigo.
import { launch, stopWorkers, swEval, tapWorkerLog, sleep, HARNESS } from './launch.mjs';
import path from 'node:path';

const EXT = path.resolve(HARNESS, '..');
const PAGE = process.env.PAGE || 'https://developer.mozilla.org/en-US/docs/Web/API/Range';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await launch({ extensions: [EXT], headless: !process.env.HEADED });
const swLog = [];
let failures = 0;
const check = (name, ok, detail = '') => { log((ok ? 'PASS' : 'FAIL') + ' ' + name, detail); if (!ok) failures++; };
const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('dist/bg.js'), { timeout: 15000 })).url()).host;
const sw = (fn, ...args) => swEval(browser, extId, fn, ...args);
const tabIdOf = (url) => sw((u) => chrome.tabs.query({ url: u.replace(/#.*$/, '') + '*' }).then((t) => t[0] && t[0].id), url);
const status = (tabId) => sw((id) => chrome.tabs.sendMessage(id, { t: 'status' }), tabId);
const command = (tabId, name) => sw((id, n) => chrome.tabs.sendMessage(id, { t: 'command', name: n }), tabId, name);
const painted = (page) => page.evaluate(() => { let n = 0; for (const [k, h] of CSS.highlights) if (k.startsWith('dl2-')) n += h.size; return n; });
const diigoAnns = (url) => sw(async (u) => {
  const body = new URLSearchParams({ cmd: 'bm_loadBookmark', v: '13', _nocache: String(Math.random()), json: JSON.stringify({ url: u, what: 'bookmarkInfo annotations' }), user: '', transId: '9' });
  const resp = await fetch('https://www.diigo.com/chappai/pv=13/ct=tb/cv=test/user=/cmd=bm_loadBookmark/', { method: 'POST', body, credentials: 'include' });
  const j = await resp.json();
  return { user: j.user, saved: j.result && j.result.saved, anns: ((j.result && j.result.annotations) || []).map((a) => ({ id: a.id, content: a.content, nth: a.extra && a.extra.nth, color: a.extra && a.extra.color })) };
}, url);

try {
  await tapWorkerLog(browser, extId, swLog);
  const user = await sw(() => chrome.cookies.get({ url: 'https://www.diigo.com/', name: 'diigoandlogincookie' }).then((c) => c ? c.value.split('-.-')[1] : null));
  check('test profile is signed in to Diigo', !!user, user);

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'load' });
  await sleep(3000);
  const tabId = await tabIdOf(PAGE);
  let st = await status(tabId);
  check('content script answers and auto-loaded', st && st.loaded && st.signedIn, JSON.stringify(st));
  const before = await diigoAnns(PAGE);
  log('Diigo before:', JSON.stringify(before).slice(0, 300));

  // Highlight a paragraph of the article, preferably one with a non-ASCII character (id hashing, escaping)
  await page.evaluate(() => { const ps = [...document.querySelectorAll('article p, main p')].filter((p) => p.innerText.trim().length > 60); const p = ps.find((x) => /[^\x00-\x7f]/.test(x.innerText)) || ps[1] || ps[0]; const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const selected = await page.evaluate(() => getSelection().toString().replace(/\s+/g, ' ').trim());
  await sleep(400);
  await command(tabId, 'highlight-selection');
  await sleep(3500);
  st = await status(tabId);
  check('highlight saved (count 1)', st.count === 1, JSON.stringify(st));
  check('one range painted', (await painted(page)) === 1);
  const after = await diigoAnns(PAGE);
  const mine = after.anns.find((a) => !before.anns.some((b) => b.id === a.id));
  check('Diigo stores the highlight', !!mine, JSON.stringify(mine).slice(0, 200));
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  check('stored content matches the selection', !!mine && unescape(mine.content) === selected, (mine && mine.content.slice(0, 80)) + ' | ' + selected.slice(0, 80));

  // Reload: the highlight must be found and painted again
  await page.reload({ waitUntil: 'load' });
  await sleep(3500);
  st = await status(tabId);
  check('after reload: loaded with count 1', st && st.loaded && st.count === 1, JSON.stringify(st));
  check('after reload: painted', (await painted(page)) === 1);

  // Worker restart: everything still works
  check('worker stopped', await stopWorkers(browser, extId));
  await command(tabId, 'toggle-highlights');
  await sleep(500);
  check('after worker restart: toggle hides', (await painted(page)) === 0);
  await command(tabId, 'toggle-highlights');
  await sleep(500);
  check('after worker restart: toggle shows', (await painted(page)) === 1);
  const authAfter = await sw(() => chrome.storage.session.get('auth').then((v) => v.auth));
  check('after worker restart: auth known and signed in', !!(authAfter && authAfter.signedIn), JSON.stringify(authAfter));

  // Remove: put the caret inside the highlight and send the command
  await page.evaluate(() => { const h = [...CSS.highlights].find(([k]) => k.startsWith('dl2-'))[1]; const r = [...h][0]; getSelection().removeAllRanges(); getSelection().collapse(r.startContainer, r.startOffset + 2); });
  await sleep(500);
  await command(tabId, 'remove-highlight');
  await sleep(4500);
  st = await status(tabId);
  check('removed (count 0)', st.count === 0, JSON.stringify(st));
  check('nothing painted', (await painted(page)) === 0);
  const final = await diigoAnns(PAGE);
  check('Diigo no longer has it', !final.anns.some((a) => mine && a.id === mine.id));
  check('no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  log('worker log:', swLog.join('\n  ') || '(quiet)');
  log(failures ? `${failures} FAILURE(S)` : 'ALL PASSED');
} catch (e) { log('CRASHED', e.stack || e); failures++; }
finally { await browser.close(); process.exit(failures ? 1 : 0); }

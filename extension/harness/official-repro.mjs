// Reproduces the official Diigo extension's failure modes in Chrome for Testing (logged-in persistent profile).
//   T1  fresh worker, page loaded, Ctrl+Alt+A and the popup's "Annotate" command: does the panel appear signed in?
//   T2  worker restarted (as after 30 s idle), then the same actions immediately: "Please sign in first"?
//   T3  the initialData reply right after a restart, seen from the content script's own world
//   T4  auto-show of existing highlights (HLPAGE) with a live worker vs. right after a restart
import { launch, stopWorkers, swEval, tapWorkerLog, OFFICIAL_ID, sleep, HARNESS } from './launch.mjs';
import path from 'node:path';

const PAGE = process.env.PAGE || 'https://developer.mozilla.org/en-US/docs/Web/API/Range';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await launch({ profile: process.env.PROFILE ? path.join(HARNESS, process.env.PROFILE) : undefined, headless: !!process.env.HEADLESS });
const swLog = [];
const sw = (fn, ...args) => swEval(browser, OFFICIAL_ID, fn, ...args);
const globalData = () => sw(() => (typeof GlobalData === 'object' && GlobalData) ? { signedIn: GlobalData.signedIn, user: GlobalData.user } : 'GlobalData not initialised yet');
const tabIdOf = (url) => sw((u) => chrome.tabs.query({ url: u.replace(/#.*$/, '') + '*' }).then((t) => t.length ? Math.max(...t.map((x) => x.id)) : undefined), url);
// What the popup's "Annotate" button does: the worker sends `run` to the tab.
const runCmd = (tabId, type) => sw((id, type) => new Promise((res) => { chrome.tabs.sendMessage(id, { name: 'run', details: { extensionID: chrome.runtime.id, version: chrome.runtime.getManifest().version, logLevel: 'never', userClick: true, type } }, (r) => res(chrome.runtime.lastError ? 'no reply (' + chrome.runtime.lastError.message + ')' : r)); }), tabId, type);

/** Open a page with a CDP session that tracks execution contexts, so we can evaluate inside the extension's isolated world. */
async function openPage(url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console.error] ' + m.text().slice(0, 300)); });
  page.on('dialog', (d) => { errors.push('[dialog] ' + d.message().slice(0, 200)); d.dismiss().catch(() => {}); });
  const cdp = await page.createCDPSession();
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  cdp.on('Runtime.executionContextDestroyed', (e) => { const i = contexts.findIndex((c) => c.id === e.executionContextId); if (i >= 0) contexts.splice(i, 1); });
  await cdp.send('Runtime.enable');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  const world = () => contexts.find((c) => c.auxData && c.auxData.type === 'isolated' && !/puppeteer/i.test(c.name) && c.auxData.frameId === page.mainFrame()._id);
  const inWorld = async (expression) => {
    const ctx = world();
    if (!ctx) throw new Error('no content-script world; contexts: ' + contexts.map((c) => c.name + '/' + c.auxData?.type).join(','));
    const r = await cdp.send('Runtime.evaluate', { contextId: ctx.id, expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('world eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  return { page, errors, inWorld };
}

const uiState = (page) => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const els = [...document.querySelectorAll('[id^=diigolet], .diigolet')].filter(vis);
  const texts = [...new Set(els.map((e) => e.innerText && e.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 160))];
  const panel = document.querySelector('#diigolet-panel-panel');
  return { panelVisible: !!(panel && vis(panel)), highlights: document.querySelectorAll('.diigoHighlight').length, texts: texts.slice(0, 6) };
});
const worldInfo = (t) => t.inWorld("({ ready: typeof diigolet !== 'undefined' && !!diigolet.ready, started: typeof diigolet !== 'undefined' && !!diigolet.started, signedIn: typeof diigolet !== 'undefined' && diigolet.state ? diigolet.state.signedIn : 'n/a' })").catch((e) => String(e));
const initialDataProbe = "new Promise((res) => { const t0 = Date.now(); chrome.runtime.sendMessage({ name: 'initialData' }, (r) => res({ ms: Date.now() - t0, reply: r === undefined ? 'undefined' : { user: r.globalData && r.globalData.user, signedIn: r.globalData && r.globalData.signedIn }, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message })); setTimeout(() => res('no callback within 8 s'), 8000); })";

async function pressAnnotate(page) {
  await page.bringToFront();
  await page.mouse.click(400, 400);
  await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.press('KeyA'); await page.keyboard.up('Alt'); await page.keyboard.up('Control');
}

try {
  await tapWorkerLog(browser, OFFICIAL_ID, swLog);
  const cookie = await sw(() => chrome.cookies.get({ url: 'https://www.diigo.com/', name: 'diigoandlogincookie' }).then((c) => c ? { domain: c.domain, user: c.value.split('-.-')[1], session: c.session } : null));
  log('login cookie:', JSON.stringify(cookie));
  log('worker GlobalData right after start:', JSON.stringify(await globalData()));

  // ---- Test 1: fresh worker, page loaded normally ------------------------------------------------------
  log('TEST 1: open page, wait 3 s, press Ctrl+Alt+A, then send the popup-style run command');
  const t1 = await openPage(PAGE);
  await sleep(3000);
  log('T1 GlobalData after 3 s:', JSON.stringify(await globalData()));
  await pressAnnotate(t1.page);
  await sleep(3000);
  log('T1 after shortcut:', JSON.stringify(await uiState(t1.page)), JSON.stringify(await worldInfo(t1)));
  log('T1 run command ->', JSON.stringify(await runCmd(await tabIdOf(PAGE), 'highlight')));
  await sleep(4000);
  log('T1 after run command:', JSON.stringify(await uiState(t1.page)), JSON.stringify(await worldInfo(t1)));
  log('T1 page errors/dialogs:', JSON.stringify(t1.errors.slice(0, 6)));
  await t1.page.close();

  // ---- Test 2: worker restarted, then the same actions immediately ---------------------------------------
  log('TEST 2: open page, restart the worker, then act immediately');
  const t2 = await openPage(PAGE);
  await sleep(2000);
  log('T2 worker stopped:', await stopWorkers(browser, OFFICIAL_ID));
  log('T2 GlobalData in the fresh worker:', JSON.stringify(await globalData()));
  log('T2 run command ->', JSON.stringify(await runCmd(await tabIdOf(PAGE), 'highlight')));
  await sleep(4000);
  log('T2 after run command:', JSON.stringify(await uiState(t2.page)), JSON.stringify(await worldInfo(t2)));
  log('T2 GlobalData 4 s later:', JSON.stringify(await globalData()));
  log('T2 page errors/dialogs:', JSON.stringify(t2.errors.slice(0, 6)));
  await t2.page.close();

  // ---- Test 3: the initialData reply as the content script sees it, right after a restart -----------------
  log('TEST 3: restart the worker, then ask initialData from the content-script world');
  const t3 = await openPage(PAGE);
  await sleep(2000);
  log('T3 worker stopped:', await stopWorkers(browser, OFFICIAL_ID));
  log('T3 first reply:', JSON.stringify(await t3.inWorld(initialDataProbe)));
  log('T3 second reply:', JSON.stringify(await t3.inWorld(initialDataProbe)));
  await sleep(2000);
  log('T3 reply 2 s later:', JSON.stringify(await t3.inWorld(initialDataProbe)));
  await t3.page.close();

  // ---- Test 4: auto-show of existing highlights after a worker restart ------------------------------------
  const HL = process.env.HLPAGE;
  if (HL) {
    log('TEST 4: auto-show with a live worker (page with existing highlights)');
    await sleep(1500);
    const a = await openPage(HL);
    await sleep(7000);
    log('T4 live worker:', JSON.stringify(await uiState(a.page)));
    await a.page.close();
    log('TEST 4b: auto-show right after a worker restart');
    await stopWorkers(browser, OFFICIAL_ID);
    const b = await openPage(HL);
    await sleep(7000);
    log('T4b fresh worker:', JSON.stringify(await uiState(b.page)));
    log('T4b page errors:', JSON.stringify(b.errors.slice(0, 6)));
    await b.page.close();
  }
  log('worker log tail:\n  ' + swLog.slice(-30).join('\n  '));
} catch (e) { log('FAILED:', e.stack || e); }
finally { await browser.close(); }

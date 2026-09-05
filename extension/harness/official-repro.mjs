// Reproduces the official Diigo extension's failure modes in Chrome for Testing (logged-in persistent profile).
import { launch, serviceWorker, stopWorkers, OFFICIAL_ID, sleep } from './launch.mjs';

const PAGE = process.env.PAGE || 'https://developer.mozilla.org/en-US/docs/Web/API/Range';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await launch();
const swLog = [];
async function tapWorker() {
  const t = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(OFFICIAL_ID), { timeout: 15000 });
  const s = await t.createCDPSession();
  await s.send('Runtime.enable');
  s.on('Runtime.consoleAPICalled', (e) => swLog.push('[sw ' + e.type + '] ' + e.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)));
  s.on('Runtime.exceptionThrown', (e) => swLog.push('[sw EXC] ' + (e.exceptionDetails.exception?.description || e.exceptionDetails.text).slice(0, 300)));
  return t.worker();
}

/** Open a page with a CDP session that tracks execution contexts, so we can evaluate inside the extension's isolated world. */
async function openPage(url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' || /diigo/i.test(m.text())) errors.push('[console.' + m.type() + '] ' + m.text().slice(0, 300)); });
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
  return { page, errors, cdp, contexts, inWorld };
}

const uiState = (page) => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const els = [...document.querySelectorAll('[id^=diigolet], .diigolet')].filter(vis);
  const texts = [...new Set(els.map((e) => e.innerText && e.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 200))];
  return { panel: !!document.querySelector('#diigolet-panel-panel'), panelVisible: !!(document.querySelector('#diigolet-panel-panel') && vis(document.querySelector('#diigolet-panel-panel'))), highlights: document.querySelectorAll('.diigoHighlight').length, visibleIds: els.map((e) => e.id).filter(Boolean).slice(0, 12), texts: texts.slice(0, 8) };
});

async function pressAnnotate(page) {
  await page.bringToFront();
  await page.mouse.click(400, 400);
  await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.press('KeyA'); await page.keyboard.up('Alt'); await page.keyboard.up('Control');
}

const initialDataProbe = "new Promise((res) => { const t0 = Date.now(); chrome.runtime.sendMessage({ name: 'initialData' }, (r) => res({ ms: Date.now() - t0, reply: r === undefined ? 'undefined' : { user: r.globalData && r.globalData.user, signedIn: r.globalData && r.globalData.signedIn, version: r.version }, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message })); setTimeout(() => res('no callback within 8 s'), 8000); })";

try {
  let sw = await tapWorker();
  const cookie = await sw.evaluate(() => new Promise((r) => chrome.cookies.get({ url: 'https://www.diigo.com', name: 'diigoandlogincookie' }, (c) => r(c ? { domain: c.domain, user: c.value.split('-.-')[1], secure: c.secure, sameSite: c.sameSite, session: c.session, expires: c.expirationDate } : null))));
  log('login cookie:', JSON.stringify(cookie));
  const gd0 = await sw.evaluate(() => typeof GlobalData !== 'undefined' ? { signedIn: GlobalData.signedIn, user: GlobalData.user } : 'n/a');
  log('worker GlobalData right after start:', JSON.stringify(gd0));

  // ---- Test 1: fresh worker, page loaded normally, Ctrl+Alt+A --------------------------------------
  log('TEST 1: open page, wait 3 s, press Ctrl+Alt+A');
  const t1 = await openPage(PAGE);
  await sleep(3000);
  await pressAnnotate(t1.page);
  await sleep(4000);
  log('T1 ui:', JSON.stringify(await uiState(t1.page)));
  log('T1 page errors:', JSON.stringify(t1.errors.slice(0, 6)));
  const gd1 = await sw.evaluate(() => ({ signedIn: GlobalData.signedIn, user: GlobalData.user }));
  log('T1 worker GlobalData:', JSON.stringify(gd1));
  await t1.page.close();

  // ---- Test 2: worker terminated (idle), then Ctrl+Alt+A on an already-open page -----------------
  log('TEST 2: open page, then stop the service worker, press Ctrl+Alt+A immediately');
  const t2 = await openPage(PAGE);
  await sleep(2000);
  await stopWorkers(browser);
  await sleep(300);
  const alive = (await browser.targets()).some((t) => t.type() === 'service_worker');
  log('T2 worker target alive after stop:', alive);
  await pressAnnotate(t2.page);
  await sleep(4000);
  log('T2 ui:', JSON.stringify(await uiState(t2.page)));
  log('T2 page errors:', JSON.stringify(t2.errors.slice(0, 6)));
  sw = await tapWorker();
  log('T2 worker GlobalData after wake:', JSON.stringify(await sw.evaluate(() => ({ signedIn: GlobalData.signedIn, user: GlobalData.user }))));
  await sleep(1500);
  await pressAnnotate(t2.page);
  await sleep(3000);
  log('T2 ui after second press:', JSON.stringify(await uiState(t2.page)));
  await t2.page.close();

  // ---- Test 3: message from the content script while the worker is stopped ------------------------
  log('TEST 3: stop worker, then send initialData from the content-script world and inspect the reply');
  const t3 = await openPage(PAGE);
  await sleep(2000);
  await stopWorkers(browser);
  await sleep(300);
  log('T3 first initialData reply after worker stop:', JSON.stringify(await t3.inWorld(initialDataProbe)));
  log('T3 second initialData reply (worker now running):', JSON.stringify(await t3.inWorld(initialDataProbe)));
  await sleep(1500);
  log('T3 third initialData reply (1.5 s later):', JSON.stringify(await t3.inWorld(initialDataProbe)));
  await t3.page.close();

  // ---- Test 4: autoshow of existing highlights after a worker restart -----------------------------
  const HL = process.env.HLPAGE; // a page that already has highlights by this user
  if (HL) {
    log('TEST 4: autoshow with a live worker');
    sw = await tapWorker();
    await sleep(1500);
    const a = await openPage(HL);
    await sleep(6000);
    log('T4 live worker ui:', JSON.stringify(await uiState(a.page)));
    await a.page.close();
    log('TEST 4b: autoshow after the worker was stopped');
    await stopWorkers(browser);
    await sleep(300);
    const b = await openPage(HL);
    await sleep(6000);
    log('T4b stopped worker ui:', JSON.stringify(await uiState(b.page)));
    log('T4b page errors:', JSON.stringify(b.errors.slice(0, 6)));
    await b.page.close();
  }
  log('worker log tail:', swLog.slice(-25).join('\n  '));
} catch (e) { log('FAILED:', e.stack || e); }
finally { await browser.close(); }

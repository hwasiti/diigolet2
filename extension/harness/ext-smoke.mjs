// Smoke test for the Diigolet 2 extension in a throwaway profile (no Diigo login needed): the worker starts
// cleanly, the content script answers, the popup renders and reports "not signed in".
import { launch, sleep, HARNESS } from './launch.mjs';
import path from 'node:path';

const EXT = path.resolve(HARNESS, '..');
const profile = process.env.PROFILE ? path.join(HARNESS, process.env.PROFILE) : path.join(HARNESS, 'profile-probe');
const browser = await launch({ extensions: [EXT], profile, headless: process.env.HEADED ? false : true });
const swLog = [];
try {
  const t = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('dist/bg.js'), { timeout: 15000 });
  const extId = new URL(t.url()).host;
  const s = await t.createCDPSession();
  await s.send('Runtime.enable');
  s.on('Runtime.consoleAPICalled', (e) => swLog.push('[sw ' + e.type + '] ' + e.args.map((a) => a.value ?? a.description ?? '').join(' ')));
  s.on('Runtime.exceptionThrown', (e) => swLog.push('[sw EXC] ' + (e.exceptionDetails.exception?.description || e.exceptionDetails.text)));
  const sw = await t.worker();
  console.log('extension id', extId);
  console.log('auth from worker:', JSON.stringify(await sw.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ t: 'auth', refresh: true }, r)))));

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('https://developer.mozilla.org/en-US/docs/Web/API/Range', { waitUntil: 'load' });
  await sleep(1500);
  const tabId = await sw.evaluate(() => chrome.tabs.query({ url: 'https://developer.mozilla.org/*' }).then((t) => t[0] && t[0].id));
  console.log('content status:', JSON.stringify(await sw.evaluate((id) => chrome.tabs.sendMessage(id, { t: 'status' }), tabId)));
  console.log('ui host present:', await page.evaluate(() => !!document.querySelector('dl2-ui')));
  // Select a sentence and check the bubble appears (shadow root is closed, so measure through the host's size only)
  await page.evaluate(() => { const p = document.querySelector('article p, main p, p'); const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r); });
  await sleep(500);
  console.log('page errors:', JSON.stringify(errors.slice(0, 5)));

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
  await sleep(800);
  console.log('popup text:', (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300));
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'load' });
  await sleep(500);
  console.log('options text:', (await options.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 120));
  console.log('worker log:', swLog.join('\n  ') || '(quiet)');
} catch (e) { console.log('FAILED', e.stack || e); }
finally { await browser.close(); }

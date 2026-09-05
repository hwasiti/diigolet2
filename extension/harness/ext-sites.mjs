// Read-only sweep of the Diigolet 2 extension across sites (logged-in profile): the content script must load,
// report the sign-in state, show the colour bubble on a selection, and leave no errors. Nothing is written to Diigo.
import { launch, swEval, tapWorkerLog, sleep, HARNESS } from './launch.mjs';
import path from 'node:path';

const EXT = path.resolve(HARNESS, '..');
const SITES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://github.com/hwasiti/diigolet2',
  'https://en.wikipedia.org/wiki/Content_Security_Policy',
  'https://stackoverflow.com/questions/1',
  'https://developer.mozilla.org/en-US/docs/Web/API/Range',
  'https://news.ycombinator.com/',
  'https://www.nytimes.com/',
  'https://www.theguardian.com/international',
  'https://medium.com/',
  'https://web.dev/',
  'https://www.bbc.com/news',
  'https://arxiv.org/abs/1706.03762',
  'https://docs.google.com/document/d/1/edit',
  'https://www.reddit.com/',
];
const browser = await launch({ extensions: [EXT], headless: !process.env.HEADED });
const swLog = [];
const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('dist/bg.js'), { timeout: 15000 })).url()).host;
await tapWorkerLog(browser, extId, swLog);

async function openPage(url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const cdp = await page.createCDPSession();
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  cdp.on('Runtime.executionContextDestroyed', (e) => { const i = contexts.findIndex((c) => c.id === e.executionContextId); if (i >= 0) contexts.splice(i, 1); });
  await cdp.send('Runtime.enable');
  const inWorld = async (expression) => {
    const ctx = contexts.find((c) => c.auxData && c.auxData.type === 'isolated' && !/puppeteer/i.test(c.name) && c.auxData.frameId === page.mainFrame()._id);
    if (!ctx) return 'no content-script world';
    const r = await cdp.send('Runtime.evaluate', { contextId: ctx.id, expression, awaitPromise: true, returnByValue: true });
    return r.exceptionDetails ? 'eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : r.result.value;
  };
  return { page, errors, inWorld };
}

for (const url of SITES) {
  const row = { url };
  let t;
  try {
    t = await openPage(url);
    const resp = await t.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    row.http = resp ? resp.status() : null;
    await sleep(3500);
    row.status = await t.inWorld('window.__dl2ext ? window.__dl2ext.status() : "no hook"');
    // select the first long paragraph and see whether the bubble appears
    const sel = await t.page.evaluate(() => { const ps = [...document.querySelectorAll('p, li, td, h1, h2')].filter((p) => p.innerText && p.innerText.trim().length > 40); const p = ps[0]; if (!p) return 0; const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString().length; });
    await sleep(600);
    row.selected = sel;
    row.after = await t.inWorld('window.__dl2ext ? window.__dl2ext.status() : "no hook"');
    row.errors = t.errors.slice(0, 2);
  } catch (e) { row.error = e.message.slice(0, 140); }
  const s = row.status && typeof row.status === 'object' ? row.status : null, a = row.after && typeof row.after === 'object' ? row.after : null;
  console.log(JSON.stringify({ url, http: row.http, hook: !!s, signedIn: s && s.signedIn, loaded: s && s.loaded, count: s && s.count, selected: row.selected, bubble: a && a.bubble, toast: a && a.toast, errors: row.errors, error: row.error, raw: s ? undefined : row.status }));
  if (t) await t.page.close().catch(() => {});
}
console.log('worker log:', swLog.filter((l) => /EXC|error/i.test(l)).slice(0, 10).join('\n  ') || '(no worker errors)');
await browser.close();

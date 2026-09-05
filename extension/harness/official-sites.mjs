// Read-only sweep of the OFFICIAL Diigo extension across sites (signed-in profile): for each page, send the popup's
// "Annotate" command (the `run` message) to its content script and see whether its panel appears, what it says,
// and whether the page logs errors. Nothing is written to Diigo.
import { launch, swEval, OFFICIAL_ID, sleep } from './launch.mjs';

const SITES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://github.com/hwasiti/diigolet2',
  'https://en.wikipedia.org/wiki/Content_Security_Policy',
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
  'https://x.com/',
  'https://www.youtube.com/',
  'https://mail.proton.me/',
];
const browser = await launch({ headless: !process.env.HEADED });
const sw = (fn, ...args) => swEval(browser, OFFICIAL_ID, fn, ...args);
const tabIdOf = (url) => sw((u) => chrome.tabs.query({ url: u.replace(/#.*$/, '') + '*' }).then((t) => t.length ? Math.max(...t.map((x) => x.id)) : undefined), url);
const runCmd = (tabId) => sw((id) => new Promise((res) => { chrome.tabs.sendMessage(id, { name: 'run', details: { extensionID: chrome.runtime.id, version: chrome.runtime.getManifest().version, logLevel: 'never', userClick: true, type: 'highlight' } }, (r) => res(chrome.runtime.lastError ? 'no reply (' + chrome.runtime.lastError.message + ')' : r)); }), tabId);
const uiState = (page) => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const els = [...document.querySelectorAll('[id^=diigolet], .diigolet')].filter(vis);
  const texts = [...new Set(els.map((e) => e.innerText && e.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 120))];
  const panel = document.querySelector('#diigolet-panel-panel');
  return { panelVisible: !!(panel && vis(panel)), highlights: document.querySelectorAll('.diigoHighlight').length, texts: texts.slice(0, 4) };
});

for (const url of SITES) {
  const row = { url };
  let page;
  try {
    page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
    page.on('console', (m) => { if (m.type() === 'error' && /diigo|chrome-extension/i.test(m.text())) errors.push(m.text().slice(0, 120)); });
    page.on('dialog', (d) => { errors.push('[dialog] ' + d.message().slice(0, 100)); d.dismiss().catch(() => {}); });
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    row.http = resp ? resp.status() : null;
    await sleep(3500);
    row.run = await runCmd(await tabIdOf(url));
    await sleep(4000);
    Object.assign(row, await uiState(page));
    row.errors = errors.slice(0, 3);
  } catch (e) { row.error = e.message.slice(0, 140); }
  console.log(JSON.stringify(row));
  if (page) await page.close().catch(() => {});
}
await browser.close();

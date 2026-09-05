import { launch, serviceWorker, OFFICIAL_ID, sleep } from './launch.mjs';
const browser = await launch();
try {
  const sw = await serviceWorker(browser, OFFICIAL_ID);
  console.log('worker url:', sw.url());
  const page = await browser.newPage();
  await page.goto('https://example.org/', { waitUntil: 'load' });
  await sleep(1500);
  console.log('targets:', (await browser.targets()).map((t) => t.type() + ' ' + t.url()).join('\n  '));
  const gd = await sw.evaluate(() => new Promise((r) => chrome.storage.local.get('globalData', (v) => r(v.globalData))));
  console.log('globalData:', JSON.stringify(gd).slice(0, 300));
  const cookie = await sw.evaluate(() => new Promise((r) => chrome.cookies.get({ url: 'https://www.diigo.com', name: 'diigoandlogincookie' }, r)));
  console.log('diigoandlogincookie:', cookie);
} finally { await browser.close(); }

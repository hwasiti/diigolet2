// Opens the headed test browser at Diigo's sign-in page and waits for a HUMAN to sign in (Diigo shows a CAPTCHA
// to this browser now, and no script may solve that). Once the login cookie appears it makes the session cookies
// persistent (Diigo issues session cookies, which Chrome drops at exit), verifies the API sees the user, closes
// the browser and runs the suites: official-repro, cred-check, ext-e2e, ext-sites. Logs land in harness/results/.
import { launch, swEval, sleep, HARNESS } from './launch.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const EXT = path.resolve(HARNESS, '..');
const OUT = path.join(HARNESS, 'results');
mkdirSync(OUT, { recursive: true });
const log = (...a) => { const line = new Date().toISOString().slice(0, 19) + ' ' + a.join(' '); console.log(line); appendFileSync(path.join(OUT, 'signin.log'), line + '\n'); };
const HOURS = Number(process.env.WAIT_HOURS || 10);

const browser = await launch({ extensions: [EXT], headless: false, extraArgs: ['--window-size=1100,820'] });
const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('dist/bg.js'), { timeout: 15000 })).url()).host;
const loginUser = () => swEval(browser, extId, () => chrome.cookies.get({ url: 'https://www.diigo.com/', name: 'diigoandlogincookie' }).then((c) => c ? c.value.split('-.-')[1] : null)).catch(() => null);

let user = await loginUser();
if (!user) {
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.goto('https://www.diigo.com/sign-in', { waitUntil: 'load' }).catch(() => {});
  await page.evaluate(() => {
    const b = document.createElement('div');
    b.textContent = 'Diigolet 2 test browser: please sign in to Diigo here (solve the CAPTCHA if it appears). The test suites then start by themselves and this window closes.';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1f5fbf;color:#fff;padding:12px;font:15px system-ui;text-align:center';
    document.body.prepend(b);
  }).catch(() => {});
  log(`waiting up to ${HOURS} h for a sign-in in the test browser`);
  const deadline = Date.now() + HOURS * 3600e3;
  while (!user && Date.now() < deadline) {
    await sleep(2000);
    if (!browser.connected) { log('browser was closed'); process.exit(1); }
    user = await loginUser();
  }
  if (!user) { log('no sign-in happened; giving up'); await browser.close(); process.exit(1); }
}
log('signed in as', user);
await sleep(3000);
const names = await swEval(browser, extId, async () => {
  const out = [];
  for (const c of await chrome.cookies.getAll({ domain: 'diigo.com' })) {
    if (!c.session) continue;
    await chrome.cookies.set({ url: 'https://' + c.domain.replace(/^\./, '') + c.path, name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: Math.floor(Date.now() / 1000) + 30 * 86400 });
    out.push(c.name);
  }
  return out;
});
log('session cookies made persistent:', names.join(', ') || '(none)');
const api = await swEval(browser, extId, async () => {
  const body = new URLSearchParams({ cmd: 'bm_loadBookmark', v: '13', _nocache: String(Math.random()), json: JSON.stringify({ url: 'https://example.org/', what: 'bookmarkInfo' }), user: '', transId: '1' });
  const r = await fetch('https://www.diigo.com/chappai/pv=13/ct=tb/cv=test/user=/cmd=bm_loadBookmark/', { method: 'POST', body, credentials: 'include' });
  return { status: r.status, user: (await r.json()).user };
}).catch((e) => ({ error: String(e) }));
log('Diigo API sees user:', JSON.stringify(api));
await browser.close();
await sleep(2000);

const suites = [
  ['official-repro', ['official-repro.mjs'], { HEADLESS: '1', HLPAGE: 'https://en.wikipedia.org/wiki/Web_browser' }],
  ['cred-check', ['cred-check.mjs'], {}],
  ['ext-e2e', ['ext-e2e.mjs'], {}],
  ['ext-sites', ['ext-sites.mjs'], {}],
];
for (const [name, args, env] of suites) {
  log('running', name);
  const r = spawnSync(process.execPath, args, { cwd: HARNESS, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15 * 60e3 });
  writeFileSync(path.join(OUT, name + '.log'), (r.stdout || '') + (r.stderr || ''));
  log(name, 'exit', r.status, r.error ? String(r.error) : '');
}
log('ALL DONE');

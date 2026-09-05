// Runs the CSP probe extension against a list of sites in a throwaway profile (no login needed).
import { launch, sleep, HARNESS } from './launch.mjs';
import path from 'node:path';
const sites = process.argv.slice(2);
const browser = await launch({ extensions: [path.join(HARNESS, 'ext-probe')], profile: path.join(HARNESS, 'profile-probe'), headless: true });
try {
  for (const url of sites) {
    const page = await browser.newPage();
    const row = { url };
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      row.cspHeader = resp ? (resp.headers()['content-security-policy'] || '').slice(0, 400) : null;
      row.coop = resp ? resp.headers()['cross-origin-opener-policy'] || null : null;
      for (let i = 0; i < 40; i++) { const v = await page.evaluate(() => document.documentElement.getAttribute('data-csp-probe')); if (v) { Object.assign(row, JSON.parse(v)); break; } await sleep(250); }
    } catch (e) { row.error = e.message.slice(0, 120); }
    console.log(JSON.stringify(row));
    await page.close();
  }
} finally { await browser.close(); }

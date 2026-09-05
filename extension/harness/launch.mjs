// Test harness: launches Chrome for Testing (puppeteer) with a persistent profile and unpacked extensions.
import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS = path.dirname(fileURLToPath(import.meta.url));
export const OFFICIAL_DIR = path.join(HARNESS, 'ext-official');
export const OFFICIAL_ID = 'pnhplgjpclknigjpccbcnmicgcieojbh'; // manifest carries the store key, so the id is stable
export const PROFILE_DIR = path.join(HARNESS, 'profile');

export async function launch({ extensions = [OFFICIAL_DIR], headless = false, profile = PROFILE_DIR, extraArgs = [] } = {}) {
  const list = extensions.join(',');
  const args = [
    `--disable-extensions-except=${list}`,
    `--load-extension=${list}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1400,900',
    '--disable-features=ExtensionManifestV2Unsupported',
    ...extraArgs,
  ];
  const browser = await puppeteer.launch({ headless, userDataDir: profile, args, defaultViewport: null, ignoreDefaultArgs: ['--disable-extensions'] });
  return browser;
}

/** The extension's service worker (puppeteer WebWorker) — waits for it to start. */
export async function serviceWorker(browser, extId, timeout = 15000) {
  const t = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(extId), { timeout });
  return t.worker();
}

/** Stop every service worker (simulates Chrome's idle termination of the extension worker). */
export async function stopWorkers(browser) {
  const cdp = await browser.target().createCDPSession();
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Collect console output of a page or worker into an array. */
export function tapConsole(target, sink, label = '') {
  target.on('console', (m) => sink.push(`${label}[${m.type()}] ${m.text()}`));
  if (target.on && target.pageerror !== undefined) target.on('pageerror', (e) => sink.push(`${label}[pageerror] ${e.message}`));
}

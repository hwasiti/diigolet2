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
  // The persistent profile restores the previous run's tabs; close them so tab lookups by URL are unambiguous.
  await sleep(300);
  const pages = await browser.pages();
  for (const p of pages.slice(1)) await p.close().catch(() => {});
  if (pages[0] && pages[0].url() !== 'about:blank') await pages[0].goto('about:blank').catch(() => {});
  return browser;
}

/** The extension's service worker (puppeteer WebWorker) — waits for it to start. */
export async function serviceWorker(browser, extId, timeout = 15000) {
  const t = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(extId), { timeout });
  return t.worker();
}

const statusIn = (page, extId) => page.evaluate((id) => {
  const scope = "chrome-extension://" + id + "/";
  const boxes = [...document.querySelectorAll("div")].filter((el) => el.textContent.includes(scope) && /Running Status:/.test(el.textContent));
  boxes.sort((a, b) => a.textContent.length - b.textContent.length);
  const m = boxes[0] && /Running Status:\s*([A-Z_]+)/.exec(boxes[0].textContent);
  return m ? m[1] : "UNKNOWN";
}, extId);

/** Running status of an extension worker as chrome://serviceworker-internals reports it (RUNNING, STOPPED, ...). */
export async function workerStatus(browser, extId) {
  const page = await browser.newPage();
  await page.goto("chrome://serviceworker-internals/", { waitUntil: "load" });
  let r = "UNKNOWN";
  for (let i = 0; i < 10 && r === "UNKNOWN"; i++) { await sleep(300); r = await statusIn(page, extId); }
  await page.close();
  return r;
}

/**
 * Stop the extension service worker through chrome://serviceworker-internals, as Chrome does after 30 s idle.
 * Note: the official extension listens to tab events, so closing the internals tab already starts a NEW instance;
 * what matters for the tests is that the next event is served by a fresh worker (globals reset).
 */
export async function stopWorkers(browser, extId) {
  const page = await browser.newPage();
  await page.goto("chrome://serviceworker-internals/", { waitUntil: "load" });
  let stopped = false;
  for (let attempt = 0; attempt < 5 && !stopped; attempt++) {
    await sleep(400);
    await page.evaluate((id) => {
      for (const b of document.querySelectorAll("cr-button[data-command=stop]")) {
        let box = b; for (let k = 0; k < 8 && box && !box.textContent.includes("chrome-extension://" + id + "/"); k++) box = box.parentElement;
        if (box && !b.hasAttribute("disabled")) b.click();
      }
    }, extId);
    for (let i = 0; i < 10 && !stopped; i++) { await sleep(150); stopped = (await statusIn(page, extId)) === "STOPPED"; }
  }
  await page.close();
  return stopped;
}

/**
 * Evaluate in the extension worker over a fresh CDP session. A service worker keeps its DevTools target across
 * stop/start, so puppeteer's cached WebWorker handle dies with the old instance; a new session always works.
 */
export async function swEval(browser, extId, fn, ...args) {
  const t = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(extId), { timeout: 15000 });
  const s = await t.createCDPSession();
  try {
    const r = await s.send("Runtime.evaluate", { expression: "(" + fn.toString() + ")(" + args.map((a) => JSON.stringify(a)).join(",") + ")", awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("worker eval failed: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  } finally { await s.detach().catch(() => {}); }
}

/** Console/exception tap on the worker target over its own session (survives worker restarts). */
export async function tapWorkerLog(browser, extId, sink) {
  const t = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(extId), { timeout: 15000 });
  const s = await t.createCDPSession();
  await s.send("Runtime.enable");
  s.on("Runtime.consoleAPICalled", (e) => sink.push("[sw " + e.type + "] " + e.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)));
  s.on("Runtime.exceptionThrown", (e) => sink.push("[sw EXC] " + (e.exceptionDetails.exception?.description || e.exceptionDetails.text).slice(0, 300)));
  return s;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Collect console output of a page or worker into an array. */
export function tapConsole(target, sink, label = '') {
  target.on('console', (m) => sink.push(`${label}[${m.type()}] ${m.text()}`));
  if (target.on && target.pageerror !== undefined) target.on('pageerror', (e) => sink.push(`${label}[pageerror] ${e.message}`));
}

#!/usr/bin/env node
// Drive Chrome on an Android phone over adb for testing the bookmarklet on a real device.
//
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//   node tools/phone.mjs tabs
//   node tools/phone.mjs inject <tab> dist/bookmarklet.dev.js       # run the bundle in the page (like a bookmarklet)
//   node tools/phone.mjs eval <tab> "JSON.stringify(window.__dl2.debug.state())"
//   node tools/phone.mjs tap <tab> <cssX> <cssY>                     # real touch tap (user gesture)
//   node tools/phone.mjs penTap <tab>                                # tap the Diigolet pen (bottom-right)
//   node tools/phone.mjs shot <tab> out.png                          # page screenshot (CSS viewport)
//
// <tab> is a tab id from `tabs` or a substring of its URL. Node 22+ (global fetch and WebSocket).
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const [cmd, tabArg, ...rest] = process.argv.slice(2);

async function listTabs() {
  const res = await fetch(`http://localhost:${PORT}/json`);
  return (await res.json()).filter((t) => t.type === 'page');
}

async function pickTab(arg) {
  const tabs = await listTabs();
  const t = tabs.find((x) => x.id === arg) || tabs.find((x) => x.url.includes(arg));
  if (!t) throw new Error(`no tab matching ${arg}`);
  return t;
}

const CONNECT_TIMEOUT = Number(process.env.CDP_CONNECT_TIMEOUT || 8000);
const CALL_TIMEOUT = Number(process.env.CDP_CALL_TIMEOUT || 30000);

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    const listeners = [];
    const connectTimer = setTimeout(() => { reject(new Error(`connect timeout (${CONNECT_TIMEOUT} ms): is the tab frozen or the phone locked?`)); ws.close(); }, CONNECT_TIMEOUT);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        clearTimeout(p.timer);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else if (m.method) {
        for (const fn of listeners) fn(m);
      }
    });
    ws.addEventListener('open', () => {
      clearTimeout(connectTimer);
      resolve({
        send: (method, params = {}) => new Promise((res, rej) => {
          const id = ++seq;
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method} timed out after ${CALL_TIMEOUT} ms (tab frozen or in the background?)`)); }, CALL_TIMEOUT);
          pending.set(id, { resolve: res, reject: rej, timer });
          ws.send(JSON.stringify({ id, method, params }));
        }),
        close: () => ws.close(),
        on: (fn) => listeners.push(fn),
      });
    });
    ws.addEventListener('close', () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('websocket closed')); } pending.clear(); });
    ws.addEventListener('error', (e) => { clearTimeout(connectTimer); reject(new Error('websocket error ' + (e.message || ''))); });
  });
}

async function evaluate(cdp, expression, gesture = false) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture });
  if (r.exceptionDetails) throw new Error('page exception: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

async function tap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await new Promise((r) => setTimeout(r, 60));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function main() {
  if (!cmd || cmd === 'tabs') {
    for (const t of await listTabs()) console.log(`${t.id} | ${t.title.slice(0, 50)} | ${t.url.slice(0, 100)}`);
    return;
  }
  const tab = await pickTab(tabArg);
  const cdp = await connect(tab.webSocketDebuggerUrl);
  try {
    if (cmd === 'inject') {
      const code = readFileSync(rest[0], 'utf8');
      await evaluate(cdp, code + '\n"injected"', true);
      console.log('injected into', tab.url);
    } else if (cmd === 'eval') {
      const gesture = rest.includes('--gesture');
      console.log(await evaluate(cdp, rest.filter((a) => a !== '--gesture').join(' '), gesture));
    } else if (cmd === 'tap') {
      await tap(cdp, Number(rest[0]), Number(rest[1]));
      console.log('tapped', rest[0], rest[1]);
    } else if (cmd === 'penTap') {
      const size = await evaluate(cdp, 'JSON.stringify({w: innerWidth, h: innerHeight})');
      const { w, h } = JSON.parse(size);
      await tap(cdp, w - 36, h - 36);
      console.log(`tapped pen at ${w - 36},${h - 36} (viewport ${w}x${h})`);
    } else if (cmd === 'shot') {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(rest[0], Buffer.from(r.data, 'base64'));
      console.log('saved', rest[0]);
    } else if (cmd === 'metrics') {
      console.log(JSON.stringify(await cdp.send('Page.getLayoutMetrics')));
    } else if (cmd === 'listen') {
      // Print exceptions and console output from the tab for N seconds (e.g. while a bookmark is tapped).
      const seconds = Number(rest[0] || 15);
      await cdp.send('Runtime.enable');
      await cdp.send('Log.enable');
      cdp.on((m) => {
        if (m.method === 'Runtime.exceptionThrown') {
          const d = m.params.exceptionDetails;
          console.log('EXCEPTION', d.text, d.exception && d.exception.description, 'line', d.lineNumber, 'col', d.columnNumber, 'url', d.url);
        } else if (m.method === 'Runtime.consoleAPICalled') {
          console.log('CONSOLE', m.params.type, m.params.args.map((a) => a.value ?? a.description).join(' '));
        } else if (m.method === 'Log.entryAdded') {
          console.log('LOG', m.params.entry.level, m.params.entry.text.slice(0, 300));
        }
      });
      console.log(`listening on ${tab.url.slice(0, 60)} for ${seconds}s`);
      await new Promise((r) => setTimeout(r, seconds * 1000));
    } else {
      throw new Error('unknown command ' + cmd);
    }
  } finally {
    cdp.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });

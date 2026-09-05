// Builds the bookmarklet client, the helper bundle and the static site into docs/ (served by GitHub Pages).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
// Build stamp: GitHub Pages caches files for ten minutes, so every helper URL carries the stamp of the
// build that produced it and a new bookmarklet always fetches matching helper code.
const BUILD = Date.now().toString(36);
// Chrome for Android refuses to store a bookmark address longer than this (and Chrome Sync drops big ones).
const MAX_BOOKMARKLET = 5000;
const define = { __VERSION__: JSON.stringify(pkg.version), __BUILD__: JSON.stringify(BUILD) };
const target = ['chrome105', 'firefox140', 'safari17'];

async function bundle(entry, extra = {}) {
  const r = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'iife', target, charset: 'utf8', legalComments: 'none', write: false, define, ...extra });
  return r.outputFiles[0].text.trim();
}

// A javascript: URL is percent-decoded before it runs, so literal % signs, whitespace and # must be encoded.
const encodeBookmarklet = (code) => 'javascript:' + code.replace(/[%#\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase());

const client = await bundle('src/lite/lite.js');
if (!client.includes('"%%DL2_CFG%%"')) throw new Error('config placeholder was optimised away');
const helper = await bundle('src/helper/main.js');

const sampleUrl = encodeBookmarklet(client.replace('"%%DL2_CFG%%"', JSON.stringify({ h: 'https://hwasiti.github.io/diigolet2' })));
if (sampleUrl.length > MAX_BOOKMARKLET) throw new Error(`bookmarklet is ${sampleUrl.length} chars; Android Chrome allows ${MAX_BOOKMARKLET}`);

mkdirSync('dist', { recursive: true });
if (existsSync('docs')) rmSync('docs', { recursive: true, force: true });
mkdirSync('docs', { recursive: true });
writeFileSync('dist/client.js', client);
cpSync('src/site', 'docs', { recursive: true });
const stamp = (s) => s.replaceAll('%%DL2_BUILD%%', BUILD).replaceAll('%%DL2_VERSION%%', pkg.version);
const install = readFileSync('src/site/install.js', 'utf8');
const marker = "/*__BOOKMARKLET_CODE__*/''";
if (!install.includes(marker)) throw new Error('install.js marker missing');
writeFileSync('docs/install.js', stamp(install.replace(marker, JSON.stringify(client))));
writeFileSync('docs/helper.js', helper);
writeFileSync('docs/index.html', stamp(readFileSync('src/site/index.html', 'utf8')));
writeFileSync('docs/helper.html', stamp(readFileSync('src/site/helper.html', 'utf8')));
writeFileSync('docs/.nojekyll', '');

// Developer bundle for automated tests: helper origin from DL2_HELPER (default localhost).
const devCfg = { h: process.env.DL2_HELPER || 'http://localhost:8765' };
writeFileSync('dist/client.dev.js', client.replace('"%%DL2_CFG%%"', JSON.stringify(devCfg)));

console.log(`client ${client.length} chars, bookmarklet URL ${sampleUrl.length}/${MAX_BOOKMARKLET}; helper ${helper.length} chars; build ${BUILD}`);

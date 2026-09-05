// Builds the bookmarklet bundle and the static helper/install site into dist/.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const result = await build({
  entryPoints: ['src/bookmarklet/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome105', 'firefox115', 'safari16'],
  charset: 'utf8',
  legalComments: 'none',
  write: false,
  define: { __VERSION__: JSON.stringify(pkg.version) },
});
const code = result.outputFiles[0].text.trim();
if (!code.includes('"%%DL2_CFG%%"')) throw new Error('config placeholder was optimised away');

// The static site (install page + helper) is written to docs/ so GitHub Pages can serve it from the repo.
mkdirSync('dist', { recursive: true });
mkdirSync('docs', { recursive: true });
writeFileSync('dist/bookmarklet.js', code);
cpSync('src/site', 'docs', { recursive: true });
const install = readFileSync('src/site/install.js', 'utf8');
const marker = "/*__BOOKMARKLET_CODE__*/''";
if (!install.includes(marker)) throw new Error('install.js marker missing');
writeFileSync('docs/install.js', install.replace(marker, JSON.stringify(code)));
writeFileSync('docs/.nojekyll', '');

// Developer build for automated tests: helper on localhost.
const devCfg = { h: process.env.DL2_HELPER || 'http://localhost:8765', u: process.env.DL2_USER || '' };
if (process.env.DL2_ONESHOT) devCfg.o = Number(process.env.DL2_ONESHOT); // 1 forces the phone path, 0 the desktop path
writeFileSync('dist/bookmarklet.dev.js', code.replace('"%%DL2_CFG%%"', JSON.stringify(devCfg)));

console.log(`bookmarklet ${code.length} bytes (${(code.length / 1024).toFixed(1)} KB) -> dist/bookmarklet.js, docs/`);

// Bundles the extension's scripts into extension/dist/ (gitignored). Load `extension/` unpacked afterwards.
import { build } from 'esbuild';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const minify = process.argv.includes('--minify');
const entries = ['bg', 'content', 'popup', 'options'];

mkdirSync(path.join(here, 'dist'), { recursive: true });
const result = await build({
  entryPoints: entries.map((e) => path.join(here, 'src', e + '.js')),
  outdir: path.join(here, 'dist'),
  bundle: true, format: 'iife', target: ['chrome116'], charset: 'utf8', legalComments: 'none', minify,
  define: { __VERSION__: JSON.stringify(manifest.version) },
  logLevel: 'warning',
});
if (result.errors.length) process.exit(1);

// Every file the manifest points at must exist.
const refs = [manifest.background.service_worker, ...manifest.content_scripts.flatMap((c) => c.js), manifest.action.default_popup, manifest.options_ui.page, ...Object.values(manifest.icons)];
const missing = refs.filter((f) => !existsSync(path.join(here, f)));
if (missing.length) { console.error('manifest references missing files:', missing.join(', ')); process.exit(1); }
console.log(`extension ${manifest.version} built: ${entries.map((e) => 'dist/' + e + '.js').join(', ')}${minify ? ' (minified)' : ''}`);

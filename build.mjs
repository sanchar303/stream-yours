/**
 * Build script — no bundler needed, the app is plain HTML/CSS/JS.
 *
 *   node scripts/build.mjs            copy the public files into ./dist and stamp the service-worker version
 *   node scripts/build.mjs --check    only verify that every required file exists and every local reference resolves
 *
 * Optional environment variables
 *   SITE_URL   e.g. https://watch.example.com  → rewrites the canonical URL in index.html, sitemap.xml, robots.txt, llms.txt
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const checkOnly = process.argv.includes('--check');
const DEFAULT_SITE = 'https://stream-yours.pages.dev';

const PUBLIC_FILES = [
  'index.html', 'style.css', 'app.js', 'sw.js', 'manifest.webmanifest', '404.html',
  'favicon.png', 'favicon.ico', 'og-image.png',
  'robots.txt', 'sitemap.xml', 'llms.txt', 'google450a35d41fc058df.html',
  '_headers', '_redirects'
];
const PUBLIC_DIRS = ['icons', 'vendor'];

const missing = [...PUBLIC_FILES, ...PUBLIC_DIRS].filter((p) => !existsSync(join(root, p)));
if (missing.length) {
  console.error('Missing required files:\n  - ' + missing.join('\n  - '));
  process.exit(1);
}

/* Every local file referenced from index.html and the manifest must exist, or the deploy ships a broken page. */
function localRefs(text) {
  const refs = new Set();
  for (const m of text.matchAll(/(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
    const ref = m[1];
    if (/^(https?:|data:|mailto:|\/\/|\?)/.test(ref)) continue;
    refs.add(ref.replace(/^\//, ''));
  }
  return [...refs];
}
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
const manifestRefs = (manifest.icons || []).map((i) => i.src);
const broken = [...localRefs(readFileSync(join(root, 'index.html'), 'utf8')), ...manifestRefs]
  .filter((ref) => ref && !existsSync(join(root, ref)));
if (broken.length) {
  console.error('Broken local references:\n  - ' + broken.join('\n  - '));
  process.exit(1);
}

if (checkOnly) {
  console.log('✓ All required files and local references are present.');
  process.exit(0);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const f of PUBLIC_FILES) cpSync(join(root, f), join(dist, f));
for (const d of PUBLIC_DIRS) cpSync(join(root, d), join(dist, d), { recursive: true });

/* Version stamp so returning visitors always receive fresh files. */
let sha = '';
try { sha = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git repo */ }
const buildId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}${sha ? '-' + sha : ''}`;
const swPath = join(dist, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
if (!/const BUILD_ID = '[^']*';/.test(sw)) {
  console.error('sw.js is missing the BUILD_ID constant');
  process.exit(1);
}
writeFileSync(swPath, sw.replace(/const BUILD_ID = '[^']*';/, `const BUILD_ID = '${buildId}';`));

/* Custom domain support */
const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
if (siteUrl && siteUrl !== DEFAULT_SITE) {
  for (const f of ['index.html', 'sitemap.xml', 'robots.txt', 'llms.txt', 'app.js']) {
    const p = join(dist, f);
    writeFileSync(p, readFileSync(p, 'utf8').split(DEFAULT_SITE).join(siteUrl));
  }
  console.log(`✓ Canonical URLs rewritten to ${siteUrl}`);
}

function size(dir) {
  return readdirSync(dir).reduce((sum, name) => {
    const p = join(dir, name);
    return sum + (statSync(p).isDirectory() ? size(p) : statSync(p).size);
  }, 0);
}
console.log(`✓ Built ./dist (${(size(dist) / 1024).toFixed(0)} KB) — service worker version ${buildId}`);

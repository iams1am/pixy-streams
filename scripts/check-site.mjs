#!/usr/bin/env node
/**
 * Post-build checks for the generated site.
 *
 *   hugo --gc --minify
 *   node scripts/check-site.mjs          # checks ./public
 *   node scripts/check-site.mjs dist     # or another output directory
 *
 * Catches the failures that are invisible in a Hugo build log: internal links
 * that miss the GitHub Pages subpath, dead hrefs, missing alt text or document
 * metadata, duplicate ids, a malformed search index and leaked credentials.
 *
 * CI runs this after the catalogue refresh and before the artifact is uploaded,
 * so a broken build never reaches production.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'public');

const SECRET_PATTERNS = [
  /api_key=[A-Za-z0-9]{8,}/i,
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
  /TMDB_(?:API_KEY|READ_TOKEN)/,
  /SPORTSDB_KEY/,
];

const failures = [];
const checks = [];

function fail(message) {
  failures.push(message);
}

function check(name, run) {
  const before = failures.length;
  run();
  checks.push({ name, failures: failures.length - before });
}

function htmlFiles(dir) {
  const files = [];
  (function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) files.push(full);
    }
  })(dir);
  return files;
}

function relative(file) {
  return path.relative(OUT, file).split(path.sep).join('/');
}

if (!existsSync(OUT) || !statSync(OUT).isDirectory()) {
  console.error(`✗ output directory not found: ${OUT}\n  Run "hugo --gc --minify" first.`);
  process.exit(1);
}

/** The deployment subpath, e.g. "/pixy-streams/". */
const basePath = (() => {
  const config = readFileSync(path.join(ROOT, 'hugo.toml'), 'utf8');
  const match = config.match(/^baseURL\s*=\s*"([^"]+)"/m);
  if (!match) return '/';
  try {
    const { pathname } = new URL(match[1]);
    return pathname.endsWith('/') ? pathname : `${pathname}/`;
  } catch {
    return '/';
  }
})();

const pages = htmlFiles(OUT);

check('required files', () => {
  for (const file of ['index.html', '404.html', 'search.json', 'sitemap.xml']) {
    if (!existsSync(path.join(OUT, file))) fail(`missing ${file}`);
  }
});

check('internal links resolve', () => {
  const brokenInternal = new Map();
  const brokenBase = new Map();
  let refs = 0;

  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    // Minified HTML drops the quotes around simple values, so match both forms.
    for (const match of html.matchAll(/(?:href|src)=(?:"([^"]*)"|([^\s>"']+))/g)) {
      const url = match[1] ?? match[2] ?? '';
      if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) continue;
      refs += 1;

      if (!url.startsWith(basePath)) {
        brokenBase.set(`${relative(file)} → ${url}`, true);
        continue;
      }

      const clean = url.slice(basePath.length).split('#')[0].split('?')[0];
      const target = path.join(OUT, clean === '' || clean.endsWith('/') ? path.join(clean, 'index.html') : clean);
      if (!existsSync(target)) brokenInternal.set(`${relative(file)} → ${url}`, true);
    }
  }

  for (const line of [...brokenBase.keys()].slice(0, 10)) fail(`missing base path: ${line}`);
  for (const line of [...brokenInternal.keys()].slice(0, 10)) fail(`dead link: ${line}`);
  if (refs === 0) fail('no internal references found');
  checks.push({ name: 'references scanned', failures: 0, note: String(refs) });
});

check('document metadata', () => {
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const name = relative(file);
    if (!/<html[^>]+lang=/.test(html)) fail(`${name}: missing <html lang>`);
    if (!/<title>[^<]+<\/title>/.test(html)) fail(`${name}: missing <title>`);
    if (!/<meta[^>]+name="?description"?/.test(html)) fail(`${name}: missing meta description`);
    if (!/<link[^>]+rel="?canonical"?/.test(html)) fail(`${name}: missing canonical link`);
    if ((html.match(/<h1[\s>]/g) || []).length !== 1) fail(`${name}: expected exactly one <h1>`);
  }
});

check('accessible markup', () => {
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const name = relative(file);

    for (const match of html.matchAll(/<img\b[^>]*>/g)) {
      if (!/\salt=/.test(match[0])) fail(`${name}: img without alt → ${match[0].slice(0, 80)}`);
    }

    for (const match of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      const text = match[1].replace(/<[^>]*>/g, '').trim();
      if (!text && !/aria-label=/.test(match[0])) fail(`${name}: unnamed button → ${match[0].slice(0, 80)}`);
    }

    const seen = new Set();
    for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
      if (seen.has(match[1])) fail(`${name}: duplicate id #${match[1]}`);
      seen.add(match[1]);
    }
  }
});

check('search index', () => {
  const index = JSON.parse(readFileSync(path.join(OUT, 'search.json'), 'utf8'));
  if (!Array.isArray(index) || !index.length) {
    fail('search.json is not a non-empty array');
    return;
  }

  const urls = new Set();
  const kinds = new Set();
  for (const entry of index) {
    if (!entry.title || !entry.url) fail(`search entry missing title or url: ${JSON.stringify(entry).slice(0, 80)}`);
    if (urls.has(entry.url)) fail(`duplicate search url: ${entry.url}`);
    urls.add(entry.url);
    kinds.add(entry.kind);
  }

  for (const kind of ['movie', 'series', 'anime', 'event']) {
    if (!kinds.has(kind)) fail(`search index has no ${kind} entries`);
  }
  checks.push({ name: 'search entries', failures: 0, note: String(index.length) });
});

check('no leaked credentials', () => {
  for (const file of [...pages, path.join(OUT, 'search.json')]) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) fail(`${relative(file)}: matches ${pattern}`);
    }
  }
});

const totalRefs = checks.find((item) => item.name === 'references scanned')?.note;
const totalEntries = checks.find((item) => item.name === 'search entries')?.note;

for (const item of checks) {
  if (!item.note) console.log(`${item.failures ? '✗' : '✓'} ${item.name}${item.failures ? ` (${item.failures} problem${item.failures === 1 ? '' : 's'})` : ''}`);
}
console.log(`\n${pages.length} pages · base path ${basePath}${totalRefs ? ` · ${totalRefs} references` : ''}${totalEntries ? ` · ${totalEntries} search entries` : ''}`);

if (failures.length) {
  console.error(`\n${failures.length} check${failures.length === 1 ? '' : 's'} failed:`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log('All checks passed.');

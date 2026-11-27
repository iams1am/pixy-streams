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
  for (const file of ['index.html', '404.html', 'search.json', 'sitemap.xml', 'robots.txt', 'search/index.html']) {
    if (!existsSync(path.join(OUT, file))) fail(`missing ${file}`);
  }
});

check('robots.txt', () => {
  const robots = readFileSync(path.join(OUT, 'robots.txt'), 'utf8');
  if (!/^User-agent: \*$/m.test(robots)) fail('robots.txt: no wildcard user-agent rule');
  const sitemap = robots.match(/^Sitemap: (.+)$/m)?.[1] || '';
  if (!sitemap.startsWith('https://') || !sitemap.includes(basePath)) {
    fail(`robots.txt: sitemap is not an absolute deployment URL (${sitemap || 'missing'})`);
  }
});

check('search page', () => {
  const home = readFileSync(path.join(OUT, 'index.html'), 'utf8');
  if (!home.includes('data-search-page-url=')) fail('homepage: header search has no full-page link');

  const page = readFileSync(path.join(OUT, 'search', 'index.html'), 'utf8');
  for (const marker of ['data-search-page', 'data-search-page-input', 'data-search-page-results', 'data-search-page-filters', 'data-search-page-types', 'data-search-page-genres']) {
    if (!page.includes(marker)) fail(`search page: missing ${marker}`);
  }
  if (!/<label[^>]*for=(?:"search-page-input"|search-page-input)/.test(page)) fail('search page: field has no label');
  if (!/\sname=(?:"q"|q)(?=[\s>])/.test(page)) fail('search page: field is not named q');
});

check('sports calendars', () => {
  const scheduledPages = pages
    .filter((file) => relative(file).startsWith('sports/'))
    .map((file) => ({ file, html: readFileSync(file, 'utf8') }))
    .filter((page) => /data-event-state=(?:"scheduled"|scheduled)/.test(page.html));

  if (!scheduledPages.length) {
    checks.push({ name: 'calendar files', failures: 0, note: '0 scheduled' });
    return;
  }

  const scheduled = scheduledPages.filter((page) => page.html.includes('Add to calendar'));
  if (!scheduled.length) {
    fail('scheduled event pages have no calendar download');
    return;
  }

  let count = 0;
  for (const { file, html } of scheduled) {
    const match = html.match(/href=(?:"([^"]*\.ics)"|([^\s>"']+\.ics))/);
    if (!match) {
      fail(`${relative(file)}: calendar button has no .ics link`);
      continue;
    }

    const href = match[1] ?? match[2] ?? '';
    if (!href.startsWith(basePath)) {
      fail(`${relative(file)}: calendar link misses the base path (${href})`);
      continue;
    }

    const icsFile = path.join(OUT, href.slice(basePath.length));
    if (!existsSync(icsFile)) {
      fail(`${relative(file)}: missing ${href}`);
      continue;
    }

    const ics = readFileSync(icsFile, 'utf8');
    for (const marker of ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:', 'SUMMARY:', 'END:VEVENT', 'END:VCALENDAR']) {
      if (!ics.includes(marker)) fail(`${relative(icsFile)}: missing ${marker}`);
    }
    if (!/^DTSTART:\d{8}T\d{6}Z$/m.test(ics)) fail(`${relative(icsFile)}: DTSTART is not a UTC timestamp`);
    if (!/^DURATION:PT\d+H$/m.test(ics)) fail(`${relative(icsFile)}: DURATION is missing`);
    if (!/^SUMMARY:[^\r\n]+$/m.test(ics)) fail(`${relative(icsFile)}: SUMMARY is empty`);
    if (!/^X-WR-CALNAME:[^\r\n]+$/m.test(ics)) fail(`${relative(icsFile)}: X-WR-CALNAME is empty`);
    if (!/^DESCRIPTION:.*\\;/m.test(ics)) fail(`${relative(icsFile)}: DESCRIPTION is not iCalendar-escaped`);
    count += 1;
  }

  if (count) checks.push({ name: 'calendar files', failures: 0, note: String(count) });
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
      // The minifier writes an empty alt as a bare `alt` attribute, which is
      // still valid and still marks the image as decorative.
      if (!/\salt(?=[\s=>])/.test(match[0])) fail(`${name}: img without alt → ${match[0].slice(0, 80)}`);
    }

    for (const match of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      const text = match[1].replace(/<[^>]*>/g, '').trim();
      if (!text && !/aria-label=/.test(match[0])) fail(`${name}: unnamed button → ${match[0].slice(0, 80)}`);
    }

    for (const match of html.matchAll(/<iframe\b[^>]*>/g)) {
      if (!/\stitle=/.test(match[0])) fail(`${name}: iframe without title → ${match[0].slice(0, 80)}`);
    }

    const seen = new Set();
    for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
      if (seen.has(match[1])) fail(`${name}: duplicate id #${match[1]}`);
      seen.add(match[1]);
    }

    if (!/class=(?:"skip-link"|skip-link)[^>]*href=(?:"#main-content"|#main-content)/.test(html)) {
      fail(`${name}: missing skip link to #main-content`);
    }
    if (!/<main[^>]*\sid=(?:"main-content"|main-content)/.test(html)) {
      fail(`${name}: main landmark has no id="main-content"`);
    }
    if (/\stabindex=(?:"[1-9]|[1-9])/.test(html)) fail(`${name}: positive tabindex`);

    for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
      const text = match[1].replace(/<[^>]*>/g, "").trim();
      const altText = [...match[1].matchAll(/\salt=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
        .map((m) => (m[1] ?? m[2] ?? m[3] ?? "").trim())
        .join("");
      if (!text && !altText && !/aria-label=/.test(match[0]) && !/<img\b/.test(match[1])) {
        fail(`${name}: link without an accessible name → ${match[0].slice(0, 80)}`);
      }
    }

    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i] - levels[i - 1] > 1) {
        fail(`${name}: heading jumps h${levels[i - 1]} → h${levels[i]}`);
        break;
      }
    }
  }
});

check('image dimensions', () => {
  for (const file of pages) {
    const html = readFileSync(file, "utf8");
    for (const match of html.matchAll(/<img\b[^>]*>/g)) {
      if (!/\swidth=/.test(match[0]) || !/\sheight=/.test(match[0])) {
        fail(`${relative(file)}: img without width and height → ${match[0].slice(0, 90)}`);
      }
    }
  }
});

check('homepage', () => {
  const home = readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const hasId = (id) => new RegExp(`\\bid=(?:"${id}"|${id})(?=[\\s>])`).test(home);
  const sectionTag = (marker) => home.match(new RegExp(`<section[^>]*${marker}[^>]*>`))?.[0] || '';

  if (!/class=(?:"hero hero-featured"|hero hero-featured)/.test(home)) {
    fail('homepage: missing featured hero');
  }
  if (!/class=(?:"hero-title"|hero-title)/.test(home)) {
    fail('homepage: missing hero headline');
  }
  if (!hasId('genres') || !home.includes('data-category-filter')) {
    fail('homepage: missing category filter');
  }

  for (const id of ['free-films', 'trending', 'anime', 'new-additions', 'sports']) {
    if (!hasId(id)) fail(`homepage: missing ${id} rail`);
  }

  for (const heading of ['Trending now', 'New additions', 'Sports this week']) {
    if (!home.includes(heading)) fail(`homepage: missing "${heading}" rail heading`);
  }

  const newAdditions = home.match(/<section[^>]*id=(?:"new-additions"|new-additions)[^>]*>([\s\S]*?)<\/section>/)?.[1] || '';
  if (!newAdditions.includes('rail-card')) fail('homepage: New additions rail has no titles');

  for (const marker of ['data-home-continue', 'data-home-recommend']) {
    const tag = sectionTag(marker);
    if (!tag) fail(`homepage: missing ${marker} section`);
    else if (!/\shidden(?:\s|>|=)/.test(tag)) fail(`homepage: ${marker} must ship hidden`);
  }

  if (!home.includes('data-home-watch')) fail('homepage: missing Continue watching data');
  if (!home.includes('data-home-recommend-data')) fail('homepage: missing recommendation data');
});

check('navigation state', () => {
  const cases = [
    ['index.html', 'page', 'Home'],
    ['movies/index.html', 'page', 'Movies'],
    ['movies/dune-part-two/index.html', 'true', 'Movies']
  ];

  for (const [file, token, label] of cases) {
    const full = path.join(OUT, file);
    if (!existsSync(full)) {
      fail(`navigation: missing ${file}`);
      continue;
    }

    const html = readFileSync(full, 'utf8');
    const nav = html.match(/<ul[^>]*class=(?:"navbar-nav"|navbar-nav)[^>]*>([\s\S]*?)<\/ul>/)?.[1] || '';
    const current = [...nav.matchAll(/<a[^>]*aria-current=(?:"([^"]+)"|([^\s>]+))[^>]*>([^<]*)/g)]
      .map(match => [match[1] || match[2], match[3].trim()]);

    if (current.length !== 1) fail(`navigation: ${file} marks ${current.length} current links`);
    else if (current[0][0] !== token || current[0][1] !== label) {
      fail(`navigation: ${file} marks ${current[0][1]} as ${current[0][0]}, expected ${label} as ${token}`);
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

  for (const kind of ['movie', 'series', 'anime', 'event', 'sample']) {
    if (!kinds.has(kind)) fail(`search index has no ${kind} entries`);
  }
  checks.push({ name: 'search entries', failures: 0, note: String(index.length) });
});

check('watch pages', () => {
  const samplesFile = path.join(ROOT, 'data', 'playback', 'samples.json');
  const registryFile = path.join(ROOT, 'data', 'playback', 'registry.json');

  if (!existsSync(samplesFile) || !existsSync(registryFile)) {
    fail('missing data/playback samples.json or registry.json');
    return;
  }

  const samples = JSON.parse(readFileSync(samplesFile, 'utf8'));
  const registry = JSON.parse(readFileSync(registryFile, 'utf8'));
  const sources = new Map((registry.sources || []).map((source) => [source.id, source]));
  const items = Array.isArray(samples.items) ? samples.items : [];

  if (!items.length) {
    fail('samples.json has no items');
    return;
  }

  const libraryFile = path.join(OUT, 'watch', 'index.html');
  if (!existsSync(libraryFile)) {
    fail('missing watch library: /watch/');
  } else {
    const library = readFileSync(libraryFile, 'utf8');
    if (!library.includes('data-watch-continue') || !library.includes('data-watch-continue-grid')) {
      fail('/watch/: missing Continue Watching container');
    }
    if (!library.includes('data-watch-id=')) {
      fail('/watch/: library cards have no progress id');
    }
  }

  for (const item of items) {
    const file = path.join(OUT, 'watch', item.slug, 'index.html');
    if (!existsSync(file)) {
      fail(`missing watch page: /watch/${item.slug}/`);
      continue;
    }

    const source = sources.get(item.source_id);
    if (!source) {
      fail(`${item.id}: no registry source ${item.source_id}`);
      continue;
    }

    const html = readFileSync(file, 'utf8');
    const videoSources = [...html.matchAll(/<source\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/g)]
      .map((match) => match[1] || match[2] || match[3]);

    if (!/<video\b[^>]*\bcontrols\b/.test(html) || !html.includes('data-watch-video')) {
      fail(`${item.slug}: missing native video player`);
    }
    if (!html.includes('data-watch-resume')) {
      fail(`${item.slug}: missing resume control`);
    }
    if (!html.includes('data-watch-slow')) {
      fail(`${item.slug}: missing slow-stream notice`);
    }
    const playsVerified = videoSources.some((raw) => {
      try {
        const played = new URL(raw);
        const verified = new URL(source.url);
        return (
          played.hostname === verified.hostname &&
          decodeURIComponent(played.pathname) === decodeURIComponent(verified.pathname)
        );
      } catch {
        return false;
      }
    });
    if (!playsVerified) {
      fail(`${item.slug}: player does not use the verified MP4 ${source.identifier}/${source.file}`);
    }
    if (/<iframe\b/.test(html)) {
      fail(`${item.slug}: watch page still renders an iframe player`);
    }
    if (!html.includes('Rights and source')) fail(`${item.slug}: missing rights panel`);
    if (!html.includes('Last verified')) fail(`${item.slug}: missing verification date`);
    if (!html.includes(`/watch/`)) fail(`${item.slug}: missing link back to the library`);
  }

  checks.push({ name: 'watch pages', failures: 0, note: String(items.length) });
});

check('playback states', () => {
  const states = ['play_here', 'official_provider', 'trailer_only', 'unavailable'];
  let declared = 0;

  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const isWatch = html.includes('class=watch-detail') || html.includes('class="watch-detail"');
    const isCatalog = html.includes('class=catalog-detail') || html.includes('class="catalog-detail"');
    if (!isWatch && !isCatalog) continue;

    const match = html.match(/data-playback-state=(?:"([a-z_]+)"|([a-z_]+))/);
    if (!match) {
      fail(`${relative(file)}: no data-playback-state`);
      continue;
    }

    const state = match[1] || match[2];
    if (!states.includes(state)) {
      fail(`${relative(file)}: unknown playback state "${state}"`);
      continue;
    }
    declared += 1;

    const hasEmbed = /<iframe\b/.test(html) || /<video\b/.test(html);
    const hasProviders = html.includes('Where to watch');
    const hasTrailer = /data-trailer=/.test(html);

    if (state === 'play_here' && !hasEmbed) fail(`${relative(file)}: play_here without an embed`);
    if (state === 'official_provider' && (!hasProviders || hasEmbed)) {
      fail(`${relative(file)}: official_provider must show provider links and no player`);
    }
    if (state === 'trailer_only' && (!hasTrailer || hasEmbed)) {
      fail(`${relative(file)}: trailer_only must offer a trailer and no player`);
    }
    if (state === 'unavailable' && (hasProviders || hasTrailer || hasEmbed)) {
      fail(`${relative(file)}: unavailable page still offers playback, providers or a trailer`);
    }
  }

  if (declared === 0) fail('no page declares a playback state');
  checks.push({ name: 'playback states', failures: 0, note: String(declared) });
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
const totalWatch = checks.find((item) => item.name === 'watch pages')?.note;
const totalStates = checks.find((item) => item.name === 'playback states')?.note;

for (const item of checks) {
  if (!item.note) console.log(`${item.failures ? '✗' : '✓'} ${item.name}${item.failures ? ` (${item.failures} problem${item.failures === 1 ? '' : 's'})` : ''}`);
}
console.log(`\n${pages.length} pages · base path ${basePath}${totalRefs ? ` · ${totalRefs} references` : ''}${totalEntries ? ` · ${totalEntries} search entries` : ''}${totalWatch ? ` · ${totalWatch} watch pages` : ''}${totalStates ? ` · ${totalStates} playback states` : ''}`);

if (failures.length) {
  console.error(`\n${failures.length} check${failures.length === 1 ? '' : 's'} failed:`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log('All checks passed.');

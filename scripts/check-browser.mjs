#!/usr/bin/env node
/**
 * Browser smoke test.
 *
 *   node scripts/check-browser.mjs
 *   PIXY_BASE_URL=https://iams1am.github.io/pixy-streams/ node scripts/check-browser.mjs
 *
 * Without PIXY_BASE_URL the script builds a local copy, serves it and drives a
 * headless Chrome/Edge over the DevTools protocol. It covers the things only a
 * browser can prove: server-rendered navigation state, search keyboard flow,
 * the mobile drawer, genre discovery and local watch history.
 *
 * Chrome is found through CHROME_PATH or the usual Linux, macOS and Windows
 * locations. No package is installed and no external service is used.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTERNAL = process.env.PIXY_BASE_URL ? process.env.PIXY_BASE_URL.replace(/\/?$/, "/") : "";
const PORT = Number(process.env.PIXY_BROWSER_PORT || 8177);
const BASE = EXTERNAL || `http://127.0.0.1:${PORT}/`;
const OUT = path.join(ROOT, "public-browser");
const profile = mkdtempSync(path.join(tmpdir(), "pixy-browser-"));
const results = [];
const pageErrors = [];

const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? "PASS  " : "FAIL  "}${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
};

const chromePath = (() => {
  const candidates = [
    process.env.CHROME_PATH,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) return candidate;
    } else if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) {
      return candidate;
    }
  }
  return "";
})();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml",
  ".ics": "text/calendar; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function startServer() {
  const server = createServer((request, response) => {
    try {
      const { pathname } = new URL(request.url, "http://localhost");
      const decoded = decodeURIComponent(pathname);
      const file = path.join(OUT, decoded.endsWith("/") ? `${decoded}index.html` : decoded);
      if (!file.startsWith(OUT) || !existsSync(file) || !statSync(file).isFile()) {
        response.writeHead(404).end("not found");
        return;
      }
      response.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" });
      response.end(readFileSync(file));
    } catch {
      response.writeHead(400).end("bad request");
    }
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

function connect(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) listener(message.params);
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  };

  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const current = ++id;
      pending.set(current, { resolve, reject });
      ws.send(JSON.stringify({ id: current, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };

  const on = (method, listener) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(listener);
  };

  return { ready, send, evaluate, on, close: () => ws.close() };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let browser;
let server;

try {
  if (!chromePath) throw new Error("no Chrome or Edge found; set CHROME_PATH to run the browser smoke test");
  if (!EXTERNAL) {
    execFileSync("hugo", ["--quiet", "--minify", "--cleanDestinationDir", "--baseURL", BASE, "--destination", OUT], {
      cwd: ROOT,
      stdio: "inherit",
    });
    server = await startServer();
  }

  browser = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${PORT + 600}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let targets;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT + 600}/json/list`);
      targets = await response.json();
      if (targets.some((target) => target.type === "page")) break;
    } catch {
      // Chrome is still starting.
    }
    await sleep(100);
  }
  const target = targets?.find((entry) => entry.type === "page");
  if (!target) throw new Error("Chrome did not expose a page target");

  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  // Headless pages can report no focus, in which case input.focus() moves
  // activeElement without dispatching a focus event. Emulate focus so search
  // discovery behaves like it does for a real visitor.
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

  cdp.on("Runtime.exceptionThrown", (event) => {
    pageErrors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || "exception");
  });
  cdp.on("Runtime.consoleAPICalled", (event) => {
    if (event.type !== "error") return;
    pageErrors.push(event.args.map((arg) => arg.value || arg.description || "").join(" "));
  });

  const goto = async (url, wait = 500) => {
    const targetPath = new URL(url).pathname;
    await cdp.send("Page.navigate", { url });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const state = await cdp.evaluate(`({ ready: document.readyState, path: location.pathname })`);
        if (state.ready !== "loading" && state.path === targetPath) break;
      } catch {
        // The old document is being replaced.
      }
      await sleep(100);
    }
    // Deferred scripts run before the load event; focusing before that would
    // hit an input with no listeners and produce a false failure. Remote
    // artwork can hold the load event open, so cap the wait.
    await cdp.evaluate(`new Promise((resolve) => {
      if (document.readyState === "complete") return resolve();
      window.addEventListener("load", () => resolve(), { once: true });
      setTimeout(() => resolve(), 2500);
    })`);
    await sleep(wait);
  };

  const waitFor = async (expression, timeout = 5000) => {
    for (let elapsed = 0; elapsed < timeout; elapsed += 200) {
      if (await cdp.evaluate(expression)) return true;
      await sleep(200);
    }
    return false;
  };
  const width = (w, h) =>
    cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  const press = (key, code, keyCode, selector) =>
    cdp.evaluate(
      `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', code: '${code}', keyCode: ${keyCode}, bubbles: true, cancelable: true }))`,
    );

  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await width(1440, 950);

  await goto(`${BASE}movies/`);
  let nav = await cdp.evaluate(`({
    page: [...document.querySelectorAll('.navbar-nav [aria-current="page"]')].map((a) => a.textContent.trim()),
    all: [...document.querySelectorAll('.navbar-nav [aria-current]')].length
  })`);
  check("server-rendered nav marks Movies on /movies/", nav.page.length === 1 && nav.page[0] === "Movies" && nav.all === 1, nav);

  await goto(`${BASE}movies/dune-part-two/`);
  nav = await cdp.evaluate(`({
    page: [...document.querySelectorAll('.navbar-nav [aria-current="page"]')].length,
    all: [...document.querySelectorAll('.navbar-nav [aria-current]')].map((a) => a.textContent.trim() + ':' + a.getAttribute('aria-current'))
  })`);
  check("a detail page marks the section branch, not page", nav.page === 0 && nav.all.length === 1 && nav.all[0] === "Movies:true", nav);

  await goto(`${BASE}`);
  await waitFor("document.querySelector('[data-search]')?.dataset.searchReady === 'true'");
  await cdp.evaluate(`document.querySelector('[data-search-input]').focus()`);
  await waitFor("document.querySelectorAll('[data-search-suggestion]').length === 8");
  const discovery = await cdp.evaluate(`({
    suggestions: document.querySelectorAll('[data-search-suggestion]').length,
    link: document.querySelector('.search-discovery-link')?.getAttribute('href') || ''
  })`);
  check("focusing search shows eight genre suggestions", discovery.suggestions === 8, discovery.suggestions);

  await cdp.evaluate(`(() => { const input = document.querySelector('[data-search-input]'); input.value = 'drama'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor("document.querySelectorAll('.search-result').length > 0");
  const search = await cdp.evaluate(`({
    count: document.querySelectorAll('.search-result').length,
    status: document.querySelector('[data-search-status]').textContent,
    first: document.querySelector('.search-result')?.getAttribute('href') || ''
  })`);
  const firstPath = search.first ? new URL(search.first, BASE).pathname.replace(new URL(BASE).pathname, "/") : "";
  check("live search ranks and counts results", search.count >= 6 && /Showing \d+ of \d+ results for drama/.test(search.status), search);
  check("the genre link includes the deployment base path", discovery.link.endsWith("/genres/") && discovery.link.includes(new URL(BASE).pathname), discovery.link);

  await press("ArrowDown", "ArrowDown", 40, "[data-search-input]");
  await press("Enter", "Enter", 13, "[data-search-input]");
  await sleep(1000);
  check("keyboard Enter opens the first result", (await cdp.evaluate("location.pathname")).endsWith(firstPath), firstPath);

  await goto(`${BASE}`);
  await waitFor("document.querySelector('[data-search]')?.dataset.searchReady === 'true'");
  await cdp.evaluate(`document.querySelector('[data-search-input]').focus()`);
  await cdp.evaluate(`(() => { const input = document.querySelector('[data-search-input]'); input.value = 'drama'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor("document.querySelector('.search-view-all') !== null");
  const viewAll = await cdp.evaluate(`(() => {
    const link = document.querySelector('.search-view-all');
    return { href: link?.getAttribute('href') || '', text: link?.textContent.trim() || '' };
  })()`);
  check("header search links to the full results page", /\/search\/\?q=drama$/.test(viewAll.href) && /^View all \d+ results$/.test(viewAll.text), viewAll);

  await press("End", "End", 35, "[data-search-input]");
  const activeAfterEnd = await cdp.evaluate("document.querySelector('[data-search-input]').getAttribute('aria-activedescendant')");
  check("End selects the view-all option", activeAfterEnd === "search-result-more", activeAfterEnd);

  await press("Enter", "Enter", 13, "[data-search-input]");
  await sleep(900);
  const openedPage = await cdp.evaluate("({ path: location.pathname, query: location.search })");
  check("keyboard Enter opens the full results page", openedPage.path.endsWith("/search/") && openedPage.query === "?q=drama", openedPage);

  await waitFor("document.querySelector('[data-search-page]')?.dataset.searchPageReady === 'true'");
  const fullSearch = await cdp.evaluate(`({
    count: document.querySelectorAll('.search-page-result').length,
    rows: document.querySelectorAll('.search-page-list li').length,
    status: document.querySelector('[data-search-page-status]').textContent,
    value: document.querySelector('[data-search-page-input]').value,
    title: document.title,
    missingKind: [...document.querySelectorAll('.search-page-result')].filter((link) => !link.querySelector('.search-result-kind')?.textContent.trim()).length
  })`);
  check("full search page shows every match and the query", fullSearch.count > 8 && fullSearch.rows === fullSearch.count && /^\d+ results for "drama"\.$/.test(fullSearch.status) && fullSearch.value === "drama" && fullSearch.title.startsWith("drama - Search") && fullSearch.missingKind === 0, fullSearch);

  const filterState = await cdp.evaluate(`(() => {
    const chips = [...document.querySelectorAll('[data-search-page-type]')].map((button) => ({
      type: button.dataset.searchPageType,
      count: Number(button.querySelector('.search-type-filter-count')?.textContent || -1),
      pressed: button.getAttribute('aria-pressed'),
      label: button.getAttribute('aria-label')
    }));
    return {
      chips,
      all: chips.find((chip) => chip.type === 'all'),
      series: chips.find((chip) => chip.type === 'series')
    };
  })()`);
  check("search page shows type filters with result counts", filterState.chips.length === 6 && filterState.all?.pressed === "true" && filterState.all?.count > 8 && filterState.series?.count > 0 && filterState.all?.label === `All: ${filterState.all?.count} results`, filterState);

  await cdp.evaluate(`document.querySelector('[data-search-page-type="series"]').click()`);
  await waitFor("document.querySelector('[data-search-page-type=\"series\"]')?.getAttribute('aria-pressed') === 'true'");
  const filtered = await cdp.evaluate(`(() => {
    const series = document.querySelector('[data-search-page-type="series"]');
    return {
      count: document.querySelectorAll('.search-page-result').length,
      expected: Number(series?.querySelector('.search-type-filter-count')?.textContent || -1),
      kinds: [...document.querySelectorAll('.search-page-result .search-result-kind')].map((kind) => kind.textContent.trim()),
      status: document.querySelector('[data-search-page-status]').textContent,
      url: location.search
    };
  })()`);
  check("type filter narrows results and updates the URL", filtered.count === filtered.expected && filtered.count > 0 && filtered.kinds.every((kind) => kind === "TV Series") && filtered.url === "?q=drama&type=series" && /in TV Series/.test(filtered.status), filtered);

  await goto(`${BASE}search/?q=drama&type=series`);
  await waitFor("document.querySelector('[data-search-page]')?.dataset.searchPageReady === 'true'");
  const sharedFilter = await cdp.evaluate(`(() => {
    const series = document.querySelector('[data-search-page-type="series"]');
    return {
      selected: series?.getAttribute('aria-pressed'),
      count: document.querySelectorAll('.search-page-result').length,
      expected: Number(series?.querySelector('.search-type-filter-count')?.textContent || -1),
      value: document.querySelector('[data-search-page-input]').value
    };
  })()`);
  check("a filtered search URL restores the filter", sharedFilter.selected === "true" && sharedFilter.count === sharedFilter.expected && sharedFilter.count > 0 && sharedFilter.value === "drama", sharedFilter);

  await cdp.evaluate(`document.querySelector('[data-search-page-type="event"]').click()`);
  await waitFor("document.querySelector('.search-page-empty') !== null");
  const filteredEmpty = await cdp.evaluate(`({
    text: document.querySelector('.search-page-empty')?.textContent || '',
    status: document.querySelector('[data-search-page-status]').textContent,
    filtersHidden: document.querySelector('[data-search-page-filters]').hidden,
    allCount: Number([...document.querySelectorAll('[data-search-page-type]')].find((button) => button.dataset.searchPageType === 'all')?.querySelector('.search-type-filter-count')?.textContent || -1)
  })`);
  check("an empty type filter explains itself without hiding the filters", /No Sport results for "drama"/.test(filteredEmpty.text) && filteredEmpty.filtersHidden === false && /No Sport results/.test(filteredEmpty.status) && filteredEmpty.allCount > 8, filteredEmpty);

  await cdp.evaluate(`document.querySelector('[data-search-page-type="all"]').click()`);
  await waitFor("document.activeElement?.dataset.searchPageType === 'all'");
  const restored = await cdp.evaluate(`(() => {
    const all = document.querySelector('[data-search-page-type="all"]');
    return {
      count: document.querySelectorAll('.search-page-result').length,
      expected: Number(all?.querySelector('.search-type-filter-count')?.textContent || -1),
      url: location.search,
      status: document.querySelector('[data-search-page-status]').textContent
    };
  })()`);
  check("All restores every match and keeps keyboard focus", restored.count === restored.expected && restored.count > 8 && restored.url === "?q=drama" && /results for "drama"\.$/.test(restored.status), restored);

  await goto(`${BASE}search/`);
  await waitFor("document.querySelector('[data-search-page]')?.dataset.searchPageReady === 'true'");
  const pageDiscovery = await cdp.evaluate(`({
    suggestions: document.querySelectorAll('[data-search-page-genres] button').length,
    hidden: document.querySelector('[data-search-page-discovery]').hidden,
    filtersHidden: document.querySelector('[data-search-page-filters]').hidden,
    status: document.querySelector('[data-search-page-status]').textContent
  })`);
  check("search page without a query offers genre discovery", pageDiscovery.suggestions >= 15 && pageDiscovery.hidden === false && pageDiscovery.filtersHidden === true && /Type at least two/.test(pageDiscovery.status), pageDiscovery);

  await goto(`${BASE}search/?q=zzzznotathing&type=series`);
  await waitFor("document.querySelector('[data-search-page]')?.dataset.searchPageReady === 'true'");
  const pageEmpty = await cdp.evaluate(`({
    text: document.querySelector('.search-page-empty')?.textContent || '',
    status: document.querySelector('[data-search-page-status]').textContent,
    genres: document.querySelectorAll('[data-search-page-genres] button').length,
    filtersHidden: document.querySelector('[data-search-page-filters]').hidden,
    url: location.search
  })`);
  check("a no-result query explains itself, offers genres and clears an invisible filter", /No titles match "zzzznotathing"/.test(pageEmpty.text) && pageEmpty.genres >= 15 && pageEmpty.filtersHidden === true && pageEmpty.url === "?q=zzzznotathing" && /No results/.test(pageEmpty.status), pageEmpty);

  await cdp.evaluate("document.querySelector('[data-search-page-genres] button').click()");
  await waitFor("document.querySelectorAll('.search-page-result').length > 0");
  const genreSearch = await cdp.evaluate(`({
    value: document.querySelector('[data-search-page-input]').value,
    count: document.querySelectorAll('.search-page-result').length,
    status: document.querySelector('[data-search-page-status]').textContent
  })`);
  check("genre buttons run a full-catalogue search", genreSearch.count > 0 && genreSearch.value.length > 0 && genreSearch.value !== "zzzznotathing" && /results? for/.test(genreSearch.status), genreSearch);

  await width(390, 844);
  await goto(`${BASE}`);
  await waitFor("document.querySelector('[data-search]')?.dataset.searchReady === 'true'");
  await press("/", "Slash", 191, "body");
  await waitFor("document.querySelectorAll('[data-search-suggestion]').length === 8");
  const mobile = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-search-results]');
    const field = document.querySelector('.site-search');
    return {
      open: document.querySelector('.navbar-menu').classList.contains('active'),
      focused: document.activeElement === document.querySelector('[data-search-input]'),
      position: getComputedStyle(panel).position,
      panel: Math.round(panel.getBoundingClientRect().width),
      field: Math.round(field.getBoundingClientRect().width),
      suggestions: document.querySelectorAll('[data-search-suggestion]').length,
      overflow: document.documentElement.scrollWidth - innerWidth
    };
  })()`);
  check("slash opens the drawer, focuses search and shows genres", mobile.open && mobile.focused && mobile.suggestions === 8, mobile);
  check("mobile results sit in flow at the full field width", mobile.position === "static" && mobile.panel === mobile.field && mobile.panel > 250 && mobile.overflow <= 0, mobile);

  await width(1440, 950);
  await goto(`${BASE}genres/`);
  const genres = await cdp.evaluate(`({
    cards: document.querySelectorAll('.genre-hub-card').length,
    icons: document.querySelectorAll('.genre-hub-card svg').length
  })`);
  check("genre hub lists count cards without check icons", genres.cards >= 20 && genres.icons === 0, genres);

  await goto(`${BASE}`);
  const stamp = Date.now();
  await cdp.evaluate(`(() => {
    localStorage.clear();
    localStorage.setItem('pixy:watch:progress:sample-the-general', JSON.stringify({ version: 1, t: 1200, d: 5500, at: ${stamp} }));
    localStorage.setItem('pixy:watch:completed', JSON.stringify({ version: 1, items: [{ id: 'sample-his-girl-friday', at: ${stamp - 1000} }] }));
  })()`);
  await goto(`${BASE}watch/`, 1400);
  const watch = await cdp.evaluate(`({
    percent: document.querySelector('.watch-card[data-watch-id="sample-the-general"] .watch-card-state')?.textContent || '',
    fill: document.querySelector('.watch-card[data-watch-id="sample-the-general"] .watch-card-progress-fill')?.style.width || '',
    watched: document.querySelector('.watch-card[data-watch-id="sample-his-girl-friday"] .watch-card-state')?.textContent || '',
    resume: document.querySelector('[data-watch-continue-grid] a')?.getAttribute('href') || ''
  })`);
  check("watch history renders percent, watched and resume", watch.percent === "22% watched" && watch.fill === "22%" && watch.watched === "Watched" && /resume=1/.test(watch.resume), watch);

  await width(390, 844);
  await goto(`${BASE}sports/`, 1200);
  const eventHref = await cdp.evaluate(`document.querySelector('.rail-card.is-event')?.getAttribute('href') || ''`);
  const eventRoute = eventHref ? new URL(eventHref, BASE).pathname.replace(new URL(BASE).pathname, "") : "";
  for (const [label, route] of [["home", ""], ["sports", "sports/"], ["event", eventRoute], ["detail", "movies/dune-part-two/"], ["search", "search/?q=drama"]]) {
    if (!route) continue;
    await goto(`${BASE}${route}`, 900);
    const overflow = await cdp.evaluate("document.documentElement.scrollWidth - innerWidth");
    check(`${label} has no horizontal overflow at 390px`, overflow <= 0, overflow);
  }

  await goto(`${BASE}sports/`, 1200);
  const scheduledHref = await cdp.evaluate(`document.querySelector('.rail-card.is-event[data-state="scheduled"]')?.getAttribute('href') || ''`);
  if (scheduledHref) {
    const scheduledRoute = new URL(scheduledHref, BASE).pathname.replace(new URL(BASE).pathname, "");
    await goto(`${BASE}${scheduledRoute}`, 900);
    const calendar = await cdp.evaluate(`(async () => {
      const link = document.querySelector('a[href$=".ics"]');
      if (!link) return { found: false };
      const response = await fetch(link.href);
      const text = await response.text();
      return {
        found: true,
        href: link.getAttribute('href'),
        status: response.status,
        vcalendar: text.includes('BEGIN:VCALENDAR'),
        vevent: text.includes('BEGIN:VEVENT')
      };
    })()`);
    check(
      "scheduled event offers a working calendar download",
      calendar.found && calendar.status === 200 && calendar.vcalendar && calendar.vevent && calendar.href.includes(new URL(BASE).pathname),
      calendar,
    );
  }

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
  cdp.close();
} catch (error) {
  check(error.message, false);
} finally {
  if (browser) {
    browser.kill();
    await sleep(300);
  }
  if (server) server.close();
  if (!EXTERNAL) {
    try {
      rmSync(OUT, { recursive: true, force: true });
    } catch {
      // Windows can hold a file briefly after the browser exits.
    }
  }
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // A locked profile is left for the OS temporary cleaner.
  }
}

const failed = results.filter((pass) => !pass).length;
console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
process.exit(failed ? 1 : 0);

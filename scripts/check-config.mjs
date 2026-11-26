#!/usr/bin/env node
/**
 * Offline configuration and secret check.
 *
 *   node scripts/check-config.mjs
 *
 * Catches the failures a Hugo build does not report: a base path that would
 * break GitHub Pages, a missing theme or required section, malformed committed
 * catalogue data, and credentials accidentally written into tracked files.
 * It never calls a provider and never reads .env.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const checks = [];
let checked = 0;

const fail = (message) => failures.push(message);
const check = (name, run) => {
  const before = failures.length;
  run();
  checks.push({ name, problems: failures.length - before });
};

const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const config = read("hugo.toml");

check("hugo configuration", () => {
  for (const key of ["baseURL", "title", "languageCode", "theme"]) {
    if (!new RegExp(`^${key}\\s*=\\s*["']`, "m").test(config)) fail(`hugo.toml: missing ${key}`);
  }

  const baseURL = config.match(/^baseURL\s*=\s*"([^"]+)"/m)?.[1] || "";
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    fail(`hugo.toml: baseURL is not a URL (${baseURL || "empty"})`);
    return;
  }
  if (url.protocol !== "https:") fail("hugo.toml: baseURL must use https for the production build");
  if (url.pathname !== "/pixy-streams/") {
    fail(`hugo.toml: baseURL path is ${url.pathname}, expected /pixy-streams/`);
  }

  const theme = config.match(/^theme\s*=\s*"([^"]+)"/m)?.[1] || "";
  if (!existsSync(path.join(ROOT, "themes", theme, "layouts", "baseof.html"))) {
    fail(`hugo.toml: theme ${theme || "(empty)"} has no layouts/baseof.html`);
  }

  if (!/\[params\][\s\S]*?playbackRegion\s*=\s*"[A-Z]{2}"/.test(config)) {
    fail("hugo.toml: params.playbackRegion is missing or not two uppercase letters");
  }
  if (!/\[\[menu\.main\]\]/.test(config)) fail("hugo.toml: no [[menu.main]] entries");
});

check("required content and data", () => {
  const required = [
    "content/_index.md",
    "content/movies/_index.md",
    "content/tv/_index.md",
    "content/anime/_index.md",
    "content/sports/_index.md",
    "content/watch/_index.md",
    "content/my-list/_index.md",
    "content/search/_index.md",
    "layouts/search/section.html",
    "themes/alert/assets/js/search-core.js",
    "themes/alert/assets/js/search-page.js",
    "data/playback/registry.json",
    "data/playback/samples.json",
    "layouts/index.search.json",
    "scripts/fetch-catalog.mjs",
    "scripts/check-site.mjs",
    "scripts/check-playback.mjs",
  ];
  for (const file of required) {
    if (!existsSync(path.join(ROOT, file))) fail(`missing ${file}`);
  }

  for (const name of ["movies", "series", "anime", "sports"]) {
    const file = `data/catalog/${name}.json`;
    if (!existsSync(path.join(ROOT, file))) {
      fail(`missing ${file}`);
      continue;
    }
    try {
      const data = JSON.parse(read(file));
      if (!Array.isArray(data.items) || !data.items.length) fail(`${file}: no items`);
      if (!data.source) fail(`${file}: no source label`);
      if (!data.generated_at || Number.isNaN(Date.parse(data.generated_at))) {
        fail(`${file}: generated_at is missing or not a date`);
      }
    } catch (error) {
      fail(`${file}: invalid JSON (${error.message})`);
    }
  }
});

check("secret hygiene", () => {
  const ignore = read(".gitignore");
  for (const entry of [".env", "public/", "resources/_gen/"]) {
    if (!ignore.split(/\r?\n/).some((line) => line.trim() === entry)) {
      fail(`.gitignore: ${entry} is not ignored`);
    }
  }
  if (!existsSync(path.join(ROOT, ".env.example"))) fail("missing .env.example");
  if (existsSync(path.join(ROOT, ".env"))) {
    // Present locally is fine, but the check states the expectation for CI.
    if (!ignore.includes(".env")) fail(".env exists and is not ignored");
  }

  const patterns = [
    [/TMDB_API_KEY\s*=\s*["']?[a-f0-9]{32}\b/i, "TMDB v3 key"],
    [/TMDB_READ_TOKEN\s*=\s*["']?eyJ[A-Za-z0-9_-]{10,}/, "TMDB v4 token"],
    [/SPORTSDB_KEY\s*=\s*["']?\d{6,}/, "TheSportsDB key"],
    [/Authorization:\s*["']?Bearer\s+[A-Za-z0-9._-]{20,}/i, "bearer token"],
    [/[?&]api_key=[a-f0-9]{32}\b/i, "API key in a query string"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  ];
  const extensions = /\.(?:md|toml|json|mjs|cjs|js|html|css|ya?ml|gotmpl|txt)$/i;
  const skip = new Set([".git", "node_modules", "public", "public-test", "public-browser", "resources", "example", ".tmp", ".tmp-edge-profile"]);
  let files = 0;
  let matches = 0;

  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!extensions.test(entry.name)) continue;
      const text = readFileSync(full, "utf8");
      files += 1;
      for (const [pattern, label] of patterns) {
        if (pattern.test(text)) {
          matches += 1;
          fail(`${path.relative(ROOT, full)}: looks like a committed ${label}`);
        }
      }
    }
  })(ROOT);

  checked = files;
  if (!files) fail("secret scan found no files to inspect");
  if (matches === 0) return;
});

for (const item of checks) {
  console.log(`${item.problems ? "✗" : "✓"} ${item.name}${item.problems ? ` (${item.problems} problem${item.problems === 1 ? "" : "s"})` : ""}`);
}
console.log(`\n${checked} text files scanned for credentials`);

if (failures.length) {
  console.error(`\n${failures.length} configuration check${failures.length === 1 ? "" : "s"} failed:`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log("All configuration checks passed.");

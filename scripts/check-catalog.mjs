#!/usr/bin/env node
/**
 * Offline catalogue validation.
 *
 *   node scripts/check-catalog.mjs
 *   node scripts/check-catalog.mjs --strict   # warnings become failures
 *
 * This script never calls a provider. It protects the committed cache from
 * schema drift, duplicate slugs and sports events that claim a score state
 * without a score. `--strict` is useful before a release.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateCatalogue } from "./lib/catalogue-validation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAMES = ["movies", "series", "anime", "sports"];
const STALE_DAYS = { movies: 60, series: 60, anime: 30, sports: 7 };
const LIVE_STALE_HOURS = 6;
const strict = process.argv.includes("--strict");

let failures = 0;
let warnings = 0;

const fail = (message) => {
  failures += 1;
  console.error(`✗ ${message}`);
};
const warn = (message) => {
  warnings += 1;
  console.warn(`! ${message}`);
};
const daysSince = (iso) => {
  const date = Date.parse(iso || "");
  return Number.isFinite(date) ? (Date.now() - date) / 86_400_000 : null;
};

for (const name of NAMES) {
  const file = path.join(ROOT, "data", "catalog", `${name}.json`);
  if (!existsSync(file)) {
    fail(`${name}: missing data/catalog/${name}.json`);
    continue;
  }

  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${name}: invalid JSON (${error.message})`);
    continue;
  }

  const result = validateCatalogue(name, data);
  for (const message of result.errors) fail(message);
  for (const message of result.warnings) warn(message);

  if (result.ok) {
    const items = data.items || [];
    const states = new Map();
    for (const item of items) {
      if (item.state) states.set(item.state, (states.get(item.state) || 0) + 1);
    }
    const detail = name === "sports" ? ` · ${[...states].map(([state, count]) => `${state} ${count}`).join(", ")}` : "";
    console.log(`✓ ${name.padEnd(7)} ${String(items.length).padStart(3)} items · ${data.source || "unknown source"}${detail}`);
  }

  const age = daysSince(data.generated_at);
  if (age === null) {
    warn(`${name}: generated_at is missing or invalid`);
  } else if (age > STALE_DAYS[name]) {
    warn(`${name}: cache is ${age.toFixed(1)} days old (warning after ${STALE_DAYS[name]} days)`);
  }

  if (name === "sports") {
    for (const item of data.items || []) {
      if (item.state !== "live") continue;
      const observed = Date.parse(item.observed_at || data.generated_at || "");
      if (Number.isFinite(observed) && (Date.now() - observed) / 3_600_000 > LIVE_STALE_HOURS) {
        warn(`${item.title}: still marked live but last observed more than ${LIVE_STALE_HOURS} hours ago`);
      }
    }
    const groups = new Set((data.items || []).map((item) => item.group));
    for (const group of ["football", "basketball", "motorsport"]) {
      if (!groups.has(group)) warn(`sports: no ${group} events in the current cache`);
    }
    for (const league of data.league_status || []) {
      if (league.status !== "fresh") warn(`sports: ${league.label || league.path} is ${league.status}`);
    }
  }
}

if (strict && warnings) {
  console.error(`\n${warnings} warning${warnings === 1 ? "" : "s"} treated as failures by --strict.`);
  process.exit(1);
}
if (failures) {
  console.error(`\n${failures} catalogue check${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log(`\nCatalogue checks passed${warnings ? ` with ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.`);

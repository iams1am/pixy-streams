#!/usr/bin/env node
/**
 * Validate the playback source registry.
 *
 *   node scripts/check-playback.mjs
 *   node scripts/check-playback.mjs data/playback/registry.json
 *
 * The registry only accepts full-content sources whose rights have been
 * reviewed. This check fails closed: a missing evidence URL, an unverified
 * claim, an unknown catalogue id or a provider/method mismatch all block the
 * build. Trailers and where-to-watch links are not playback sources and are
 * not validated here.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalogue, validateRegistry, validateSamples } from "./lib/playback-model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.resolve(ROOT, process.argv[2] || "data/playback/registry.json");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

let registry;
try {
  registry = JSON.parse(readFileSync(registryPath, "utf8"));
} catch (error) {
  fail(`cannot read ${path.relative(ROOT, registryPath)}: ${error.message}`);
}

let catalogue;
try {
  catalogue = loadCatalogue(ROOT);
} catch (error) {
  fail(`cannot load the catalogue: ${error.message}`);
}

let samples;
try {
  samples = JSON.parse(readFileSync(path.join(ROOT, "data", "playback", "samples.json"), "utf8"));
} catch (error) {
  fail(`cannot read data/playback/samples.json: ${error.message}`);
}

const { errors } = validateRegistry(registry, catalogue);
const sampleCheck = validateSamples(samples, registry);
const allErrors = [...errors, ...sampleCheck.errors];
const sources = Array.isArray(registry?.sources) ? registry.sources : [];
const sampleItems = Array.isArray(samples?.items) ? samples.items : [];

if (allErrors.length > 0) {
  console.error(
    `✗ playback sources: ${allErrors.length} problem${allErrors.length === 1 ? "" : "s"}`,
  );
  for (const error of allErrors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `✓ playback sources · ${sources.length} verified source${sources.length === 1 ? "" : "s"} · ${sampleItems.length} sample${sampleItems.length === 1 ? "" : "s"} · ${catalogue.size} catalogue ids`,
);

if (sources.length === 0) {
  console.log(
    "  No full-content playback is approved yet. Trailers and where-to-watch links are not playback permission.",
  );
}

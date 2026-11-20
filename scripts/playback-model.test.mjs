import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATES,
  loadCatalogue,
  resolvePlayback,
  validateRegistry,
  validateSamples,
} from "./lib/playback-model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) => JSON.parse(readFileSync(path.join(ROOT, relative), "utf8"));

const catalogue = new Map([
  ["seed-dune-part-two", { id: "seed-dune-part-two", kind: "movie", title: "Dune: Part Two" }],
  ["seed-severance", { id: "seed-severance", kind: "series", title: "Severance" }],
  ["anilist-195539", { id: "anilist-195539", kind: "anime", title: "Cyberpunk: Edgerunners 2" }],
  ["espn-fixture-1", { id: "espn-fixture-1", kind: "event", title: "Fixture" }],
]);

const makeRegistry = (sources) => ({
  version: 1,
  updated_at: "2026-11-20T00:00:00.000Z",
  sources,
});

const makeSource = () => ({
  id: "youtube-dune-part-two",
  content_id: "seed-dune-part-two",
  media_type: "movie",
  episode_id: null,
  provider: "youtube",
  method: "youtube_iframe",
  identifier: "dQw4w9WgXcQ",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  availability: {
    status: "available",
    regions: ["worldwide"],
    checked_at: "2026-11-20T00:00:00.000Z",
  },
  rights: {
    verified: true,
    basis: "direct_permission",
    terms: "Embedding approved worldwide; attribution required.",
    approved_by: "rights-review",
    evidence: [
      {
        source: "Written permission",
        url: "https://example.com/permission",
        checked_at: "2026-11-20T00:00:00.000Z",
      },
    ],
  },
  language: "en",
  captions: ["en"],
  last_verified: "2026-11-20T00:00:00.000Z",
});

const errorsFor = (source) => validateRegistry(makeRegistry([source]), catalogue).errors;

test("an empty registry is valid", () => {
  assert.deepEqual(validateRegistry(makeRegistry([]), catalogue).errors, []);
});

test("a fully evidenced play-here source is valid", () => {
  assert.deepEqual(errorsFor(makeSource()), []);
});

test("rights evidence is mandatory", () => {
  const source = makeSource();
  source.rights.evidence = [];
  assert.match(errorsFor(source).join("\n"), /rights\.evidence/);
});

test("unverified rights are rejected", () => {
  const source = makeSource();
  source.rights.verified = false;
  assert.match(errorsFor(source).join("\n"), /rights\.verified must be true/);
});

test("a reviewer is mandatory", () => {
  const source = makeSource();
  source.rights.approved_by = "";
  assert.match(errorsFor(source).join("\n"), /approved_by/);
});

test("unknown catalogue ids are rejected", () => {
  const source = makeSource();
  source.content_id = "missing-000";
  assert.match(errorsFor(source).join("\n"), /not in the catalogue/);
});

test("the provider and method must match", () => {
  const source = makeSource();
  source.method = "vimeo_iframe";
  assert.match(errorsFor(source).join("\n"), /method must be "youtube_iframe"/);
});

test("episode sources need an episode id", () => {
  const source = makeSource();
  source.content_id = "seed-severance";
  source.media_type = "episode";
  source.episode_id = null;
  assert.match(errorsFor(source).join("\n"), /episode_id is required/);
});

test("region-restricted availability must name regions", () => {
  const source = makeSource();
  source.availability.status = "region_restricted";
  source.availability.regions = ["worldwide"];
  assert.match(errorsFor(source).join("\n"), /must name specific regions/);
});

test("the URL must point at the declared identifier", () => {
  const source = makeSource();
  source.url = "https://www.youtube.com/watch?v=different00";
  assert.match(errorsFor(source).join("\n"), /does not point at identifier/);
});

test("duplicate source ids are rejected", () => {
  const errors = validateRegistry(makeRegistry([makeSource(), makeSource()]), catalogue).errors;
  assert.match(errors.join("\n"), /duplicated/);
});

test("the resolver distinguishes all four states", () => {
  const item = { id: "seed-dune-part-two", watch: [], trailer: "" };
  const source = makeSource();

  assert.equal(resolvePlayback(item, { sources: [source] }).state, STATES.PLAY_HERE);
  assert.equal(
    resolvePlayback({ ...item, watch: [{ name: "Max" }] }, { sources: [] }).state,
    STATES.OFFICIAL_PROVIDER,
  );
  assert.equal(
    resolvePlayback({ ...item, trailer: "https://www.youtube.com/watch?v=x" }, { sources: [] }).state,
    STATES.TRAILER_ONLY,
  );
  assert.equal(resolvePlayback(item, { sources: [] }).state, STATES.UNAVAILABLE);
});

test("the resolver respects region restrictions", () => {
  const source = makeSource();
  source.availability.status = "region_restricted";
  source.availability.regions = ["GB"];
  const item = { id: "seed-dune-part-two", watch: [{ name: "Max" }], trailer: "" };

  assert.equal(resolvePlayback(item, { sources: [source], region: "US" }).state, STATES.OFFICIAL_PROVIDER);
  assert.equal(resolvePlayback(item, { sources: [source], region: "gb" }).state, STATES.PLAY_HERE);
});

test("the resolver never treats unverified sources as playable", () => {
  const source = makeSource();
  source.rights.verified = false;
  const item = { id: "seed-dune-part-two", watch: [], trailer: "https://example.com/trailer" };
  assert.equal(resolvePlayback(item, { sources: [source] }).state, STATES.TRAILER_ONLY);
});

test("episode sources only match the requested episode", () => {
  const source = makeSource();
  source.content_id = "seed-severance";
  source.media_type = "episode";
  source.episode_id = "S1E1";
  const item = { id: "seed-severance", watch: [], trailer: "" };

  assert.equal(resolvePlayback(item, { sources: [source], episodeId: "S1E1" }).state, STATES.PLAY_HERE);
  assert.equal(resolvePlayback(item, { sources: [source], episodeId: "S1E2" }).state, STATES.UNAVAILABLE);
  assert.equal(resolvePlayback(item, { sources: [source] }).state, STATES.UNAVAILABLE);
});

test("the committed registry and sample library validate together", () => {
  const registry = readJson("data/playback/registry.json");
  const samples = readJson("data/playback/samples.json");
  const catalogue = loadCatalogue(ROOT);

  assert.deepEqual(validateRegistry(registry, catalogue).errors, []);
  assert.deepEqual(validateSamples(samples, registry).errors, []);
  assert.equal(registry.sources.length, 3);
  assert.equal(samples.items.length, 3);

  for (const item of samples.items) {
    assert.ok(catalogue.has(item.id), `missing catalogue id ${item.id}`);
  }
});

test("a sample needs a registry source with the same content id", () => {
  const registry = readJson("data/playback/registry.json");
  const samples = readJson("data/playback/samples.json");
  const broken = JSON.parse(JSON.stringify(samples));
  broken.items[0].source_id = "missing-source";

  assert.match(validateSamples(broken, registry).errors.join("\n"), /has no registry source/);
});

test("a sample archive id must match the registry identifier", () => {
  const registry = readJson("data/playback/registry.json");
  const samples = readJson("data/playback/samples.json");
  const broken = JSON.parse(JSON.stringify(samples));
  broken.items[0].archive_id = "different_archive";

  assert.match(validateSamples(broken, registry).errors.join("\n"), /must match the registry identifier/);
});

test("the resolver plays a sample only in the verified region", () => {
  const registry = readJson("data/playback/registry.json");
  const item = { id: "sample-the-general", watch: [], trailer: "" };

  assert.equal(
    resolvePlayback(item, { sources: registry.sources, region: "US" }).state,
    STATES.PLAY_HERE,
  );
  assert.equal(
    resolvePlayback(item, { sources: registry.sources, region: "GB" }).state,
    STATES.UNAVAILABLE,
  );
});

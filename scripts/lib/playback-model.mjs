/**
 * Provider-independent playback source model.
 *
 * A source record is a claim that one item can be played through one approved
 * mechanism. The registry only accepts `play_here` sources, and only when the
 * rights evidence is recorded. Everything else is derived from catalogue
 * metadata, in this order:
 *
 *   1. play_here            a verified registry source is available in the region
 *   2. official_provider    the catalogue has a where-to-watch link
 *   3. trailer_only         the catalogue has an official trailer
 *   4. unavailable          none of the above
 *
 * Metadata listings from TMDB or AniList are never treated as playback rights.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const STATES = Object.freeze({
  PLAY_HERE: "play_here",
  OFFICIAL_PROVIDER: "official_provider",
  TRAILER_ONLY: "trailer_only",
  UNAVAILABLE: "unavailable",
});

export const STATE_LABELS = Object.freeze({
  play_here: "Play here",
  official_provider: "Watch on official provider",
  trailer_only: "Trailer only",
  unavailable: "Unavailable",
});

export const MEDIA_TYPES = Object.freeze([
  "movie",
  "series",
  "episode",
  "anime",
  "event",
]);

export const RIGHTS_BASES = Object.freeze([
  "public_domain",
  "creative_commons",
  "direct_permission",
  "platform_license",
  "owned",
]);

export const PROVIDERS = Object.freeze({
  youtube: {
    method: "youtube_iframe",
    hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
    identifier: /^[A-Za-z0-9_-]{11}$/,
  },
  internet_archive: {
    method: "internet_archive_embed",
    hosts: ["archive.org", "www.archive.org"],
    identifier: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/,
  },
  vimeo: {
    method: "vimeo_iframe",
    hosts: ["vimeo.com", "www.vimeo.com"],
    identifier: /^\d{6,12}$/,
  },
  self_hosted: {
    method: "html5_mp4",
    hosts: null,
    identifier: /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.mp4$/i,
  },
});

export const CATALOGUE_FILES = Object.freeze([
  "movies",
  "series",
  "anime",
  "sports",
]);

export const SAMPLE_FILE = Object.freeze("data/playback/samples.json");

const KIND_FOR_MEDIA_TYPE = Object.freeze({
  movie: ["movie"],
  series: ["series"],
  episode: ["series", "anime"],
  anime: ["anime"],
  event: ["event"],
});

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BCP47 = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const EPISODE_ID = /^[A-Za-z0-9._:-]{1,40}$/;
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBcp47(value) {
  return typeof value === "string" && BCP47.test(value);
}

/** Load every catalogue item, keyed by its stable catalogue id. */
export function loadCatalogue(root) {
  const byId = new Map();

  for (const name of CATALOGUE_FILES) {
    const file = path.join(root, "data", "catalog", `${name}.json`);
    const data = JSON.parse(readFileSync(file, "utf8"));

    for (const item of data.items || []) {
      if (!item || !item.id) continue;
      byId.set(item.id, {
        id: item.id,
        kind: item.kind,
        title: item.title,
        watch: Array.isArray(item.watch) ? item.watch : [],
        trailer: item.trailer || "",
      });
    }
  }

  const sampleFile = path.join(root, SAMPLE_FILE);
  if (existsSync(sampleFile)) {
    const samples = JSON.parse(readFileSync(sampleFile, "utf8"));
    for (const item of samples.items || []) {
      if (!item || !item.id) continue;
      byId.set(item.id, {
        id: item.id,
        kind: "movie",
        title: item.title,
        watch: [],
        trailer: "",
      });
    }
  }

  return byId;
}

/** Validate the curated sample library and its link to the registry. */
export function validateSamples(samples, registry) {
  const errors = [];

  if (!isObject(samples)) {
    return { errors: ["samples must be a JSON object"] };
  }

  if (!Array.isArray(samples.items)) {
    return { errors: ["samples.items must be an array"] };
  }

  const sources = new Map(
    (Array.isArray(registry?.sources) ? registry.sources : []).map((source) => [
      source.id,
      source,
    ]),
  );
  const seenIds = new Set();
  const seenSlugs = new Set();

  samples.items.forEach((item, index) => {
    const where = `samples.items[${index}]`;

    if (!isObject(item)) {
      errors.push(`${where} must be an object`);
      return;
    }

    if (!isNonEmptyString(item.id)) {
      errors.push(`${where}.id is required`);
    } else if (seenIds.has(item.id)) {
      errors.push(`${where}.id is duplicated: ${item.id}`);
    } else {
      seenIds.add(item.id);
    }

    if (typeof item.slug !== "string" || !SLUG.test(item.slug)) {
      errors.push(`${where}.slug must be a lowercase slug`);
    } else if (seenSlugs.has(item.slug)) {
      errors.push(`${where}.slug is duplicated: ${item.slug}`);
    } else {
      seenSlugs.add(item.slug);
    }

    for (const field of ["title", "overview", "archive_id", "source_id"]) {
      if (!isNonEmptyString(item[field])) errors.push(`${where}.${field} is required`);
    }

    if (!Number.isInteger(item.year) || item.year < 1880 || item.year > 2100) {
      errors.push(`${where}.year must be a four-digit year`);
    }

    if (!Number.isInteger(item.runtime) || item.runtime < 1) {
      errors.push(`${where}.runtime must be a positive number of minutes`);
    }

    if (!isBcp47(item.language)) {
      errors.push(`${where}.language must be a BCP-47 tag`);
    }

    if (!Array.isArray(item.genres) || item.genres.length === 0) {
      errors.push(`${where}.genres must list at least one genre`);
    }

    for (const field of ["poster", "source_url", "license_url"]) {
      validateHttpsUrl(item[field], `${where}.${field}`, errors);
    }

    if (!isNonEmptyString(item.license)) {
      errors.push(`${where}.license is required`);
    }

    const source = sources.get(item.source_id);
    if (!source) {
      errors.push(`${where}.source_id has no registry source: ${item.source_id}`);
      return;
    }

    if (source.content_id !== item.id) {
      errors.push(`${where}.source_id points at content_id ${source.content_id}, not ${item.id}`);
    }

    if (source.provider !== "internet_archive" || source.method !== "internet_archive_embed") {
      errors.push(`${where}.source_id must be an Internet Archive embed source`);
    }

    if (source.identifier !== item.archive_id) {
      errors.push(`${where}.archive_id must match the registry identifier`);
    }

    if (!source.rights || source.rights.verified !== true) {
      errors.push(`${where}.source_id does not have verified rights`);
    }
  });

  return { errors };
}

function validateHttpsUrl(value, label, errors) {
  if (typeof value !== "string") {
    errors.push(`${label} is required`);
    return;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") errors.push(`${label} must use https`);
  } catch {
    errors.push(`${label} must be a valid absolute URL`);
  }
}

/** Validate the whole registry against the current catalogue. */
export function validateRegistry(registry, catalogueById = new Map()) {
  const errors = [];

  if (!isObject(registry)) {
    return { errors: ["registry must be a JSON object"] };
  }

  if (registry.version !== 1) {
    errors.push("registry.version must be 1");
  }

  if (!isIsoDate(registry.updated_at)) {
    errors.push("registry.updated_at must be an ISO 8601 date or timestamp");
  }

  if (!Array.isArray(registry.sources)) {
    errors.push("registry.sources must be an array");
    return { errors };
  }

  const seenIds = new Set();

  registry.sources.forEach((source, index) => {
    validateSource(source, index, catalogueById, seenIds, errors);
  });

  return { errors };
}

function validateSource(source, index, catalogueById, seenIds, errors) {
  const where = `sources[${index}]`;

  if (!isObject(source)) {
    errors.push(`${where} must be an object`);
    return;
  }

  if (!isNonEmptyString(source.id) || !SLUG.test(source.id)) {
    errors.push(`${where}.id must be a lowercase slug`);
  } else if (seenIds.has(source.id)) {
    errors.push(`${where}.id is duplicated: ${source.id}`);
  } else {
    seenIds.add(source.id);
  }

  if (!isNonEmptyString(source.content_id)) {
    errors.push(`${where}.content_id is required`);
  } else if (!catalogueById.has(source.content_id)) {
    errors.push(`${where}.content_id is not in the catalogue: ${source.content_id}`);
  }

  if (!MEDIA_TYPES.includes(source.media_type)) {
    errors.push(`${where}.media_type must be one of ${MEDIA_TYPES.join(", ")}`);
  } else {
    checkMediaType(source, where, catalogueById, errors);
  }

  const provider = PROVIDERS[source.provider];
  if (!provider) {
    errors.push(`${where}.provider must be one of ${Object.keys(PROVIDERS).join(", ")}`);
  } else {
    if (source.method !== provider.method) {
      errors.push(`${where}.method must be "${provider.method}" for ${source.provider}`);
    }

    if (typeof source.identifier !== "string" || !provider.identifier.test(source.identifier)) {
      errors.push(`${where}.identifier is not valid for ${source.provider}`);
    }

    validateProviderUrl(source, provider, where, errors);
  }

  validateAvailability(source.availability, where, errors);
  validateRights(source.rights, where, errors);

  if (source.language !== null && source.language !== undefined && !isBcp47(source.language)) {
    errors.push(`${where}.language must be a BCP-47 tag or null`);
  }

  if (!Array.isArray(source.captions)) {
    errors.push(`${where}.captions must be an array (it may be empty)`);
  } else {
    for (const caption of source.captions) {
      if (!isBcp47(caption)) {
        errors.push(`${where}.captions contains an invalid BCP-47 tag: ${caption}`);
      }
    }
  }

  if (!isIsoDate(source.last_verified)) {
    errors.push(`${where}.last_verified must be an ISO 8601 date or timestamp`);
  }
}

function checkMediaType(source, where, catalogueById, errors) {
  const item = catalogueById.get(source.content_id);
  if (item) {
    const allowedKinds = KIND_FOR_MEDIA_TYPE[source.media_type] || [];
    if (!allowedKinds.includes(item.kind)) {
      errors.push(
        `${where}.media_type "${source.media_type}" does not match catalogue kind "${item.kind}"`,
      );
    }
  }

  if (source.media_type === "episode") {
    if (typeof source.episode_id !== "string" || !EPISODE_ID.test(source.episode_id)) {
      errors.push(`${where}.episode_id is required for episode sources`);
    }
  } else if (source.episode_id !== null && source.episode_id !== undefined) {
    errors.push(`${where}.episode_id is only allowed when media_type is "episode"`);
  }
}

function validateProviderUrl(source, provider, where, errors) {
  let url;
  try {
    url = new URL(source.url);
  } catch {
    errors.push(`${where}.url must be a valid absolute URL`);
    return;
  }

  if (url.protocol !== "https:") {
    errors.push(`${where}.url must use https`);
  }

  if (url.username || url.password) {
    errors.push(`${where}.url must not contain credentials`);
  }

  const host = url.hostname.toLowerCase();
  if (provider.hosts && !provider.hosts.includes(host)) {
    errors.push(`${where}.url host is not approved for ${source.provider}: ${host}`);
  }

  if (source.provider === "youtube") {
    const identifier = host === "youtu.be" ? url.pathname.replace(/^\/+/, "") : url.searchParams.get("v");
    if (identifier !== source.identifier) {
      errors.push(`${where}.url does not point at identifier ${source.identifier}`);
    }
  } else if (source.provider === "internet_archive") {
    const match = url.pathname.match(/^\/(?:details|embed)\/([^/]+)\/?$/);
    let pathIdentifier = "";
    try {
      pathIdentifier = match ? decodeURIComponent(match[1]) : "";
    } catch {
      pathIdentifier = "";
    }
    if (pathIdentifier !== source.identifier) {
      errors.push(`${where}.url does not point at identifier ${source.identifier}`);
    }
  } else if (source.provider === "vimeo") {
    if (url.pathname.replace(/\/+$/, "") !== `/${source.identifier}`) {
      errors.push(`${where}.url does not point at identifier ${source.identifier}`);
    }
  } else if (source.provider === "self_hosted") {
    if (!url.pathname.toLowerCase().endsWith(".mp4")) {
      errors.push(`${where}.url must point at an MP4 file`);
    }
    if (url.pathname !== source.identifier) {
      errors.push(`${where}.identifier must equal the URL path`);
    }
  }
}

function validateAvailability(availability, where, errors) {
  if (!isObject(availability)) {
    errors.push(`${where}.availability must be an object`);
    return;
  }

  if (!["available", "region_restricted"].includes(availability.status)) {
    errors.push(`${where}.availability.status must be "available" or "region_restricted"`);
  }

  if (!Array.isArray(availability.regions) || availability.regions.length === 0) {
    errors.push(`${where}.availability.regions must list at least one region`);
  } else {
    for (const region of availability.regions) {
      if (region !== "worldwide" && !/^[A-Z]{2}$/.test(region)) {
        errors.push(`${where}.availability.regions contains an invalid region: ${region}`);
      }
    }

    if (availability.status === "region_restricted" && availability.regions.includes("worldwide")) {
      errors.push(`${where}.availability.regions must name specific regions when restricted`);
    }
  }

  if (!isIsoDate(availability.checked_at)) {
    errors.push(`${where}.availability.checked_at must be an ISO 8601 date or timestamp`);
  }
}

function validateRights(rights, where, errors) {
  if (!isObject(rights)) {
    errors.push(`${where}.rights must be an object`);
    return;
  }

  if (rights.verified !== true) {
    errors.push(`${where}.rights.verified must be true`);
  }

  if (!RIGHTS_BASES.includes(rights.basis)) {
    errors.push(`${where}.rights.basis must be one of ${RIGHTS_BASES.join(", ")}`);
  }

  if (!isNonEmptyString(rights.terms)) {
    errors.push(`${where}.rights.terms must summarise what the permission allows`);
  }

  if (!isNonEmptyString(rights.approved_by)) {
    errors.push(`${where}.rights.approved_by must record who reviewed the evidence`);
  }

  if (!Array.isArray(rights.evidence) || rights.evidence.length === 0) {
    errors.push(`${where}.rights.evidence must contain at least one item`);
    return;
  }

  rights.evidence.forEach((entry, evidenceIndex) => {
    const label = `${where}.rights.evidence[${evidenceIndex}]`;

    if (!isObject(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }

    if (!isNonEmptyString(entry.source)) {
      errors.push(`${label}.source is required`);
    }

    if (typeof entry.url !== "string") {
      errors.push(`${label}.url is required`);
    } else {
      try {
        const url = new URL(entry.url);
        if (url.protocol !== "https:") errors.push(`${label}.url must use https`);
      } catch {
        errors.push(`${label}.url must be a valid absolute URL`);
      }
    }

    if (!isIsoDate(entry.checked_at)) {
      errors.push(`${label}.checked_at must be an ISO 8601 date or timestamp`);
    }
  });
}

/**
 * Classify one catalogue item. Unverified sources never become `play_here`,
 * even if they reach this function without passing the validator.
 */
export function resolvePlayback(item, { sources = [], region = "US", episodeId = null } = {}) {
  if (!item || !item.id) {
    return { state: STATES.UNAVAILABLE };
  }

  const normalizedRegion = String(region || "US").toUpperCase();
  const source = sources.find((candidate) =>
    isPlayableIn(candidate, item.id, episodeId, normalizedRegion),
  );

  if (source) {
    return { state: STATES.PLAY_HERE, source };
  }

  if (Array.isArray(item.watch) && item.watch.length > 0) {
    return {
      state: STATES.OFFICIAL_PROVIDER,
      watch: item.watch,
      trailer: item.trailer || "",
    };
  }

  if (item.trailer) {
    return { state: STATES.TRAILER_ONLY, trailer: item.trailer };
  }

  return { state: STATES.UNAVAILABLE };
}

function isPlayableIn(source, contentId, episodeId, region) {
  if (!source || source.content_id !== contentId) return false;
  if (!source.rights || source.rights.verified !== true) return false;

  if (episodeId) {
    if (source.episode_id && source.episode_id !== episodeId) return false;
  } else if (source.episode_id) {
    return false;
  }

  const availability = source.availability || {};
  if (availability.status === "unavailable") return false;

  const regions = Array.isArray(availability.regions) ? availability.regions : [];
  if (regions.length === 0) return false;
  if (regions.includes("worldwide")) return true;

  return regions.map((entry) => String(entry).toUpperCase()).includes(region);
}

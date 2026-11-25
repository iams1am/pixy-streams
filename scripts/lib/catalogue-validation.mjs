/** Offline validation shared by the fetcher and the post-fetch checks. */

import { SPORTS_STATES } from "./sports-model.mjs";

const KINDS = new Set(["movie", "series", "anime", "event"]);
const LISTS = new Set(["live", "results", "upcoming", "trending", "new_releases", "seasonal", "top_rated"]);

function isHttpUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isParsableDate(value) {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function validateCatalogue(name, data) {
  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: [`${name}: catalogue is not an object`], warnings };
  }

  if (!Array.isArray(data.items)) {
    return { ok: false, errors: [`${name}: items is not an array`], warnings };
  }
  if (!data.items.length) fail(`${name}: no items`);
  if (data.count !== data.items.length) fail(`${name}: count ${data.count} does not match ${data.items.length} items`);
  if (!data.source) warn(`${name}: no source label`);
  if (data.generated_at && !isParsableDate(data.generated_at)) warn(`${name}: generated_at is not a date`);

  const ids = new Set();
  const slugs = new Set();

  data.items.forEach((item, index) => {
    const where = `${name}[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail(`${where}: not an object`);
      return;
    }

    if (!item.title) fail(`${where}: missing title`);
    if (!item.slug) fail(`${where}: missing slug`);
    if (!item.kind || !KINDS.has(item.kind)) fail(`${where}: invalid kind "${item.kind}"`);
    if (!item.source) warn(`${where}: missing source`);

    if (item.id) {
      if (ids.has(item.id)) fail(`${where}: duplicate id ${item.id}`);
      ids.add(item.id);
    } else {
      fail(`${where}: missing id`);
    }

    if (item.slug) {
      if (slugs.has(item.slug)) fail(`${where}: duplicate slug ${item.slug}`);
      slugs.add(item.slug);
    }

    if (item.genres !== undefined && !Array.isArray(item.genres)) fail(`${where}: genres is not an array`);

    for (const entry of item.watch || []) {
      if (!entry?.name || !isHttpUrl(entry.url)) fail(`${where}: watch entry needs a name and http(s) url`);
    }

    if (item.kind !== "event") return;

    if (!item.group) fail(`${where}: event has no group`);
    if (!item.league) fail(`${where}: event has no league`);
    if (!SPORTS_STATES.includes(item.state)) fail(`${where}: invalid event state "${item.state}"`);
    if (!Array.isArray(item.lists) || !item.lists.length) fail(`${where}: event has no lists`);
    else if (!item.lists.some((list) => LISTS.has(list))) fail(`${where}: event has no recognised list`);
    if (!item.date && !item.kickoff) fail(`${where}: event has no date or kickoff`);
    if (item.kickoff && !isParsableDate(item.kickoff)) fail(`${where}: kickoff is not a date`);
    if (item.href && !isHttpUrl(item.href)) fail(`${where}: href is not an http(s) url`);
    if (!item.href) fail(`${where}: event has no fixture link`);
    if (item.source_url && !isHttpUrl(item.source_url)) fail(`${where}: source_url is not an http(s) url`);
    if (!Array.isArray(item.broadcasts)) fail(`${where}: broadcasts is not an array`);
    else {
      for (const broadcast of item.broadcasts) {
        if (!broadcast?.name) fail(`${where}: broadcast entry has no name`);
        if (broadcast?.url && !isHttpUrl(broadcast.url)) fail(`${where}: broadcast url is not an http(s) url`);
      }
    }
    if (!Array.isArray(item.sessions)) fail(`${where}: sessions is not an array`);
    if (!item.links || typeof item.links !== "object") fail(`${where}: links is not an object`);

    for (const side of ["home", "away"]) {
      const team = item[side];
      if (team === null || team === undefined) continue;
      if (typeof team !== "object" || !team.name) fail(`${where}: ${side} team has no name`);
      if (team.logo && !isHttpUrl(team.logo)) fail(`${where}: ${side} logo is not an http(s) url`);
      if (team.link && !isHttpUrl(team.link)) fail(`${where}: ${side} team link is not an http(s) url`);
    }

    const hasTeams = Boolean(item.home?.name && item.away?.name);
    const scored = ["live", "finished", "suspended", "delayed"].includes(item.state);
    if (scored && hasTeams && !/^\d+-\d+$/.test(item.score || "")) {
      fail(`${where}: ${item.state} event is missing a home-away score`);
    }
    if (!scored && item.score) fail(`${where}: ${item.state} event has a score`);

    if (item.state === "live" && item.badge !== "Live score") {
      warn(`${where}: live event badge should say "Live score"`);
    }
    if (item.stale && !item.fetched_at) warn(`${where}: stale event has no fetched_at`);
  });

  return { ok: errors.length === 0, errors, warnings };
}

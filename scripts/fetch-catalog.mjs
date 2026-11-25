#!/usr/bin/env node
/**
 * Pixy Streams catalogue fetcher.
 *
 * Pulls metadata at build time and writes normalised JSON into data/catalog/,
 * which Hugo then reads for rails, section pages and generated title pages.
 * Nothing here is a stream source: every entry links out to official pages and
 * to the services that hold the rights.
 *
 *   node scripts/fetch-catalog.mjs            # all sources
 *   node scripts/fetch-catalog.mjs --only=anime
 *   node scripts/fetch-catalog.mjs --only=series
 *
 * Environment:
 *   TMDB_API_KEY     TMDB v3 key            (movies and TV; skipped when absent)
 *   TMDB_READ_TOKEN  TMDB v4 read token     (alternative to the key)
 *   TMDB_REGION      ISO 3166-1 watch region (movies and TV; default US)
 *   SPORTSDB_KEY     TheSportsDB key        (defaults to the public test key)
 *
 * Variables may live in a .env file at the repo root (see .env.example) or in
 * the shell; the shell wins.
 *
 * A source that fails leaves its previous JSON file untouched, so a flaky API
 * or a missing key never breaks the build.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateCatalogue } from "./lib/catalogue-validation.mjs";
import {
  mergeSportsSnapshot,
  normaliseEspnEvent,
  normaliseSportsDbEvent,
  sortSportsItems,
  SPORTS_GROUP_LABELS,
} from "./lib/sports-model.mjs";
import { formatDay, formatRuntime, isoDate, shorten, slugify, stripHtml, uniqueSlugFactory } from "./lib/text-utils.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Read `KEY=value` pairs from .env at the repo root, without overriding the real environment. */
function loadEnvFile() {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;

    const [, key, raw] = match;
    const value = raw.replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();
const OUT_DIR = path.join(ROOT, "data", "catalog");
const UA = "PixyStreams/1.0 (+https://github.com/iams1am/pixy-streams)";
const TIMEOUT_MS = 25_000;

const SPORTSDB_KEY = process.env.SPORTSDB_KEY || "123";
const TMDB_KEY = process.env.TMDB_API_KEY || "";
const TMDB_TOKEN = process.env.TMDB_READ_TOKEN || "";

const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";
const wants = (name) => !only || only.split(",").includes(name);
const statusOnly = process.argv.includes("--status");

/**
 * TMDB guesses a credential type from its shape, because the two accepted
 * credentials live in different variables and a swapped pair only shows up as a
 * 401 halfway through a run.
 */
const V3_KEY = /^[a-f0-9]{32}$/i;
const V4_TOKEN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function tmdbCredentialState() {
  if (!TMDB_KEY && !TMDB_TOKEN) {
    return {
      ok: false,
      configured: false,
      message: "no TMDB credentials — set TMDB_API_KEY (v3 key) or TMDB_READ_TOKEN (v4 token)",
    };
  }

  if (TMDB_KEY && !V3_KEY.test(TMDB_KEY)) {
    return {
      ok: false,
      configured: true,
      message: V4_TOKEN.test(TMDB_KEY)
        ? "TMDB_API_KEY looks like a v4 read token; put it in TMDB_READ_TOKEN instead"
        : "TMDB_API_KEY is not a 32-character v3 key",
    };
  }

  if (TMDB_TOKEN && !V4_TOKEN.test(TMDB_TOKEN)) {
    return {
      ok: false,
      configured: true,
      message: V3_KEY.test(TMDB_TOKEN)
        ? "TMDB_READ_TOKEN looks like a v3 key; put it in TMDB_API_KEY instead"
        : "TMDB_READ_TOKEN is not a v4 JWT read token",
    };
  }

  return {
    ok: true,
    configured: true,
    message: TMDB_KEY ? "v3 key" : "v4 read token",
  };
}

const TMDB_CREDENTIAL = tmdbCredentialState();
if (TMDB_CREDENTIAL.configured && !TMDB_CREDENTIAL.ok) {
  console.error(`✗ ${TMDB_CREDENTIAL.message}`);
  console.error("  → create or copy credentials at https://www.themoviedb.org/settings/api");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- helpers */

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function fetchJson(url, options = {}) {
  const { retries = 2, backoff = 1200, ...init } = options;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const error = new Error(`${res.status} ${res.statusText}`);
        error.status = res.status;
        error.retryAfter = retryAfterMs(res.headers.get("retry-after"));
        throw error;
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        // Honour Retry-After when a provider sends one, but cap the wait so a
        // daily build cannot stall for an hour on a bad header.
        const wait = Math.min(error.retryAfter || backoff * attempt, 20_000);
        await sleep(wait);
      }
    }
  }

  throw lastError;
}

/** TheSportsDB signals its rate limit in a 200 body, not a status code. */
function assertNotRateLimited(payload) {
  if (payload && payload.error) {
    throw new Error(payload.error);
  }
  return payload;
}

/* Text helpers live in lib/text-utils.mjs so the sports unit tests can reuse
   exactly the same slugging and HTML-stripping behaviour as the fetcher. */

/* ----------------------------------------------------------------- anime */

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

const ANILIST_MEDIA = `
  fragment Media on Media {
    id
    title { english romaji }
    description(asHtml: false)
    averageScore
    episodes
    duration
    seasonYear
    format
    status
    genres
    coverImage { extraLarge large color }
    bannerImage
    trailer { id site }
    siteUrl
    externalLinks { site url type }
  }
`;

const ANNOUNCED_FORMAT = {
  TV: "TV",
  TV_SHORT: "TV",
  MOVIE: "Film",
  ONA: "ONA",
  OVA: "OVA",
  SPECIAL: "Special",
  MUSIC: "Music",
};

function currentSeason(date = new Date()) {
  const month = date.getUTCMonth() + 1;
  if (month <= 3) return "WINTER";
  if (month <= 6) return "SPRING";
  if (month <= 9) return "SUMMER";
  return "FALL";
}

const WATCH_SERVICES =
  /crunchyroll|netflix|hulu|prime video|amazon|disney\+|hidive|retrocrush|bilibili|youtube|iqiyi|vrv|tubi|apple tv/i;

function watchedOn(links = []) {
  const seen = new Set();
  return links
    .filter((link) => link && link.url && WATCH_SERVICES.test(link.site || ""))
    .filter((link) => {
      const name = stripHtml(link.site);
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .slice(0, 6)
    .map((link) => ({ name: stripHtml(link.site), url: link.url }));
}

function normaliseAnime(media, nextSlug) {
  const title = stripHtml(media.title?.english || media.title?.romaji || "Untitled");
  const episodes = media.episodes || null;
  const duration = media.duration || null;
  const format = ANNOUNCED_FORMAT[media.format] || media.format || "Anime";
  const airing = media.status === "RELEASING";

  const metaParts = [media.seasonYear || "", format];
  if (episodes) metaParts.push(`${episodes} eps`);
  else if (duration) metaParts.push(formatRuntime(duration));

  const trailer =
    media.trailer && media.trailer.site === "youtube"
      ? `https://www.youtube.com/watch?v=${media.trailer.id}`
      : "";

  return {
    slug: nextSlug(title),
    id: `anilist-${media.id}`,
    title,
    original_title: stripHtml(media.title?.romaji || ""),
    kind: "anime",
    year: media.seasonYear || null,
    format,
    episodes,
    duration,
    status: media.status || "",
    score: media.averageScore ? Number((media.averageScore / 10).toFixed(1)) : null,
    overview: shorten(stripHtml(media.description), 460),
    poster: media.coverImage?.extraLarge || "",
    // Rails render cards at 168 px; the 230 px variant avoids downloading the
    // 460 px artwork on standard-density screens. Detail pages keep `poster`.
    poster_small: media.coverImage?.large || "",
    backdrop: media.bannerImage || "",
    accent: media.coverImage?.color || "",
    genres: media.genres || [],
    meta: metaParts.filter(Boolean).join(" · "),
    badge: airing ? "Airing" : format === "Film" ? "Film" : "",
    trailer,
    watch: watchedOn(media.externalLinks),
    lists: [],
    source: "AniList",
    source_url: media.siteUrl || "",
  };
}

async function animeCatalog() {
  const season = currentSeason();
  const year = new Date().getUTCFullYear();

  const query = `
    query ($season: MediaSeason, $year: Int) {
      seasonal: Page(page: 1, perPage: 18) {
        media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) { ...Media }
      }
      trending: Page(page: 1, perPage: 18) {
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ...Media }
      }
      top: Page(page: 1, perPage: 18) {
        media(type: ANIME, sort: SCORE_DESC, isAdult: false, format_in: [TV, TV_SHORT, ONA]) { ...Media }
      }
      films: Page(page: 1, perPage: 18) {
        media(type: ANIME, format: MOVIE, sort: POPULARITY_DESC, isAdult: false) { ...Media }
      }
    }
    ${ANILIST_MEDIA}
  `;

  const payload = await fetchJson(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { season, year } }),
  });

  if (payload.errors) throw new Error(payload.errors.map((e) => e.message).join("; "));

  const nextSlug = uniqueSlugFactory();
  const byId = new Map();

  const ingest = (results, listName) => {
    for (const media of results || []) {
      if (!media || !media.id) continue;
      let item = byId.get(media.id);
      if (!item) {
        item = normaliseAnime(media, nextSlug);
        byId.set(media.id, item);
      }
      if (!item.lists.includes(listName)) item.lists.push(listName);
    }
  };

  const seasonalResults = payload.data?.seasonal?.media || [];
  ingest(seasonalResults.length ? seasonalResults : payload.data?.trending?.media, "seasonal");
  ingest(payload.data?.trending?.media, "trending");
  ingest(payload.data?.top?.media, "top");
  ingest(payload.data?.films?.media, "films");

  const items = [...byId.values()];
  if (!items.length) throw new Error("AniList returned no media");

  // A title cannot be a film and a series pick at the same time.
  for (const item of items) {
    if (item.format === "Film" && item.lists.includes("top")) {
      item.lists = item.lists.filter((list) => list !== "top");
    }
  }

  return {
    source: "AniList",
    source_url: "https://anilist.co",
    season: `${season.charAt(0)}${season.slice(1).toLowerCase()} ${year}`,
    generated_at: new Date().toISOString(),
    count: items.length,
    items,
  };
}

/* ---------------------------------------------------------------- movies */

const TMDB_IMAGE = "https://image.tmdb.org/t/p";
const TMDB_LANGUAGE = "en-US";
const TMDB_REGION = /^[a-z]{2}$/i.test(process.env.TMDB_REGION || "")
  ? process.env.TMDB_REGION.toUpperCase()
  : "US";
const TMDB_DETAIL_CONCURRENCY = 4;

const TMDB_WATCH_GROUPS = [
  { key: "flatrate", label: "Stream" },
  { key: "free", label: "Free" },
  { key: "ads", label: "Free with ads" },
  { key: "rent", label: "Rent" },
  { key: "buy", label: "Buy" },
];

async function tmdb(pathname, params = {}) {
  // TMDB_API_BASE exists so the pipeline can be exercised against a mock. The
  // default is the real API and nothing else in the script reads this variable.
  const base = process.env.TMDB_API_BASE || "https://api.themoviedb.org/3";
  const url = new URL(`${base.replace(/\/$/, "")}${pathname}`);
  if (TMDB_KEY) url.searchParams.set("api_key", TMDB_KEY);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  try {
    return await fetchJson(url, {
      headers: TMDB_TOKEN ? { Authorization: `Bearer ${TMDB_TOKEN}` } : {},
    });
  } catch (error) {
    if (/^401\b/.test(error.message)) {
      throw new Error(
        "TMDB rejected the credentials (401). Use the v3 API key in TMDB_API_KEY or the v4 read token in TMDB_READ_TOKEN from https://www.themoviedb.org/settings/api",
      );
    }
    throw error;
  }
}

function movieMeta(item) {
  return [item.year || "", (item.genres || [])[0] || "", formatRuntime(item.runtime)]
    .filter(Boolean)
    .join(" · ");
}

/** Pick the best YouTube trailer or teaser, preferring official English results. */
function tmdbTrailer(videos) {
  const candidates = (videos?.results || []).filter(
    (video) =>
      video &&
      video.site === "YouTube" &&
      video.key &&
      (video.type === "Trailer" || video.type === "Teaser"),
  );

  const score = (video) =>
    (video.type === "Trailer" ? 4 : 0) +
    (video.official ? 2 : 0) +
    (video.iso_639_1 === "en" ? 1 : 0);

  const best = candidates
    .slice()
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        String(b.published_at || "").localeCompare(String(a.published_at || "")),
    )[0];

  return best ? `https://www.youtube.com/watch?v=${best.key}` : "";
}

/**
 * Normalise TMDB watch data for one region. TMDB/JustWatch supplies one
 * regional link, not per-provider deep links, so every provider points at that
 * region page. Availability is informational, not a playback licence.
 */
function tmdbWatchProviders(payload, mediaType, mediaId) {
  const region = payload?.results?.[TMDB_REGION];
  if (!region) {
    return { watch: [], link: "", region: "", attribution: "" };
  }

  const link =
    region.link ||
    `https://www.themoviedb.org/${mediaType}/${mediaId}/watch?locale=${TMDB_REGION}`;
  const seen = new Set();
  const watch = [];

  for (const group of TMDB_WATCH_GROUPS) {
    for (const provider of region[group.key] || []) {
      const name = stripHtml(provider?.provider_name || "");
      if (!name || seen.has(name)) continue;
      seen.add(name);
      watch.push({ name, type: group.label, url: link });
      if (watch.length >= 8) break;
    }
    if (watch.length >= 8) break;
  }

  return {
    watch,
    link: watch.length ? link : "",
    region: watch.length ? TMDB_REGION : "",
    attribution: watch.length
      ? `Availability for ${TMDB_REGION} provided by JustWatch via TMDB.`
      : "",
  };
}

function applyMovieDetails(item, details) {
  if (!details || typeof details !== "object") return;

  const releaseDate = isoDate(details.release_date);
  if (releaseDate) {
    item.release_date = releaseDate;
    item.year = Number(releaseDate.slice(0, 4)) || item.year;
  }

  if (Number.isFinite(details.runtime) && details.runtime > 0) {
    item.runtime = details.runtime;
  }

  if (Array.isArray(details.genres) && details.genres.length) {
    const names = details.genres.map((genre) => stripHtml(genre?.name || "")).filter(Boolean);
    if (names.length) item.genres = names;
  }

  if (!item.poster && details.poster_path) {
    item.poster = `${TMDB_IMAGE}/w500${details.poster_path}`;
  }
  if (!item.backdrop && details.backdrop_path) {
    item.backdrop = `${TMDB_IMAGE}/w1280${details.backdrop_path}`;
  }
  if (!item.overview && details.overview) {
    item.overview = shorten(stripHtml(details.overview), 460);
  }
  if (!item.score && details.vote_average) {
    item.score = Number(details.vote_average.toFixed(1));
  }
  if (!item.votes && details.vote_count) {
    item.votes = details.vote_count;
  }

  const trailer = tmdbTrailer(details.videos);
  if (trailer) item.trailer = trailer;

  const providers = tmdbWatchProviders(details["watch/providers"], "movie", item.tmdb_id);
  item.watch = providers.watch;
  item.watch_link = providers.link;
  item.watch_region = providers.region;
  item.watch_attribution = providers.attribution;
  item.meta = movieMeta(item);
}

/**
 * Detail requests are best-effort. If TMDB fails partway through, fill any
 * missing enrichment fields from the previous JSON so a transient error does
 * not erase valid trailers, runtime or provider data.
 */
function mergeCachedMovieDetails(item, cached) {
  if (!cached) return;

  for (const key of [
    "genres",
    "poster",
    "backdrop",
    "overview",
    "score",
    "votes",
    "runtime",
    "release_date",
    "trailer",
    "watch",
    "watch_link",
    "watch_region",
    "watch_attribution",
  ]) {
    if (
      ["watch", "watch_link", "watch_region", "watch_attribution"].includes(key) &&
      cached.watch_region !== TMDB_REGION
    ) {
      continue;
    }
    const current = item[key];
    const previous = cached[key];
    if (previous === undefined || previous === null || previous === "") continue;
    if (Array.isArray(previous) && previous.length === 0) continue;
    if (Array.isArray(current) ? current.length === 0 : !current) item[key] = previous;
  }

  item.meta = movieMeta(item);
}

async function enrichMovies(items, previous) {
  const cachedById = new Map();
  for (const cached of previous?.items || []) {
    if (cached?.id) cachedById.set(cached.id, cached);
  }

  let cursor = 0;
  let failed = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (!item.tmdb_id) continue;

      try {
        const details = await tmdb(`/movie/${item.tmdb_id}`, {
          language: TMDB_LANGUAGE,
          append_to_response: "videos,watch/providers",
        });
        applyMovieDetails(item, details);
      } catch (error) {
        failed++;
        mergeCachedMovieDetails(item, cachedById.get(item.id));
        console.warn(`   details unavailable for ${item.title}: ${error.message}`);
      }
    }
  };

  const workers = Math.min(TMDB_DETAIL_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  if (failed) {
    console.warn(
      `   ${failed}/${items.length} movie detail requests failed; cached values kept where available`,
    );
  }
}

async function moviesCatalog() {
  if (!TMDB_KEY && !TMDB_TOKEN) {
    throw new Error("no TMDB credentials (set TMDB_API_KEY or TMDB_READ_TOKEN)");
  }

  const [genres, trending, topRated, newReleases] = await Promise.all([
    tmdb("/genre/movie/list", { language: TMDB_LANGUAGE }),
    tmdb("/trending/movie/week"),
    tmdb("/movie/top_rated", { language: TMDB_LANGUAGE }),
    tmdb("/movie/now_playing", { language: TMDB_LANGUAGE, region: TMDB_REGION }),
  ]);

  const genreNames = new Map((genres.genres || []).map((g) => [g.id, g.name]));
  const nextSlug = uniqueSlugFactory();
  const byId = new Map();

  const ingest = (results, listName, limit = 18) => {
    for (const movie of (results || []).slice(0, limit)) {
      if (!movie || !movie.id) continue;

      let item = byId.get(movie.id);
      if (!item) {
        const title = stripHtml(movie.title || movie.original_title || "Untitled");
        const year = movie.release_date ? Number(movie.release_date.slice(0, 4)) : null;
        const genresForMovie = (movie.genre_ids || []).map((id) => genreNames.get(id)).filter(Boolean);

        item = {
          slug: nextSlug(title),
          id: `tmdb-${movie.id}`,
          tmdb_id: movie.id,
          title,
          original_title: stripHtml(movie.original_title || ""),
          kind: "movie",
          year,
          release_date: isoDate(movie.release_date),
          runtime: null,
          score: movie.vote_average ? Number(movie.vote_average.toFixed(1)) : null,
          votes: movie.vote_count || 0,
          overview: shorten(stripHtml(movie.overview), 460),
          poster: movie.poster_path ? `${TMDB_IMAGE}/w500${movie.poster_path}` : "",
          backdrop: movie.backdrop_path ? `${TMDB_IMAGE}/w1280${movie.backdrop_path}` : "",
          accent: "",
          genres: genresForMovie,
          meta: [year || "", genresForMovie[0] || ""].filter(Boolean).join(" · "),
          badge: listName === "new_releases" ? "In cinemas" : "",
          trailer: "",
          watch: [],
          watch_link: "",
          watch_region: "",
          watch_attribution: "",
          lists: [],
          source: "TMDB",
          source_url: `https://www.themoviedb.org/movie/${movie.id}`,
        };
        byId.set(movie.id, item);
      }

      if (!item.lists.includes(listName)) item.lists.push(listName);
    }
  };

  ingest(trending.results, "trending");
  ingest(topRated.results, "top_rated");
  ingest(newReleases.results, "new_releases");

  const items = [...byId.values()];
  if (!items.length) throw new Error("TMDB returned no movies");

  const previous = await existing("movies");
  await enrichMovies(items, previous);

  return {
    source: "TMDB",
    source_url: "https://www.themoviedb.org",
    attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    generated_at: new Date().toISOString(),
    count: items.length,
    items,
  };
}

/* ------------------------------------------------------------------- tv */

/**
 * Episode guides are the expensive part of the TV catalogue, so only a small,
 * stable slice is fetched: the first few series in catalogue order, their two
 * latest regular seasons, and at most 20 episodes per season. Season summaries
 * for every series come from the single detail request. Previous episodes are
 * reused, so daily runs do not repeat work.
 */
const TMDB_EPISODE_SERIES_LIMIT = 6;
const TMDB_EPISODE_SEASON_LIMIT = 2;
const TMDB_EPISODE_LIMIT = 20;

function seriesMeta(item) {
  const seasons = Number(item.number_of_seasons) > 0 ? item.number_of_seasons : 0;
  const seasonLabel = seasons ? `${seasons} season${seasons === 1 ? "" : "s"}` : "";
  return [item.year || "", (item.genres || [])[0] || "", seasonLabel]
    .filter(Boolean)
    .join(" · ");
}

/** Build season summaries, keeping any episode guides already cached. */
function seriesSeasonSummaries(details, cached) {
  const source =
    Array.isArray(details?.seasons) && details.seasons.length
      ? details.seasons
      : cached?.seasons || [];
  const cachedByNumber = new Map(
    (cached?.seasons || []).map((season) => [season?.season_number, season]),
  );

  return source
    .filter((season) => season && season.season_number > 0)
    .map((season) => {
      const previous = cachedByNumber.get(season.season_number);
      const episodes = Array.isArray(previous?.episodes) ? previous.episodes : [];
      return {
        season_number: season.season_number,
        name: stripHtml(season.name || `Season ${season.season_number}`),
        episode_count: Number.isFinite(season.episode_count)
          ? season.episode_count
          : episodes.length,
        air_date: isoDate(season.air_date),
        episodes,
      };
    });
}

function applySeriesDetails(item, details, cached) {
  if (!details || typeof details !== "object") return;

  const firstAir = isoDate(details.first_air_date);
  if (firstAir) {
    item.first_air_date = firstAir;
    item.year = Number(firstAir.slice(0, 4)) || item.year;
  }

  const lastAir = isoDate(details.last_air_date);
  if (lastAir) item.last_air_date = lastAir;

  if (Number.isFinite(details.number_of_seasons) && details.number_of_seasons > 0) {
    item.number_of_seasons = details.number_of_seasons;
  }
  if (Number.isFinite(details.number_of_episodes) && details.number_of_episodes > 0) {
    item.number_of_episodes = details.number_of_episodes;
  }
  if (details.status) item.status = stripHtml(details.status);

  const runtime = (details.episode_run_time || []).find((value) => value > 0);
  if (runtime) item.runtime = runtime;

  if (Array.isArray(details.genres) && details.genres.length) {
    const names = details.genres.map((genre) => stripHtml(genre?.name || "")).filter(Boolean);
    if (names.length) item.genres = names;
  }

  if (!item.poster && details.poster_path) {
    item.poster = `${TMDB_IMAGE}/w500${details.poster_path}`;
  }
  if (!item.backdrop && details.backdrop_path) {
    item.backdrop = `${TMDB_IMAGE}/w1280${details.backdrop_path}`;
  }
  if (!item.overview && details.overview) {
    item.overview = shorten(stripHtml(details.overview), 460);
  }
  if (!item.score && details.vote_average) {
    item.score = Number(details.vote_average.toFixed(1));
  }
  if (!item.votes && details.vote_count) {
    item.votes = details.vote_count;
  }

  const trailer = tmdbTrailer(details.videos);
  if (trailer) item.trailer = trailer;

  const providers = tmdbWatchProviders(details["watch/providers"], "tv", item.tmdb_id);
  item.watch = providers.watch;
  item.watch_link = providers.link;
  item.watch_region = providers.region;
  item.watch_attribution = providers.attribution;

  item.seasons = seriesSeasonSummaries(details, cached);
  item.meta = seriesMeta(item);
}

function mergeCachedSeriesDetails(item, cached) {
  if (!cached) return;

  for (const key of [
    "genres",
    "poster",
    "backdrop",
    "overview",
    "score",
    "votes",
    "runtime",
    "first_air_date",
    "last_air_date",
    "number_of_seasons",
    "number_of_episodes",
    "status",
    "trailer",
    "watch",
    "watch_link",
    "watch_region",
    "watch_attribution",
    "seasons",
  ]) {
    if (
      ["watch", "watch_link", "watch_region", "watch_attribution"].includes(key) &&
      cached.watch_region !== TMDB_REGION
    ) {
      continue;
    }
    const current = item[key];
    const previous = cached[key];
    if (previous === undefined || previous === null || previous === "") continue;
    if (Array.isArray(previous) && previous.length === 0) continue;
    if (Array.isArray(current) ? current.length === 0 : !current) item[key] = previous;
  }

  item.meta = seriesMeta(item);
}

async function enrichSeriesEpisodes(items) {
  const targets = items
    .filter(
      (item) =>
        item.tmdb_id && (item.seasons || []).some((season) => season.episode_count > 0),
    )
    .slice(0, TMDB_EPISODE_SERIES_LIMIT);

  let cursor = 0;
  let failed = 0;

  const worker = async () => {
    while (cursor < targets.length) {
      const item = targets[cursor++];
      const seasons = item.seasons
        .filter((season) => season.season_number > 0 && season.episode_count > 0)
        .slice(-TMDB_EPISODE_SEASON_LIMIT);

      for (const season of seasons) {
        if (Array.isArray(season.episodes) && season.episodes.length) continue;

        try {
          const payload = await tmdb(
            `/tv/${item.tmdb_id}/season/${season.season_number}`,
            { language: TMDB_LANGUAGE },
          );
          const episodes = (payload.episodes || [])
            .filter((episode) => episode && Number.isFinite(episode.episode_number))
            .sort((a, b) => a.episode_number - b.episode_number)
            .slice(0, TMDB_EPISODE_LIMIT)
            .map((episode) => ({
              episode_number: episode.episode_number,
              name: stripHtml(episode.name || `Episode ${episode.episode_number}`),
              overview: shorten(stripHtml(episode.overview), 320),
              air_date: isoDate(episode.air_date),
              runtime:
                Number.isFinite(episode.runtime) && episode.runtime > 0
                  ? episode.runtime
                  : null,
            }));
          season.episodes = episodes;
        } catch (error) {
          failed++;
          console.warn(
            `   episodes unavailable for ${item.title} S${season.season_number}: ${error.message}`,
          );
        }
      }
    }
  };

  const workers = Math.min(TMDB_DETAIL_CONCURRENCY, targets.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  if (failed) {
    console.warn(
      `   ${failed} season episode request${failed === 1 ? "" : "s"} failed; cached or empty guides kept`,
    );
  }
}

async function enrichSeries(items, previous) {
  const cachedById = new Map();
  for (const cached of previous?.items || []) {
    if (cached?.id) cachedById.set(cached.id, cached);
  }

  let cursor = 0;
  let failed = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (!item.tmdb_id) continue;
      const cached = cachedById.get(item.id);

      try {
        const details = await tmdb(`/tv/${item.tmdb_id}`, {
          language: TMDB_LANGUAGE,
          append_to_response: "videos,watch/providers",
        });
        applySeriesDetails(item, details, cached);
      } catch (error) {
        failed++;
        mergeCachedSeriesDetails(item, cached);
        console.warn(`   details unavailable for ${item.title}: ${error.message}`);
      }
    }
  };

  const workers = Math.min(TMDB_DETAIL_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  if (failed) {
    console.warn(
      `   ${failed}/${items.length} TV detail requests failed; cached values kept where available`,
    );
  }

  await enrichSeriesEpisodes(items);
}

async function seriesCatalog() {
  if (!TMDB_KEY && !TMDB_TOKEN) {
    throw new Error("no TMDB credentials (set TMDB_API_KEY or TMDB_READ_TOKEN)");
  }

  const [genres, trending, topRated, onTheAir] = await Promise.all([
    tmdb("/genre/tv/list", { language: TMDB_LANGUAGE }),
    tmdb("/trending/tv/week"),
    tmdb("/tv/top_rated", { language: TMDB_LANGUAGE }),
    tmdb("/tv/on_the_air", { language: TMDB_LANGUAGE }),
  ]);

  const genreNames = new Map((genres.genres || []).map((genre) => [genre.id, genre.name]));
  const nextSlug = uniqueSlugFactory();
  const byId = new Map();

  const ingest = (results, listName, limit = 18) => {
    for (const show of (results || []).slice(0, limit)) {
      if (!show || !show.id) continue;

      let item = byId.get(show.id);
      if (!item) {
        const title = stripHtml(show.name || show.original_name || "Untitled");
        const firstAir = isoDate(show.first_air_date);
        const year = firstAir ? Number(firstAir.slice(0, 4)) : null;
        const genresForShow = (show.genre_ids || [])
          .map((id) => genreNames.get(id))
          .filter(Boolean);

        item = {
          slug: nextSlug(title),
          id: `tmdb-tv-${show.id}`,
          tmdb_id: show.id,
          title,
          original_title: stripHtml(show.original_name || ""),
          kind: "series",
          year,
          first_air_date: firstAir,
          last_air_date: "",
          score: show.vote_average ? Number(show.vote_average.toFixed(1)) : null,
          votes: show.vote_count || 0,
          overview: shorten(stripHtml(show.overview), 460),
          poster: show.poster_path ? `${TMDB_IMAGE}/w500${show.poster_path}` : "",
          backdrop: show.backdrop_path ? `${TMDB_IMAGE}/w1280${show.backdrop_path}` : "",
          accent: "",
          genres: genresForShow,
          meta: [year || "", genresForShow[0] || ""].filter(Boolean).join(" · "),
          badge: "",
          trailer: "",
          watch: [],
          watch_link: "",
          watch_region: "",
          watch_attribution: "",
          status: "",
          number_of_seasons: null,
          number_of_episodes: null,
          runtime: null,
          seasons: [],
          lists: [],
          source: "TMDB",
          source_url: `https://www.themoviedb.org/tv/${show.id}`,
        };
        byId.set(show.id, item);
      }

      if (!item.lists.includes(listName)) item.lists.push(listName);
      if (listName === "on_the_air") item.badge = "On air";
    }
  };

  ingest(trending.results, "trending");
  ingest(topRated.results, "top_rated");
  ingest(onTheAir.results, "on_the_air");

  const items = [...byId.values()];
  if (!items.length) throw new Error("TMDB returned no TV series");

  const previous = await existing("series");
  await enrichSeries(items, previous);

  return {
    source: "TMDB",
    source_url: "https://www.themoviedb.org",
    attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    generated_at: new Date().toISOString(),
    count: items.length,
    items,
  };
}

/* ---------------------------------------------------------------- sports */

/** ESPN scoreboards: no key, generous limits, real fixtures and crests. */
const ESPN_LEAGUES = [
  { path: "soccer/eng.1", label: "Premier League", group: "football" },
  { path: "soccer/esp.1", label: "La Liga", group: "football" },
  { path: "soccer/ita.1", label: "Serie A", group: "football" },
  { path: "soccer/ger.1", label: "Bundesliga", group: "football" },
  { path: "soccer/uefa.champions", label: "Champions League", group: "football" },
  { path: "basketball/nba", label: "NBA", group: "basketball" },
  { path: "racing/f1", label: "Formula 1", group: "motorsport" },
];

/** TheSportsDB fallback, used when every ESPN scoreboard fails. */
const LEAGUES = [
  { id: "4328", label: "Premier League", group: "football" },
  { id: "4335", label: "La Liga", group: "football" },
  { id: "4480", label: "Serie A", group: "football" },
  { id: "4387", label: "NBA", group: "basketball" },
  { id: "4370", label: "Formula 1", group: "motorsport" },
];

/**
 * TheSportsDB signals its rate limit in a 200 body, not a status code. Retry
 * once with a longer pause so a transient throttle does not erase a league.
 */
async function sportsDbJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return assertNotRateLimited(await fetchJson(url, { retries: 1 }));
    } catch (error) {
      lastError = error;
      const throttled = /rate|limit|too many|busy|slow/i.test(error.message);
      if (attempt === 2 || !throttled) throw error;
      console.warn(`   throttled, retrying in 5s: ${error.message}`);
      await sleep(5000);
    }
  }
  throw lastError;
}

async function espnCatalog(observedAt) {
  const nextSlug = uniqueSlugFactory();
  const seen = new Set();
  const items = [];
  const leagueStatus = [];

  for (const league of ESPN_LEAGUES) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard`;
    let payload;
    try {
      payload = await fetchJson(url, { retries: 2 });
    } catch (error) {
      console.warn(`   skipped ${league.path}: ${error.message}`);
      leagueStatus.push({
        path: league.path,
        label: league.label,
        group: league.group,
        status: "unavailable",
        count: 0,
        error: error.message,
      });
      continue;
    }

    const leagueName = league.label || payload.leagues?.[0]?.name || league.path;
    let count = 0;
    for (const event of payload.events || []) {
      if (!event?.id || seen.has(event.id)) continue;
      seen.add(event.id);

      // One malformed event must never abort the other leagues or let the
      // fallback replace a valid ESPN cache.
      try {
        const item = normaliseEspnEvent(event, {
          group: league.group,
          leagueName,
          leaguePath: league.path,
          observedAt,
        });
        if (!item) continue;
        item.slug = nextSlug(`${event.id}-${item.title}`);
        item.fetched_at = observedAt;
        items.push(item);
        count += 1;
      } catch (error) {
        console.warn(`   skipped event ${event.id}: ${error.message}`);
      }
    }

    leagueStatus.push({
      path: league.path,
      label: leagueName,
      group: league.group,
      status: "fresh",
      count,
    });

    await sleep(250);
  }

  return { items: sortSportsItems(items), league_status: leagueStatus };
}

async function sportsDbCatalog(observedAt) {
  const nextSlug = uniqueSlugFactory();
  const seen = new Set();
  const items = [];
  const leagueStatus = [];

  for (const league of LEAGUES) {
    let succeeded = false;
    let count = 0;

    for (const endpoint of ["eventsnextleague", "eventspastleague"]) {
      const url = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/${endpoint}.php?id=${league.id}`;
      let payload;
      try {
        payload = await sportsDbJson(url);
        succeeded = true;
      } catch (error) {
        console.warn(`   skipped ${endpoint} ${league.id}: ${error.message}`);
        continue;
      }

      for (const event of (payload.events || []).slice(0, 8)) {
        if (!event?.idEvent || seen.has(event.idEvent)) continue;
        seen.add(event.idEvent);
        try {
          const item = normaliseSportsDbEvent(event, {
            group: league.group,
            leagueId: league.id,
            observedAt,
          });
          if (!item) continue;
          item.slug = nextSlug(`${event.idEvent}-${item.title}`);
          item.fetched_at = observedAt;
          items.push(item);
          count += 1;
        } catch (error) {
          console.warn(`   skipped event ${event.idEvent}: ${error.message}`);
        }
      }

      // The public key throttles hard, so pace the requests deliberately.
      await sleep(2500);
    }

    leagueStatus.push({
      path: `sportsdb-${league.id}`,
      label: league.label || league.id,
      group: league.group,
      status: succeeded ? "fresh" : "unavailable",
      count,
    });
  }

  if (!items.length) throw new Error("TheSportsDB returned no events");

  return {
    source: "TheSportsDB",
    source_url: "https://www.thesportsdb.com",
    key_type: SPORTSDB_KEY === "123" ? "test" : "personal",
    generated_at: observedAt,
    count: items.length,
    items: sortSportsItems(items),
    league_status: leagueStatus,
  };
}

async function sportsCatalog(previous) {
  const observedAt = new Date().toISOString();
  let espn = null;
  let espnError = "";

  try {
    espn = await espnCatalog(observedAt);
  } catch (error) {
    espnError = error.message;
    console.warn(`   ESPN unavailable: ${error.message}`);
  }

  if (espn?.items?.length) {
    const merged = mergeSportsSnapshot(
      {
        source: "ESPN",
        source_url: "https://www.espn.com",
        generated_at: observedAt,
        count: espn.items.length,
        items: espn.items,
        league_status: espn.league_status,
      },
      previous,
      { now: new Date(observedAt) },
    );

    if (merged.partial) {
      console.warn(`   kept cached fixtures for: ${(merged.carried_leagues || []).join(", ") || "failed leagues"}`);
    }
    return merged;
  }

  // A provider failure is not a reason to overwrite a valid cache. Throwing
  // makes main() keep the previous file and report it as cached.
  if (previous?.items?.length) {
    throw new Error(`ESPN unavailable (${espnError || "no events"}); keeping cached sports data`);
  }

  console.warn("   no cached sports data; trying TheSportsDB fallback");
  return sportsDbCatalog(observedAt);
}

/* ------------------------------------------------------------------ main */

async function existing(name) {
  try {
    return JSON.parse(await readFile(path.join(OUT_DIR, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Report how the catalogue is configured and how complete the committed data
 * is. This is the check to run after adding a key: it never calls an API.
 */
async function printStatus() {
  console.log(
    TMDB_CREDENTIAL.configured
      ? `TMDB: configured (${TMDB_CREDENTIAL.message}) · region ${TMDB_REGION}`
      : `TMDB: ${TMDB_CREDENTIAL.message}`,
  );
  console.log(
    `TheSportsDB: ${SPORTSDB_KEY === "123" ? "public test key (rate limited)" : "custom key"}`,
  );
  console.log("");

  for (const name of ["movies", "series", "anime", "sports"]) {
    const data = await existing(name);
    if (!data) {
      console.log(`  ${name.padEnd(7)} no catalogue file`);
      continue;
    }

    const items = Array.isArray(data.items) ? data.items : [];
    const count = (predicate) => items.filter(predicate).length;
    const poster = count((item) => item.poster);
    const trailer = count((item) => item.trailer);
    const watch = count((item) => Array.isArray(item.watch) && item.watch.length > 0);
    const episodes = count(
      (item) => Array.isArray(item.seasons) && item.seasons.some((season) => season.episodes?.length),
    );

    console.log(
      `  ${name.padEnd(7)} ${String(items.length).padStart(3)} items · ${poster} posters · ` +
        `${trailer} trailers · ${watch} with watch links` +
        (name === "series" ? ` · ${episodes} with episode guides` : "") +
        ` · ${data.source || "unknown source"}`,
    );

    if (name === "sports") {
      const states = items.reduce((counts, item) => {
        const state = item.state || "unknown";
        counts[state] = (counts[state] || 0) + 1;
        return counts;
      }, {});
      console.log(
        `          states: ${Object.entries(states)
          .map(([state, count]) => `${state} ${count}`)
          .join(" · ")}`,
      );
      console.log(
        `          refreshed ${data.generated_at || "unknown"}` +
          (data.partial ? ` · partial (${(data.carried_leagues || []).join(", ")})` : ""),
      );
      const unavailable = (data.league_status || []).filter((league) => league.status !== "fresh");
      if (unavailable.length) {
        console.log(`          unavailable leagues: ${unavailable.map((league) => league.label || league.path).join(", ")}`);
      }
    }
  }

  const movies = await existing("movies");
  const series = await existing("series");
  const stale = [movies, series]
    .filter((data) => data && (data.items || []).some((item) => !item.poster))
    .map((data) => data.source);

  console.log("");
  if (!TMDB_CREDENTIAL.configured) {
    console.log(
      "Movies and series stay on the committed cache until a key is set: no film artwork, trailers, watch providers or episode guides.",
    );
    console.log("Add one with TMDB_API_KEY (v3) or TMDB_READ_TOKEN (v4), then run again without --status.");
  } else if (stale.length) {
    console.log(`Run the fetch to fill in missing artwork: ${stale.join(", ")}`);
  } else {
    console.log("Every movie and series has artwork.");
  }
}

async function main() {
  if (statusOnly) {
    await printStatus();
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });

  const jobs = [
    { name: "anime", run: animeCatalog },
    { name: "movies", run: moviesCatalog },
    { name: "series", run: seriesCatalog },
    { name: "sports", run: sportsCatalog },
  ].filter((job) => wants(job.name));

  let live = 0;
  let kept = 0;
  let failed = 0;

  for (const job of jobs) {
    process.stdout.write(`→ ${job.name} … `);
    const previous = await existing(job.name);
    try {
      const data = await job.run(previous);
      const validation = validateCatalogue(job.name, data);
      if (!validation.ok) {
        throw new Error(validation.errors.slice(0, 3).join("; "));
      }
      for (const warning of validation.warnings.slice(0, 5)) console.warn(`\n   warning: ${warning}`);
      await writeFile(path.join(OUT_DIR, `${job.name}.json`), `${JSON.stringify(data, null, 2)}\n`, "utf8");
      console.log(`${data.count} items from ${data.source}${data.partial ? " (partial refresh)" : ""}`);
      live++;
    } catch (error) {
      const hint = /TMDB credentials/.test(error.message)
        ? "\n  \u2192 copy .env.example to .env and set TMDB_API_KEY for live movie and TV data"
        : "";
      if (previous) {
        console.log(`kept ${previous.count} cached items (${error.message})${hint}`);
        kept++;
      } else {
        console.log(`no data (${error.message})${hint}`);
        failed++;
      }
    }
  }

  console.log(
    `\n${live} refreshed · ${kept} kept from cache · ${failed} unavailable` +
      (failed && !live && !kept ? "\nRun failed: no catalogue data at all." : ""),
  );

  if (failed && !live && !kept) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

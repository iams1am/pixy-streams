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
 *
 * Environment:
 *   TMDB_API_KEY     TMDB v3 key            (movies; skipped when absent)
 *   TMDB_READ_TOKEN  TMDB v4 read token     (alternative to the key)
 *   SPORTSDB_KEY     TheSportsDB key        (defaults to the public test key)
 *
 * A source that fails leaves its previous JSON file untouched, so a flaky API
 * or a missing key never breaks the build.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "data", "catalog");
const UA = "PixyStreams/1.0 (+https://github.com/iams1am/pixy-streams)";
const TIMEOUT_MS = 25_000;

const SPORTSDB_KEY = process.env.SPORTSDB_KEY || "123";
const TMDB_KEY = process.env.TMDB_API_KEY || "";
const TMDB_TOKEN = process.env.TMDB_READ_TOKEN || "";

const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";
const wants = (name) => !only || only.split(",").includes(name);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- helpers */

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
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(backoff * attempt);
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

function shorten(text, max) {
  const value = String(text || "");
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

function stripHtml(input) {
  return String(input || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
      if (ENTITIES[code]) return ENTITIES[code];
      if (code[0] === "#") {
        const value = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) ? String.fromCharCode(value) : match;
      }
      return match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(input) {
  const value = stripHtml(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return value || "untitled";
}

function uniqueSlugFactory() {
  const seen = new Map();
  return (input) => {
    const base = slugify(input);
    const hits = seen.get(base) || 0;
    seen.set(base, hits + 1);
    return hits === 0 ? base : `${base}-${hits + 1}`;
  };
}

const isoDate = (value) => (value ? String(value).slice(0, 10) : "");

function formatRuntime(minutes) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatDay(iso) {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

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
    coverImage { extraLarge color }
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

async function tmdb(pathname, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  if (TMDB_KEY) url.searchParams.set("api_key", TMDB_KEY);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  return fetchJson(url, {
    headers: TMDB_TOKEN ? { Authorization: `Bearer ${TMDB_TOKEN}` } : {},
  });
}

async function moviesCatalog() {
  if (!TMDB_KEY && !TMDB_TOKEN) {
    throw new Error("no TMDB credentials (set TMDB_API_KEY or TMDB_READ_TOKEN)");
  }

  const [genres, trending, topRated, newReleases] = await Promise.all([
    tmdb("/genre/movie/list", { language: "en-US" }),
    tmdb("/trending/movie/week"),
    tmdb("/movie/top_rated", { language: "en-US" }),
    tmdb("/movie/now_playing", { language: "en-US", region: "US" }),
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
          title,
          original_title: stripHtml(movie.original_title || ""),
          kind: "movie",
          year,
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
  { id: "4328", group: "football" },
  { id: "4335", group: "football" },
  { id: "4480", group: "football" },
  { id: "4387", group: "basketball" },
  { id: "4370", group: "motorsport" },
];

const SPORTS_GROUP_LABELS = {
  football: "Football",
  basketball: "Basketball",
  motorsport: "Motorsport",
};

function normaliseEvent(event, group) {
  const homeScore = event.intHomeScore;
  const awayScore = event.intAwayScore;
  const finished = homeScore !== null && homeScore !== undefined && homeScore !== "";
  const date = isoDate(event.dateEvent);
  const kickoff = event.strTimestamp || (event.strTime ? `${date}T${event.strTime}` : "");
  const score = finished ? `${homeScore}-${awayScore}` : "";
  const league = stripHtml(event.strLeague || "");
  const title = stripHtml(event.strEvent || "");

  return {
    slug: slugify(`${event.idEvent}-${title}`),
    id: `sportsdb-${event.idEvent}`,
    title,
    kind: "event",
    group,
    sport: stripHtml(event.strSport || ""),
    league,
    home: { name: stripHtml(event.strHomeTeam || ""), logo: event.strHomeTeamBadge || "", record: "" },
    away: { name: stripHtml(event.strAwayTeam || ""), logo: event.strAwayTeamBadge || "", record: "" },
    score,
    year: date ? Number(date.slice(0, 4)) : null,
    date,
    time: event.strTime || "",
    kickoff,
    venue: stripHtml(event.strVenue || ""),
    overview: shorten(stripHtml(event.strDescriptionEN || ""), 320),
    poster: event.strThumb || event.strHomeTeamBadge || "",
    backdrop: event.strThumb || "",
    accent: "",
    genres: [SPORTS_GROUP_LABELS[group] || "Sport"],
    meta: [league, finished ? `FT ${score}` : formatDay(date)].filter(Boolean).join(" · "),
    badge: finished ? "Final" : "",
    trailer: "",
    watch: event.strVideo ? [{ name: "Highlights on YouTube", url: `https://www.youtube.com/watch?v=${event.strVideo}` }] : [],
    lists: [finished ? "results" : "upcoming"],
    href: `https://www.thesportsdb.com/event/${event.idEvent}`,
    source: "TheSportsDB",
    source_url: `https://www.thesportsdb.com/event/${event.idEvent}`,
  };
}

function espnEvent(event, group, leagueName, leaguePath) {
  const competition = (event.competitions || [])[0] || {};
  const competitors = competition.competitors || [];
  const pick = (side, index) =>
    competitors.find((entry) => entry.homeAway === side) || competitors[index] || null;

  const home = pick("home", 0);
  const away = pick("away", 1);
  const state = event.status?.type?.state || "pre";
  const finished = state === "post";
  const live = state === "in";
  const date = isoDate(event.date);
  const time = (event.date || "").slice(11, 16);
  const hasTeams = Boolean(home && away);

  const score = hasTeams && (finished || live) ? `${home.score}-${away.score}` : "";
  const title = hasTeams ? `${home.team.displayName} vs ${away.team.displayName}` : stripHtml(event.name || "");
  const league = stripHtml(leagueName || "");

  const when = finished
    ? `FT ${score}`
    : live
      ? `Live ${score}`
      : [formatDay(date), time ? `${time} UTC` : ""].filter(Boolean).join(", ");

  return {
    slug: "",
    id: `espn-${event.id}`,
    title,
    kind: "event",
    group,
    sport: group === "football" ? "Soccer" : group === "basketball" ? "Basketball" : "Motorsport",
    league,
    home: home ? { name: stripHtml(home.team.displayName || ""), logo: home.team.logo || "", record: home.records?.[0]?.summary || "" } : null,
    away: away ? { name: stripHtml(away.team.displayName || ""), logo: away.team.logo || "", record: away.records?.[0]?.summary || "" } : null,
    score,
    year: date ? Number(date.slice(0, 4)) : null,
    date,
    time,
    kickoff: event.date || "",
    venue: stripHtml(competition.venue?.fullName || ""),
    overview: stripHtml(event.status?.type?.detail || ""),
    poster: "",
    backdrop: "",
    accent: "",
    genres: [SPORTS_GROUP_LABELS[group] || "Sport"],
    meta: [league, when].filter(Boolean).join(" · "),
    badge: live ? "Live" : finished ? "FT" : "",
    trailer: "",
    watch: [],
    lists: [live ? "live" : finished ? "results" : "upcoming"],
    href: event.links?.[0]?.href || `https://www.espn.com/${leaguePath}`,
    source: "ESPN",
    source_url: event.links?.[0]?.href || `https://www.espn.com/${leaguePath}`,
  };
}

async function espnCatalog() {
  const nextSlug = uniqueSlugFactory();
  const seen = new Set();
  const items = [];

  for (const league of ESPN_LEAGUES) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard`;
    let payload;
    try {
      payload = await fetchJson(url, { retries: 2 });
    } catch (error) {
      console.warn(`   skipped ${league.path}: ${error.message}`);
      continue;
    }

    const leagueName = league.label || payload.leagues?.[0]?.name || league.path;
    for (const event of payload.events || []) {
      if (!event?.id || seen.has(event.id)) continue;
      seen.add(event.id);
      const item = espnEvent(event, league.group, leagueName, league.path);
      item.slug = nextSlug(`${event.id}-${item.title}`);
      if (item.title) items.push(item);
    }

    await sleep(250);
  }

  items.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  return items;
}

async function sportsDbCatalog() {
  const nextSlug = uniqueSlugFactory();
  const seen = new Set();
  const items = [];

  for (const league of LEAGUES) {
    for (const endpoint of ["eventsnextleague", "eventspastleague"]) {
      const url = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/${endpoint}.php?id=${league.id}`;
      let payload;
      try {
        payload = assertNotRateLimited(await fetchJson(url, { retries: 2, backoff: 4000 }));
      } catch (error) {
        console.warn(`   skipped ${endpoint} ${league.id}: ${error.message}`);
        continue;
      }

      for (const event of (payload.events || []).slice(0, 8)) {
        if (!event?.idEvent || seen.has(event.idEvent)) continue;
        seen.add(event.idEvent);
        const item = normaliseEvent(event, league.group);
        item.slug = nextSlug(`${event.idEvent}-${item.title}`);
        items.push(item);
      }

      // The public key throttles hard, so pace the requests deliberately.
      await sleep(2500);
    }
  }

  if (!items.length) throw new Error("TheSportsDB returned no events");

  items.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));

  return {
    source: "TheSportsDB",
    source_url: "https://www.thesportsdb.com",
    key_type: SPORTSDB_KEY === "123" ? "test" : "personal",
    generated_at: new Date().toISOString(),
    count: items.length,
    items,
  };
}

async function sportsCatalog() {
  let items = [];
  let source = "ESPN";
  let sourceUrl = "https://www.espn.com";

  try {
    items = await espnCatalog();
  } catch (error) {
    console.warn(`   ESPN unavailable: ${error.message}`);
  }

  if (!items.length) {
    const fallback = await sportsDbCatalog();
    items = fallback.items;
    source = fallback.source;
    sourceUrl = fallback.source_url;
  }

  if (!items.length) throw new Error("no sports fixtures available");

  return {
    source,
    source_url: sourceUrl,
    generated_at: new Date().toISOString(),
    count: items.length,
    items,
  };
}

/* ------------------------------------------------------------------ main */

async function existing(name) {
  try {
    return JSON.parse(await readFile(path.join(OUT_DIR, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const jobs = [
    { name: "anime", run: animeCatalog },
    { name: "movies", run: moviesCatalog },
    { name: "sports", run: sportsCatalog },
  ].filter((job) => wants(job.name));

  let live = 0;
  let kept = 0;
  let failed = 0;

  for (const job of jobs) {
    process.stdout.write(`→ ${job.name} … `);
    try {
      const data = await job.run();
      await writeFile(path.join(OUT_DIR, `${job.name}.json`), `${JSON.stringify(data, null, 2)}\n`, "utf8");
      console.log(`${data.count} items from ${data.source}`);
      live++;
    } catch (error) {
      const previous = await existing(job.name);
      if (previous) {
        console.log(`kept ${previous.count} cached items (${error.message})`);
        kept++;
      } else {
        console.log(`no data (${error.message})`);
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

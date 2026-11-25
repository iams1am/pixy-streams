/**
 * Sports event normalisation shared by the catalogue fetcher, the post-build
 * checks and the unit tests. Nothing in this module performs network access.
 *
 * The important product rule lives here as data, not just copy: an event has a
 * score state and, separately, optional official links. A live score is never a
 * playback source, and `watch` only ever contains links the provider published
 * as highlights.
 */

import { formatDay, isoDate, stripHtml } from "./text-utils.mjs";

export const SPORTS_GROUP_LABELS = {
  football: "Football",
  basketball: "Basketball",
  motorsport: "Motorsport",
};

export const SPORTS_STATES = [
  "scheduled",
  "live",
  "finished",
  "postponed",
  "canceled",
  "suspended",
  "delayed",
];

const SCORE_STATES = new Set(["live", "finished", "suspended", "delayed"]);

export function stateLabel(state, group = "") {
  switch (state) {
    case "live":
      return "Live score";
    case "finished":
      return group === "football" ? "Full time" : "Final";
    case "postponed":
      return "Postponed";
    case "canceled":
      return "Canceled";
    case "suspended":
      return "Suspended";
    case "delayed":
      return "Delayed";
    default:
      return "Scheduled";
  }
}

export function badgeForState(state) {
  if (state === "live") return "Live score";
  if (state === "finished") return "FT";
  if (state === "postponed" || state === "canceled") return "Off";
  return "";
}

export function normaliseKickoff(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  // Provider timestamps are treated as UTC when they omit an offset. The UI
  // labels the source clock as UTC and converts it in the browser.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00Z`;
  const withZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  // Go's time parser requires seconds. ESPN sometimes sends "T00:30Z" while
  // the browser tolerates it, so normalise before Hugo reads the value.
  return withZone.replace(/T(\d{2}:\d{2})(?=(?:z|[+-]\d{2}:?\d{2})?$)/i, "T$1:00");
}

export function espnStatus(status, group = "") {
  const type = status?.type || {};
  const name = String(type.name || "").toUpperCase();
  const description = String(type.description || type.detail || "").toLowerCase();
  const detail = stripHtml(type.shortDetail || type.detail || status?.displayClock || "");

  if (/CANCEL|ABANDON/.test(name) || /cancel|abandon/.test(description)) {
    return { state: "canceled", label: stateLabel("canceled", group), detail };
  }
  if (/POSTPON/.test(name) || /postpon/.test(description)) {
    return { state: "postponed", label: stateLabel("postponed", group), detail };
  }
  if (/SUSPEND/.test(name) || /suspend/.test(description)) {
    return { state: "suspended", label: stateLabel("suspended", group), detail };
  }
  if (/DELAY/.test(name) || /delay/.test(description)) {
    return { state: "delayed", label: stateLabel("delayed", group), detail };
  }
  if (type.state === "in") {
    const clock = stripHtml(status?.displayClock || "");
    const liveDetail = clock && !detail.includes(clock) ? [detail, clock].filter(Boolean).join(" · ") : detail;
    return { state: "live", label: stateLabel("live", group), detail: liveDetail };
  }
  if (type.state === "post" || type.completed) {
    return { state: "finished", label: stateLabel("finished", group), detail };
  }
  return { state: "scheduled", label: stateLabel("scheduled", group), detail };
}

export function sportsDbStatus(event, group = "") {
  const status = String(event?.strStatus || "").toLowerCase();
  const progress = String(event?.strProgress || "").toLowerCase();
  const hasScore =
    event?.intHomeScore !== null &&
    event?.intHomeScore !== undefined &&
    event?.intHomeScore !== "" &&
    event?.intAwayScore !== null &&
    event?.intAwayScore !== undefined &&
    event?.intAwayScore !== "";

  if (/cancel|abandon/.test(status)) return { state: "canceled", label: stateLabel("canceled", group), detail: "Canceled" };
  if (/postpon/.test(status)) return { state: "postponed", label: stateLabel("postponed", group), detail: "Postponed" };
  if (/suspend/.test(status)) return { state: "suspended", label: stateLabel("suspended", group), detail: "Suspended" };
  if (/delay/.test(status)) return { state: "delayed", label: stateLabel("delayed", group), detail: "Delayed" };
  if (/live|in progress|1h|2h|ht|half|q[1-4]/.test(`${status} ${progress}`)) {
    return { state: "live", label: stateLabel("live", group), detail: stripHtml(event?.strProgress || event?.strStatus || "") };
  }
  if (/finish|final|ft|ended|after/.test(status) || hasScore) {
    return { state: "finished", label: stateLabel("finished", group), detail: stripHtml(event?.strStatus || "") };
  }
  return { state: "scheduled", label: stateLabel("scheduled", group), detail: "" };
}

export function formatScore(homeScore, awayScore) {
  const clean = (value) => (value === null || value === undefined || value === "" ? "" : String(value).trim());
  const home = clean(homeScore);
  const away = clean(awayScore);
  return home && away ? `${home}-${away}` : "";
}

function teamInfo(competitor) {
  const team = competitor?.team;
  if (!team) return null;
  const links = Array.isArray(team.links) ? team.links : [];
  const link =
    links.find((entry) => (entry.rel || []).some((rel) => ["clubhouse", "team"].includes(rel)))?.href ||
    links.find((entry) => (entry.rel || []).includes("stats"))?.href ||
    "";
  const record =
    competitor.records?.find((entry) => entry.type === "total")?.summary ||
    competitor.records?.[0]?.summary ||
    "";

  return {
    name: stripHtml(team.displayName || team.name || ""),
    short_name: stripHtml(team.shortDisplayName || team.name || ""),
    abbreviation: stripHtml(team.abbreviation || ""),
    logo: team.logo || "",
    record: stripHtml(record),
    form: stripHtml(competitor.form || ""),
    color: team.color || "",
    link: link.startsWith("http") ? link : "",
  };
}

export function espnBroadcasts(competition) {
  const broadcasts = [];
  const seen = new Set();
  const add = (name, type, market, region, url = "") => {
    const cleanName = stripHtml(name || "");
    if (!cleanName) return;
    const key = [cleanName, type, market, region].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    const cleanUrl = String(url || "").startsWith("http") ? url : "";
    broadcasts.push({
      name: cleanName,
      type: stripHtml(type || ""),
      market: stripHtml(market || ""),
      region: String(region || "").toUpperCase(),
      ...(cleanUrl ? { url: cleanUrl } : {}),
    });
  };

  for (const entry of competition.geoBroadcasts || []) {
    const href = entry.media?.links?.web?.href || entry.media?.links?.mobile?.href || "";
    add(entry.media?.shortName, entry.type?.shortName, entry.market?.type, entry.region, href);
  }
  if (!broadcasts.length) {
    for (const entry of competition.broadcasts || []) {
      for (const name of entry.names || []) add(name, "TV", entry.market, "");
    }
  }
  return broadcasts;
}

export function espnLinks(event, leaguePath = "") {
  const links = Array.isArray(event.links) ? event.links : [];
  const find = (...rels) =>
    links.find((entry) => (entry.rel || []).some((rel) => rels.includes(rel)))?.href || "";
  const fixture =
    find("summary", "event") ||
    links.find((entry) => String(entry.href || "").startsWith("https://www.espn.com/"))?.href ||
    (leaguePath ? `https://www.espn.com/${leaguePath}` : "");

  return {
    fixture,
    recap: find("recap", "report"),
    results: find("results"),
    boxscore: find("boxscore"),
    highlights: find("highlights", "video"),
  };
}

function sessionsFor(event, group) {
  const competitions = Array.isArray(event.competitions) ? event.competitions : [];
  if (group !== "motorsport" && competitions.length < 2) return [];
  return competitions
    .map((competition, index) => {
      const status = espnStatus(competition.status || event.status, group);
      return {
        label: stripHtml(competition.type?.abbreviation || competition.type?.text || `Session ${index + 1}`),
        kickoff: normaliseKickoff(competition.date || event.date),
        state: status.state,
        state_label: status.label,
        status_detail: status.detail,
      };
    })
    .filter((session) => session.label || session.kickoff);
}

export function normaliseEspnEvent(event, { group, leagueName, leaguePath, observedAt = new Date().toISOString() }) {
  if (!event?.id) return null;

  const competition = (event.competitions || [])[0] || {};
  const status = espnStatus(competition.status || event.status, group);
  const innerDate = competition.date || event.date || "";
  const date = isoDate(innerDate);
  const kickoff = normaliseKickoff(innerDate);
  const time = kickoff ? kickoff.slice(11, 16) : "";

  const competitors = competition.competitors || [];
  const homeCompetitor =
    competitors.find((entry) => entry.homeAway === "home") || competitors.find((entry) => entry.type === "team") || null;
  const awayCompetitor =
    competitors.find((entry) => entry.homeAway === "away") ||
    competitors.filter((entry) => entry.type === "team")[1] ||
    null;
  const home = homeCompetitor?.team ? teamInfo(homeCompetitor) : null;
  const away = awayCompetitor?.team ? teamInfo(awayCompetitor) : null;
  const hasTeams = Boolean(home?.name && away?.name);

  const score = hasTeams && SCORE_STATES.has(status.state) ? formatScore(homeCompetitor?.score, awayCompetitor?.score) : "";
  const title = hasTeams
    ? `${home.name} vs ${away.name}`
    : stripHtml(event.name || event.shortName || competition.notes?.[0]?.headline || "");
  if (!title) return null;

  const league = stripHtml(leagueName || "");
  const when =
    status.state === "live"
      ? [status.label, score].filter(Boolean).join(" ")
      : status.state === "finished"
        ? [status.label, score].filter(Boolean).join(" ")
        : [formatDay(date), time ? `${time} UTC` : ""].filter(Boolean).join(", ");

  const links = espnLinks(event, leaguePath);
  const broadcasts = espnBroadcasts(competition);
  const watch = links.highlights
    ? [{ name: "Official highlights on ESPN", url: links.highlights, type: "Highlights" }]
    : [];

  return {
    slug: "",
    id: `espn-${event.id}`,
    title,
    kind: "event",
    group,
    sport: group === "football" ? "Soccer" : group === "basketball" ? "Basketball" : "Motorsport",
    league,
    league_key: leaguePath || "",
    state: status.state,
    state_label: status.label,
    status_detail: status.detail,
    badge: badgeForState(status.state),
    home,
    away,
    home_score: hasTeams && SCORE_STATES.has(status.state) ? String(homeCompetitor?.score ?? "") : "",
    away_score: hasTeams && SCORE_STATES.has(status.state) ? String(awayCompetitor?.score ?? "") : "",
    score,
    year: date ? Number(date.slice(0, 4)) : null,
    date,
    time,
    time_utc: time ? `${time} UTC` : "",
    date_label: formatDay(date),
    kickoff,
    venue: stripHtml(competition.venue?.fullName || event.venue?.fullName || ""),
    overview: ["live", "finished"].includes(status.state) ? stripHtml(status.detail || "") : "",
    poster: "",
    backdrop: "",
    accent: "",
    genres: [SPORTS_GROUP_LABELS[group] || "Sport"],
    meta: [league, when].filter(Boolean).join(" · "),
    trailer: "",
    watch,
    broadcasts,
    links,
    sessions: sessionsFor(event, group),
    lists: [status.state === "live" ? "live" : status.state === "finished" ? "results" : "upcoming"],
    href: links.fixture,
    source: "ESPN",
    source_url: links.fixture,
    observed_at: observedAt,
    stale: false,
  };
}

export function normaliseSportsDbEvent(event, { group, leagueId = "", observedAt = new Date().toISOString() }) {
  if (!event?.idEvent) return null;

  const status = sportsDbStatus(event, group);
  const date = isoDate(event.dateEvent);
  const rawKickoff = event.strTimestamp || (date && event.strTime ? `${date}T${event.strTime}` : date);
  const kickoff = normaliseKickoff(rawKickoff);
  const time = kickoff ? kickoff.slice(11, 16) : "";
  const homeName = stripHtml(event.strHomeTeam || "");
  const awayName = stripHtml(event.strAwayTeam || "");
  const hasTeams = Boolean(homeName && awayName);
  const homeScore = event.intHomeScore;
  const awayScore = event.intAwayScore;
  const score = hasTeams && SCORE_STATES.has(status.state) ? formatScore(homeScore, awayScore) : "";
  const title = stripHtml(event.strEvent || (hasTeams ? `${homeName} vs ${awayName}` : ""));
  if (!title) return null;

  const league = stripHtml(event.strLeague || "");
  const fixture = `https://www.thesportsdb.com/event/${event.idEvent}`;
  const video = event.strVideo ? `https://www.youtube.com/watch?v=${event.strVideo}` : "";
  const when =
    status.state === "live" || status.state === "finished"
      ? [status.label, score].filter(Boolean).join(" ")
      : [formatDay(date), time ? `${time} UTC` : ""].filter(Boolean).join(", ");
  const broadcastNames = String(event.strTVStation || "")
    .split(",")
    .map((name) => stripHtml(name))
    .filter(Boolean);

  return {
    slug: "",
    id: `sportsdb-${event.idEvent}`,
    title,
    kind: "event",
    group,
    sport: stripHtml(event.strSport || ""),
    league,
    league_key: leagueId ? `sportsdb-${leagueId}` : "",
    state: status.state,
    state_label: status.label,
    status_detail: status.detail,
    badge: badgeForState(status.state),
    home: hasTeams ? { name: homeName, short_name: homeName, abbreviation: "", logo: event.strHomeTeamBadge || "", record: "", form: "", color: "", link: "" } : null,
    away: hasTeams ? { name: awayName, short_name: awayName, abbreviation: "", logo: event.strAwayTeamBadge || "", record: "", form: "", color: "", link: "" } : null,
    home_score: hasTeams && SCORE_STATES.has(status.state) ? String(homeScore ?? "") : "",
    away_score: hasTeams && SCORE_STATES.has(status.state) ? String(awayScore ?? "") : "",
    score,
    year: date ? Number(date.slice(0, 4)) : null,
    date,
    time,
    time_utc: time ? `${time} UTC` : "",
    date_label: formatDay(date),
    kickoff,
    venue: stripHtml(event.strVenue || ""),
    overview: stripHtml(event.strDescriptionEN || ""),
    poster: event.strThumb || event.strHomeTeamBadge || "",
    backdrop: event.strThumb || "",
    accent: "",
    genres: [SPORTS_GROUP_LABELS[group] || "Sport"],
    meta: [league, when].filter(Boolean).join(" · "),
    trailer: "",
    watch: video ? [{ name: "Official highlights on YouTube", url: video, type: "Highlights" }] : [],
    broadcasts: broadcastNames.map((name) => ({ name, type: "TV", market: "", region: "" })),
    links: { fixture, recap: "", results: "", boxscore: "", highlights: video },
    sessions: [],
    lists: [status.state === "live" ? "live" : status.state === "finished" ? "results" : "upcoming"],
    href: fixture,
    source: "TheSportsDB",
    source_url: fixture,
    observed_at: observedAt,
    stale: false,
  };
}

export function sortSportsItems(items) {
  return [...items].sort((a, b) => String(a.kickoff || "").localeCompare(String(b.kickoff || "")));
}

/**
 * Keep cached items for leagues that failed on this refresh. A partial provider
 * response must not silently erase the rest of the sports desk, and carried
 * items are marked stale so the UI can say so.
 */
export function mergeSportsSnapshot(fresh, previous, { now = new Date(), maxCarryDays = 14 } = {}) {
  if (!fresh?.items?.length) return fresh;

  const statusByPath = new Map((fresh.league_status || []).map((entry) => [entry.path, entry.status]));
  const freshPaths = new Set((fresh.league_status || []).filter((entry) => entry.status === "fresh").map((entry) => entry.path));
  const freshLeagues = new Set(fresh.items.map((item) => item.league_key).filter(Boolean));
  const carried = [];
  const cutoff = now.getTime() - maxCarryDays * 86_400_000;

  for (const item of previous?.items || []) {
    if (!item?.league_key) continue;
    const pathStatus = statusByPath.get(item.league_key);
    if (pathStatus === "fresh") continue;
    if (!pathStatus && freshLeagues.has(item.league_key)) continue;

    const kickoff = Date.parse(item.kickoff || item.date || "");
    if (Number.isFinite(kickoff) && kickoff < cutoff) continue;

    carried.push({
      ...item,
      stale: true,
      fetched_at: item.fetched_at || previous.generated_at || "",
    });
  }

  const items = sortSportsItems([...fresh.items, ...carried]);
  const carriedLeagues = [...new Set(carried.map((item) => item.league).filter(Boolean))];

  return {
    ...fresh,
    items,
    count: items.length,
    partial: carried.length > 0,
    carried_leagues: carriedLeagues,
  };
}

import test from "node:test";
import assert from "node:assert/strict";

import {
  badgeForState,
  espnStatus,
  mergeSportsSnapshot,
  normaliseEspnEvent,
  normaliseKickoff,
  normaliseSportsDbEvent,
  stateLabel,
} from "./lib/sports-model.mjs";
import { validateCatalogue } from "./lib/catalogue-validation.mjs";

const observedAt = "2026-11-25T02:00:00.000Z";

function teamEvent(overrides = {}) {
  return {
    id: "401900001",
    name: "Arsenal at Chelsea",
    date: "2026-11-25T20:00Z",
    status: { type: { state: "pre", name: "STATUS_SCHEDULED", description: "Scheduled", shortDetail: "Scheduled" } },
    links: [{ rel: ["summary", "event"], href: "https://www.espn.com/soccer/match/_/gameId/401900001" }],
    competitions: [
      {
        date: "2026-11-25T20:00Z",
        status: { type: { state: "pre", name: "STATUS_SCHEDULED", description: "Scheduled", shortDetail: "Scheduled" } },
        venue: { fullName: "Stamford Bridge" },
        geoBroadcasts: [
          { media: { shortName: "USA Net" }, type: { shortName: "TV" }, market: { type: "National" }, region: "us" },
        ],
        competitors: [
          {
            homeAway: "home",
            type: "team",
            score: "0",
            form: "WWDLW",
            records: [{ type: "total", summary: "10-2-3" }],
            team: {
              displayName: "Chelsea",
              shortDisplayName: "Chelsea",
              abbreviation: "CHE",
              logo: "https://a.espncdn.com/i/teamlogos/soccer/500/363.png",
              links: [{ rel: ["clubhouse", "team"], href: "https://www.espn.com/soccer/club/_/id/363/chelsea" }],
            },
          },
          {
            homeAway: "away",
            type: "team",
            score: "0",
            form: "LWWWW",
            records: [{ type: "total", summary: "11-1-2" }],
            team: {
              displayName: "Arsenal",
              shortDisplayName: "Arsenal",
              abbreviation: "ARS",
              logo: "https://a.espncdn.com/i/teamlogos/soccer/500/359.png",
              links: [],
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

test("ESPN status distinguishes live scores, full time and postponements", () => {
  assert.deepEqual(espnStatus({ type: { state: "in", name: "STATUS_IN_PROGRESS", shortDetail: "2nd half" }, displayClock: "67'" }, "football"), {
    state: "live",
    label: "Live score",
    detail: "2nd half · 67'",
  });
  assert.equal(espnStatus({ type: { state: "post", name: "STATUS_FULL_TIME", shortDetail: "FT" } }, "football").state, "finished");
  assert.equal(espnStatus({ type: { state: "post", name: "STATUS_POSTPONED", description: "Postponed" } }).state, "postponed");
  assert.equal(stateLabel("finished", "basketball"), "Final");
  assert.equal(badgeForState("live"), "Live score");
});

test("a scheduled ESPN fixture keeps its UTC kickoff and broadcaster names", () => {
  const item = normaliseEspnEvent(teamEvent(), {
    group: "football",
    leagueName: "Premier League",
    leaguePath: "soccer/eng.1",
    observedAt,
  });

  assert.equal(item.title, "Chelsea vs Arsenal");
  assert.equal(item.state, "scheduled");
  assert.equal(item.score, "");
  assert.equal(item.kickoff, "2026-11-25T20:00:00Z");
  assert.equal(item.time_utc, "20:00 UTC");
  assert.equal(item.badge, "");
  assert.deepEqual(item.lists, ["upcoming"]);
  assert.equal(item.home.record, "10-2-3");
  assert.equal(item.home.form, "WWDLW");
  assert.equal(item.home.link, "https://www.espn.com/soccer/club/_/id/363/chelsea");
  assert.deepEqual(item.broadcasts, [{ name: "USA Net", type: "TV", market: "National", region: "US" }]);
  assert.equal(item.links.fixture, "https://www.espn.com/soccer/match/_/gameId/401900001");
});

test("minute-precision kickoffs gain seconds so Hugo can parse them", () => {
  assert.equal(normaliseKickoff("2026-11-20T00:30Z"), "2026-11-20T00:30:00Z");
  assert.equal(normaliseKickoff("2026-11-20T00:30"), "2026-11-20T00:30:00Z");
  assert.equal(normaliseKickoff("2026-11-20T01:30+02:00"), "2026-11-20T01:30:00+02:00");
});

test("broadcaster links are kept only when the provider supplies an http(s) url", () => {
  const withLink = teamEvent({
    competitions: [
      {
        ...teamEvent().competitions[0],
        geoBroadcasts: [
          {
            media: { shortName: "Sky Sports", links: { web: { href: "https://www.skysports.com/" } } },
            type: { shortName: "TV" },
            market: { type: "National" },
            region: "gb",
          },
        ],
      },
    ],
  });
  const item = normaliseEspnEvent(withLink, {
    group: "football",
    leagueName: "Premier League",
    leaguePath: "soccer/eng.1",
    observedAt,
  });

  assert.deepEqual(item.broadcasts, [
    { name: "Sky Sports", type: "TV", market: "National", region: "GB", url: "https://www.skysports.com/" },
  ]);
});

test("a live ESPN basketball score is labelled a live score, not live video", () => {
  const item = normaliseEspnEvent(
    {
      id: "401900002",
      name: "Celtics at Wizards",
      date: "2026-11-25T01:00Z",
      status: { type: { state: "in", name: "STATUS_IN_PROGRESS", shortDetail: "3rd" }, displayClock: "6:57" },
      links: [
        { rel: ["summary", "event"], href: "https://www.espn.com/nba/game/_/gameId/401900002" },
        { rel: ["highlights"], href: "https://www.espn.com/nba/video?gameId=401900002" },
      ],
      competitions: [
        {
          status: { type: { state: "in", name: "STATUS_IN_PROGRESS", shortDetail: "3rd" }, displayClock: "6:57" },
          competitors: [
            { homeAway: "home", type: "team", score: "65", team: { displayName: "Wizards" } },
            { homeAway: "away", type: "team", score: "90", team: { displayName: "Celtics" } },
          ],
        },
      ],
    },
    { group: "basketball", leagueName: "NBA", leaguePath: "basketball/nba", observedAt },
  );

  assert.equal(item.state, "live");
  assert.equal(item.state_label, "Live score");
  assert.equal(item.badge, "Live score");
  assert.equal(item.score, "65-90");
  assert.deepEqual(item.lists, ["live"]);
  assert.equal(item.watch.length, 1);
  assert.equal(item.watch[0].type, "Highlights");
});

test("motorsport events normalise without team competitors", () => {
  const item = normaliseEspnEvent(
    {
      id: "600000001",
      name: "Las Vegas Grand Prix",
      date: "2026-11-20T00:30Z",
      status: { type: { state: "post", name: "STATUS_FINAL", shortDetail: "Final" } },
      links: [{ rel: ["summary", "event"], href: "https://www.espn.com/f1/race/_/id/600000001" }],
      competitions: [
        { date: "2026-11-20T00:30Z", status: { type: { state: "post", name: "STATUS_FINAL" } }, type: { abbreviation: "FP1" } },
        { date: "2026-11-22T04:00Z", status: { type: { state: "post", name: "STATUS_FINAL" } }, type: { abbreviation: "Race" } },
      ],
    },
    { group: "motorsport", leagueName: "Formula 1", leaguePath: "racing/f1", observedAt },
  );

  assert.equal(item.title, "Las Vegas Grand Prix");
  assert.equal(item.home, null);
  assert.equal(item.score, "");
  assert.equal(item.state, "finished");
  assert.equal(item.sessions.length, 2);
  assert.equal(item.sessions[1].label, "Race");
});

test("one malformed ESPN event returns no item instead of throwing", () => {
  assert.equal(
    normaliseEspnEvent(
      { id: "broken", competitions: [{ competitors: [{ homeAway: "home" }, { homeAway: "away" }] }] },
      { group: "football", leagueName: "Test", leaguePath: "soccer/test", observedAt },
    ),
    null,
  );
});

test("TheSportsDB results carry scores, highlights and a fixture link", () => {
  const item = normaliseSportsDbEvent(
    {
      idEvent: "12345",
      strEvent: "Arsenal vs Chelsea",
      strLeague: "English Premier League",
      strHomeTeam: "Arsenal",
      strAwayTeam: "Chelsea",
      intHomeScore: "2",
      intAwayScore: "1",
      dateEvent: "2026-11-24",
      strTime: "20:00:00",
      strTimestamp: "2026-11-24T20:00:00",
      strStatus: "Match Finished",
      strVideo: "abc123",
      strTVStation: "Sky Sports",
    },
    { group: "football", leagueId: "4328", observedAt },
  );

  assert.equal(item.state, "finished");
  assert.equal(item.state_label, "Full time");
  assert.equal(item.score, "2-1");
  assert.equal(item.kickoff, "2026-11-24T20:00:00Z");
  assert.equal(item.watch[0].url, "https://www.youtube.com/watch?v=abc123");
  assert.deepEqual(item.broadcasts, [{ name: "Sky Sports", type: "TV", market: "", region: "" }]);
});

test("partial refreshes keep cached items for failed leagues only", () => {
  const previous = {
    generated_at: "2026-11-24T00:00:00.000Z",
    items: [
      { id: "old-1", league_key: "soccer/eng.1", league: "Premier League", kickoff: "2026-11-26T20:00Z", title: "Old PL" },
      { id: "old-2", league_key: "soccer/esp.1", league: "La Liga", kickoff: "2026-11-26T20:00Z", title: "Old La Liga" },
      { id: "old-3", league_key: "soccer/ita.1", league: "Serie A", kickoff: "2026-11-01T20:00Z", title: "Too old" },
    ],
  };
  const fresh = {
    generated_at: "2026-11-25T00:00:00.000Z",
    items: [{ id: "new-1", league_key: "soccer/eng.1", league: "Premier League", kickoff: "2026-11-27T20:00Z", title: "New PL" }],
    league_status: [
      { path: "soccer/eng.1", status: "fresh" },
      { path: "soccer/esp.1", status: "unavailable" },
      { path: "soccer/ita.1", status: "unavailable" },
    ],
  };

  const merged = mergeSportsSnapshot(fresh, previous, { now: new Date("2026-11-25T12:00:00Z"), maxCarryDays: 14 });
  assert.equal(merged.partial, true);
  assert.deepEqual(merged.carried_leagues, ["La Liga"]);
  assert.deepEqual(merged.items.map((item) => item.id), ["old-2", "new-1"]);
  assert.equal(merged.items[0].stale, true);
});

test("kickoff timestamps without an offset are treated as UTC", () => {
  assert.equal(normaliseKickoff("2026-11-25T20:00:00"), "2026-11-25T20:00:00Z");
  assert.equal(normaliseKickoff("2026-11-25"), "2026-11-25T00:00:00Z");
  assert.equal(normaliseKickoff("2026-11-25T20:00:00+01:00"), "2026-11-25T20:00:00+01:00");
});

test("catalogue validation rejects a live event without a score", () => {
  const data = {
    source: "ESPN",
    generated_at: observedAt,
    count: 1,
    items: [
      {
        id: "espn-1",
        slug: "test",
        title: "A vs B",
        kind: "event",
        group: "football",
        league: "Test League",
        state: "live",
        badge: "Live score",
        score: "",
        date: "2026-11-25",
        kickoff: "2026-11-25T20:00Z",
        lists: ["live"],
        href: "https://www.espn.com/game",
        source: "ESPN",
        broadcasts: [],
        sessions: [],
        links: { fixture: "https://www.espn.com/game" },
        home: { name: "A" },
        away: { name: "B" },
      },
    ],
  };

  const result = validateCatalogue("sports", data);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /missing a home-away score/);
});

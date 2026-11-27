# Pixy Streams

A movie, TV series, anime and sport discovery site. Static, fast, and built to be
hosted free on GitHub Pages.

Pixy Streams is a **discovery layer**: it shows metadata, artwork, trailers and
where-to-watch links. It does not host or stream copyrighted video. Full-length
playback is added only through the verified-rights registry described below.

## Stack

| Piece | Choice |
|---|---|
| Static site generator | Hugo (extended, v0.154+) |
| Theme | `alert` - custom, in `themes/alert/` |
| Styling | Hand-written CSS with light/dark tokens, no framework |
| Hosting | GitHub Pages, built and published by GitHub Actions |
| Catalogue build | `node scripts/fetch-catalog.mjs` (no dependencies) |
| Data | TMDB (film and TV), AniList (anime), ESPN + TheSportsDB (sport) |
| Fonts | Inter and Space Grotesk, self-hosted variable WOFF2 |

## Structure

```
hugo.toml                   site config, navigation, taxonomies
scripts/fetch-catalog.mjs   build-time catalogue fetch and normalisation
scripts/check-site.mjs      post-build links, navigation, metadata and a11y checks
scripts/check-playback.mjs  validates the verified-rights playback registry
scripts/check-catalog.mjs   offline validation of the committed catalogue
scripts/check-config.mjs    Hugo config, required files and secret hygiene
scripts/check-browser.mjs   headless Chrome smoke test (no npm dependencies)
scripts/lib/playback-model.mjs  shared playback states, resolver and validation
scripts/lib/sports-model.mjs    fixture normalisation, score states and merging
scripts/lib/catalogue-validation.mjs  catalogue schema validation
data/catalog/               generated: anime.json, movies.json, series.json, sports.json
data/playback/registry.json verified full-content sources (3 public-domain films)
data/playback/samples.json  the curated free-film library those records cover
data/home.yaml              hero fallback, stats, quick links
docs/PLAYBACK_MODEL.md      playback schema, states and rights requirements
docs/BACKEND_DECISION.md    proposed content-request backend decision (Phase 5.1, not built)
docs/PHASE_STATUS.md        per-phase implementation and verification record
docs/RELEASE_REPORT.md      Phase 6 release-readiness evidence and limitations
docs/DEPLOYMENT.md          deployment, rollback and troubleshooting guide
content/
  _index.md                 homepage copy
  movies/_content.gotmpl    generates one page per movie
  tv/_content.gotmpl        generates one page per TV series
  anime/_content.gotmpl     generates one page per anime title
  movies/ tv/ anime/ sports/ my-list/ about/
  search/_index.md          full search results page
layouts/
  catalog/page.html         title page for a generated catalogue entry
  sport-event/page.html     sports event detail page
  sport-event/page.calendar.ics   build-time calendar for scheduled fixtures
  movies|tv|anime|sports/section.html   rails for each vertical
  search/section.html       full search page shell
  robots.txt                crawler rules and the absolute sitemap URL
  _partials/ics-text.html   iCalendar text escaping
  term.html taxonomy.html   genre browsing
themes/alert/               design system: CSS, JS, shared partials
  assets/js/search-core.js  shared query matcher for header and full page
  assets/js/search-page.js  full-page results and genre discovery
```

## Local development

```bash
node scripts/fetch-catalog.mjs    # refresh data/catalog/*.json
hugo server -D                    # http://localhost:1313
hugo --gc --minify                # production build into public/
node scripts/check-config.mjs     # config, required files and secret scan
node scripts/check-catalog.mjs    # committed catalogue schema and freshness
node scripts/check-site.mjs       # links, base path, nav, a11y and metadata
node scripts/check-playback.mjs   # playback registry and rights records
node scripts/check-browser.mjs    # real Chrome smoke test (needs Chrome or Edge)
node --test scripts/*.test.mjs    # sports and playback model tests
```

Node 22+ is needed for the checks and the browser test. The generated JSON is
committed, so a plain `hugo` build works without Node or network access.

`check-site.mjs` fails on dead or un-prefixed internal links, wrong
`aria-current`, missing width/height on images, heading-order jumps, missing
skip links or landmark ids, duplicate ids, a malformed search index and leaked
credentials. `check-browser.mjs` drives the built site in headless Chrome to
prove search, keyboard flow, the mobile drawer, genre discovery and local watch
history. The deploy workflow runs both before uploading, so a broken build never
publishes.

## Catalogue pipeline

`scripts/fetch-catalog.mjs` talks to each source, normalises the results into one
shape, and writes `data/catalog/<vertical>.json`. Templates read those files; Hugo
then generates the rails, section pages and one page per title.

| Source | Needs a key | Provides |
|---|---|---|
| AniList GraphQL | no | seasonal, trending and top anime, films, trailers, official streaming links |
| ESPN scoreboards | no | football, NBA and F1 fixtures, results, team crests |
| TMDB | yes | trending, top-rated and now-playing films, plus trending, top-rated and on-air TV series with artwork, runtime, trailers, season guides and regional watch availability |
| TheSportsDB | optional | fallback fixtures source when ESPN is unavailable |

```bash
node scripts/fetch-catalog.mjs                  # everything
node scripts/fetch-catalog.mjs --only=anime     # one vertical
node scripts/fetch-catalog.mjs --only=movies    # films (needs a TMDB key)
node scripts/fetch-catalog.mjs --only=series    # TV series (needs a TMDB key)
```

Environment variables: `TMDB_API_KEY` (or `TMDB_READ_TOKEN`), `TMDB_REGION`
(optional ISO 3166-1 watch region, default `US`), `SPORTSDB_KEY`.
Put them in a `.env` file at the repo root - copy `.env.example`, which is the
committed template while `.env` itself is git-ignored. Shell values win over the
file. The deploy workflow reads `TMDB_REGION` from a repository variable with the
same name; leave it unset to use `US`.

Without a TMDB key the movies vertical keeps the curated seed in
`data/catalog/movies.json` and the script reports `kept … cached items` instead of
failing. With a key it replaces the seed with live trending, top-rated and
now-playing films, complete with posters, backdrops, runtime, official trailers
and regional watch availability. A source that errors also leaves its previous
JSON untouched, so a flaky API never breaks a build. If only a per-movie detail
request fails, the previous trailer, provider and runtime values for that title
are kept where available.

The TV vertical follows the same pattern with `series.json`. Episode guides are
deliberately bounded: the first six series in catalogue order, their two latest
regular seasons, and at most 20 episodes per season. Cached guides are reused on
later runs, and a failed season request never removes an existing guide. Season
summaries for every series come from the single detail request.

Keys are read at build time only. Nothing secret is shipped to the browser, which
is why this is a build step rather than client-side `fetch()`.

## Getting a TMDB key

TMDB is free for non-commercial use and needs an account:

1. Sign in at <https://www.themoviedb.org>, open **Settings → API**, and request a
   developer key.
2. Copy **either** the *API Key (v3 auth)* — 32 hex characters — **or** the *API
   Read Access Token (v4 auth)*, a JWT that starts with `eyJ`.
3. Put it in `.env` (copy `.env.example` first). A v3 key goes in `TMDB_API_KEY`;
   the v4 token goes in `TMDB_READ_TOKEN`. Set `TMDB_REGION` to your ISO 3166-1
   country code if it is not `US`.
4. Check the wiring before running anything expensive:

   ```bash
   node scripts/fetch-catalog.mjs --status
   ```

   The report shows whether TMDB is configured, which region is active, and how
   many items in the committed catalogue have posters, trailers, watch links and
   episode guides. A key in the wrong variable is rejected by name, so a swapped
   pair never surfaces as a bare 401.
5. Refresh one vertical and inspect the result:

   ```bash
   node scripts/fetch-catalog.mjs --only=movies
   node scripts/fetch-catalog.mjs --only=series
   ```

For the deployed site, add `TMDB_API_KEY` or `TMDB_READ_TOKEN` under **Settings →
Secrets and variables → Actions → Secrets**, and optionally `TMDB_REGION` under
**Variables**. The workflow prints the same coverage report on every run, so a
missing or malformed secret is visible in the log.

Once a key is active, movie and series pages gain live artwork, official
trailers, regional watch providers and episode guides. Until then the curated
seed is served, which is why film cards currently show monograms instead of
posters.

## Playback sources

Playback status is separate from catalogue metadata. Every title resolves to one
of four states: `play_here`, `official_provider`, `trailer_only` or
`unavailable`. Only a record in `data/playback/registry.json` can produce
`play_here`; TMDB availability and AniList links never do.

The committed registry holds three Internet Archive films that are public domain
in the United States. `/watch/` plays each one from its verified MP4 derivative
with native HTML5 controls, and every page also links to the archive's official
player. The native player stores progress in `localStorage`, offers a resume
prompt, and lists in-progress films in a Continue Watching rail on `/watch/`.
Cards show "N% watched" with a bottom progress track, or "Watched" when the film
was finished; completed titles leave Continue Watching. A confirmed "Clear watch
history" control removes both progress and completed records. If a stream
delivers no metadata within 20 seconds, the page shows a slow-stream notice with
the official-player link; a hard source error replaces the player. Everything
else on the site is discovery only.

Adding a source requires a recorded rights basis, HTTPS evidence, a named
reviewer, an availability region and a provider/method pair that matches.
Internet Archive sources may use the official embed or a native MP4 record; a
native record must name the exact file that its download URL points at.
`node scripts/check-playback.mjs` fails the build if any of that is missing, and
`docs/PLAYBACK_MODEL.md` documents the full schema. The state line on every title
page is generated by `themes/alert/layouts/_partials/playback-state.html`, which
mirrors the model and reads the region from `playbackRegion` in `hugo.toml`.

## Sports desk

`/sports/` shows fixtures, results and score states from the ESPN scoreboards,
with TheSportsDB as a fallback. Each event has a page with the scoreline, team
records and form where the provider supplies them, venue, sessions, fixture
links, official highlights and broadcaster listings. Kick-off times are stored
in UTC and converted to the visitor's device time by `main.js`; without
JavaScript the UTC value remains readable.

The page separates **live scores** from **live video**. A score is an
informational snapshot from the last catalogue build; Pixy Streams does not
host, mirror or link to live sports streams. Broadcaster names are listings
only, and a broadcaster link is rendered only when the provider publishes one.
The section also shows the refresh time, per-league counts, cached league
statuses and an explicit partial-refresh note.

Scheduled event pages add an **Add to calendar** download. The `.ics` file is
generated at build time from the same UTC kick-off data; motorsport weekends
include each session. It is a schedule export, not a stream or a rights claim.

`normaliseKickoff` adds seconds to provider timestamps before Hugo parses them,
and `mergeSportsSnapshot` keeps cached fixtures for leagues that failed without
overwriting healthy leagues. `node --test scripts/*.test.mjs` covers score
states, kick-off normalisation, broadcaster links, partial recovery and
catalogue validation.

## Catalogue reliability

Every fetch has a 25-second timeout, two retries and honours `Retry-After` (capped
at 20 seconds). A source that fails leaves its previous JSON file untouched, so a
temporary provider outage never replaces valid data with an empty catalogue.
Sports refreshes merge per league and mark carried fixtures as cached; movie and
series detail failures keep the cached trailer, providers, runtime and episode
guide for that title. `check-catalog.mjs` validates the committed files (schema,
duplicate ids/slugs, score states, fixture links, freshness), and the movie, TV
and anime pages show the snapshot time and a warning when a cache is older than
its freshness window.

## Performance

Measured cold in headless Edge on the local production build at 1440×950, DPR 1,
with remote artwork enabled. These are desktop lab numbers, not field data:

| Page | Before | After |
|---|---|---|
| Home | 2,089 KB · LCP 1,400 ms · CLS 0.13 | 1,131 KB · LCP 288 ms · CLS 0 |
| Title detail | 2,439 KB · LCP 140 ms | 839 KB · LCP 84 ms |
| Sports | 1,311 KB · LCP 132 ms · CLS 0.013 | 1,727 KB · LCP 120 ms · CLS 0 |
| Movies | 173 KB · LCP 180 ms | 181 KB · LCP 92 ms |

Changes that produced the numbers: the same Inter and Space Grotesk families are
now self-hosted as two variable WOFF2 files (69 KB total) and preloaded, removing
the render-blocking Google Fonts stylesheet and the font-swap layout shift; anime
covers use a 230 px `poster_small` in a `srcset` (460 px on 2× screens) instead of
loading 460 px artwork into 168 px cards; every image has intrinsic dimensions;
CSS and JS are fingerprinted and load deferred. At 390 px the home LCP is 312 ms
and the sports and detail LCPs are under 110 ms, with no horizontal overflow.

The watch page's largest-contentful-paint is not representative when the media
request is blocked: the player waits for metadata and the measurement sees the
later error state. The initial document, CSS, JS and fonts total about 172 KB;
the film itself streams only when the visitor plays it.

Home still downloads roughly 0.9 MB of catalogue artwork because several rails
are within the lazy-loading threshold. It is bounded by the catalogue size and
uses smaller variants, not by a speculative layout rewrite.

## Editing the homepage

`data/home.yaml` covers what is not in the catalogue:

- `hero` - fallback hero, used only when the catalogue has no featured title
- `rows` - fallback rails, used only when `data/catalog/` is empty
- `stats` - the four-number strip
- `quick_links` - the jump-back-in cards (icon: `film`, `sparkles`, `trophy`, `bookmark`)

The featured hero, the rails and the genre chips are all derived from the
catalogue and the `genres` taxonomy, so they need no manual editing.

## Navigation

Top-level items live in `[[menu.main]]`. Dropdowns are created by giving a child
entry `parent = "<identifier>"`; the header renders `MenuEntry.Children`.

```toml
[[menu.main]]
  identifier = "movies"
  name = "Movies"
  url = "/movies/"
  weight = 2

[[menu.main]]
  parent = "movies"
  name = "Trending Now"
  url = "/movies/#trending"
  weight = 1
```

Internal links in templates go through `partials/link.html`, which prefixes the
site base path so the site works from the `/pixy-streams/` subpath. The current
page gets `aria-current="page"`; the home link only matches the site root exactly
so it does not also mark every page under the base path.

## Search and personalisation

The header search reads the build-time `/search.json` index. Focusing it shows
the most common genres with counts and a link to `/genres/`; typing two or more
characters returns categorised results (Movie, TV Series, Anime, Sport, Free
film) with a live result count. Arrow keys, Home, End, Enter and Escape work
without leaving the field, and `/` focuses search from anywhere. On mobile the
shortcut opens the menu first. Loading, no-match and unavailable states are
explicit rather than silent.

When a query has more than eight matches, the header adds a "View all N results"
option at the end of the keyboard list. It opens `/search/?q=...`, a shareable
full-results page that uses the same matcher, lists every match and offers genre
discovery when the query is empty or has no results. A single-select type filter
narrows the matches to All, Movie, TV Series, Anime, Sport or Free film; counts
follow the current query, the choice is kept in `&type=...`, and a type with no
matches keeps the filter visible so All can restore the full set. The page
updates its URL and document title as you type, supports Escape to clear, and has
a no-JavaScript fallback linking to the catalogues and genre hub. `/search/` is
also linked from the footer under Browse.

Local records are versioned and read defensively:

| Key | Shape | Purpose |
|---|---|---|
| `pixy-my-list` | `{ version: 1, items: [...] }` | saved titles |
| `pixy:watch:progress:<id>` | `{ version: 1, t, d, at }` | native-player position |
| `pixy:watch:completed` | `{ version: 1, items: [...] }` | finished films |

Earlier raw arrays and objects are still accepted; malformed or blocked storage
falls back to empty data. Completed titles are excluded from Continue Watching
and recommendations, and personal rails stay hidden until real local data
exists. There are no accounts or cloud synchronization.

## Deployment

Live at <https://iams1am.github.io/pixy-streams/>, deployed by
`.github/workflows/deploy.yml`. Every push to `main` runs the unit tests, the
configuration/secret scan and the catalogue validation, refreshes the catalogue,
builds with Hugo, runs the site, playback and browser checks, then publishes
through GitHub Pages. A daily `cron` run at 05:00 UTC does the same so fixtures
and seasonal anime do not go stale, and `workflow_dispatch` covers manual runs.
The build also emits `robots.txt` with the sitemap URL and an `event.ics` for
every scheduled fixture.

See `docs/DEPLOYMENT.md` for the full flow, required secrets, local previews,
rollback and troubleshooting. In short: the workflow reads `TMDB_API_KEY`,
`TMDB_READ_TOKEN`, `SPORTSDB_KEY` and the optional `TMDB_REGION` variable from
repository settings; a missing secret leaves that source on its committed JSON,
so the site still builds. Pages uses `build_type: workflow`, which allows
`actions/deploy-pages` to publish the artifact; no `gh-pages` branch is needed.

## Roadmap

- **Done** - rebrand, streaming homepage, rails, genres, nav dropdowns
- **Done** - build-time catalogue fetch, generated title pages, live posters
- **Done** - client-side search over a build-time index, My List in `localStorage`
- **Done** - trailer modal on title pages, scheduled catalogue refresh workflow
- **Done** - TV catalogue, browse-all grids with sorting, post-build checks in CI
- **Done** - playback model, rights registry, three verified public-domain films on `/watch/` with native MP4 playback and Continue Watching
- **Done** - Phase 4 premium UX: search discovery and keyboard support, server-rendered navigation state, versioned My List/watch history, reduced-motion and accessibility polish
- **Done** - Phase 6.1 sports desk: upcoming fixtures, league status, styled event pages, local times and a hard live-score/live-video boundary
- **Done** - Phase 6.2 catalogue reliability: retries, cache preservation, partial sports recovery, schema validation and freshness indicators
- **Done** - Phase 6.3 measured performance: self-hosted variable fonts, responsive cover art, intrinsic image dimensions, zero measured layout shift
- **Done** - Phase 6.4 QA: 35 unit tests, config/secret scan, stricter site checks and a 14-assertion headless-browser smoke test in CI
- **Done** - Phase 6.5 documentation and release report
- **Done** - Phase 7 full search: shared matcher, keyboard-accessible "View all", `/search/` results page with shareable queries and genre discovery
- **Done** - Phase 8 search type filters: query-aware counts, `&type=` URL state, filtered empty states and keyboard focus retention
- **Done** - Phase 9 sports calendars: build-time `.ics` downloads for scheduled fixtures, session events for motorsport, and `robots.txt` with the sitemap URL
- **Skipped by owner** - Phase 5 content-request backend (5.1-5.4); the proposed Cloudflare Workers + D1 decision remains in `docs/BACKEND_DECISION.md` and nothing was deployed
- **Blocked** - live TMDB credentials for movie artwork, film trailers and episode guides
- **Later** - more verified public-domain films, and Vimeo/self-hosted playback when authorized content needs it

## Attribution

Film data and artwork come from TMDB. This product uses the TMDB API but is not
endorsed or certified by TMDB. Anime data from AniList, fixtures from ESPN, with
TheSportsDB as a fallback.

## Licence

Site code: MIT. Metadata and artwork belong to their respective sources and
rights holders.

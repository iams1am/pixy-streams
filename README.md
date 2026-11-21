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
| Hosting | GitHub Pages, served from the `gh-pages` branch |
| Catalogue build | `node scripts/fetch-catalog.mjs` (no dependencies) |
| Data | TMDB (film and TV), AniList (anime), ESPN + TheSportsDB (sport) |

## Structure

```
hugo.toml                   site config, navigation, taxonomies
scripts/fetch-catalog.mjs   build-time catalogue fetch and normalisation
scripts/check-site.mjs      post-build link, metadata and security checks
scripts/check-playback.mjs  validates the verified-rights playback registry
scripts/lib/playback-model.mjs  shared playback states, resolver and validation
data/catalog/               generated: anime.json, movies.json, series.json, sports.json
data/playback/registry.json verified full-content sources (3 public-domain films)
data/playback/samples.json  the curated free-film library those records cover
data/home.yaml              hero fallback, stats, quick links
docs/PLAYBACK_MODEL.md      playback schema, states and rights requirements
content/
  _index.md                 homepage copy
  movies/_content.gotmpl    generates one page per movie
  tv/_content.gotmpl        generates one page per TV series
  anime/_content.gotmpl     generates one page per anime title
  movies/ tv/ anime/ sports/ my-list/ about/
layouts/
  catalog/page.html         title page for a generated catalogue entry
  movies|tv|anime|sports/section.html   rails for each vertical
  term.html taxonomy.html   genre browsing
themes/alert/               design system: CSS, JS, shared partials
```

## Local development

```bash
node scripts/fetch-catalog.mjs    # refresh data/catalog/*.json
hugo server -D                    # http://localhost:1313
hugo --gc --minify                # production build into public/
node scripts/check-site.mjs       # verify the build before shipping
node scripts/check-playback.mjs   # verify the playback registry
node --test scripts/playback-model.test.mjs  # model and validator tests
```

Node 20+ is only needed to refresh the catalogue. The generated JSON is committed,
so a plain `hugo` build works without Node or network access.

`check-site.mjs` fails on dead or un-prefixed internal links, missing metadata or
`alt` text, duplicate ids, a malformed search index and leaked credentials. The
deploy workflow runs it before uploading, so a broken build never publishes.

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
If a stream delivers no metadata within 20 seconds, the page shows a slow-stream
notice with the official-player link; a hard source error replaces the player.
Everything else on the site is discovery only.

Adding a source requires a recorded rights basis, HTTPS evidence, a named
reviewer, an availability region and a provider/method pair that matches.
Internet Archive sources may use the official embed or a native MP4 record; a
native record must name the exact file that its download URL points at.
`node scripts/check-playback.mjs` fails the build if any of that is missing, and
`docs/PLAYBACK_MODEL.md` documents the full schema. The state line on every title
page is generated by `themes/alert/layouts/_partials/playback-state.html`, which
mirrors the model and reads the region from `playbackRegion` in `hugo.toml`.

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
site base path so the site works from the `/pixy-streams/` subpath.

## Deployment

Live at <https://iams1am.github.io/pixy-streams/>, deployed by
`.github/workflows/deploy.yml`. Every push to `main` tests the playback model,
refreshes the catalogue, builds with Hugo, runs the site and playback checks, and
publishes through GitHub Pages; a daily `cron` run at 05:00 UTC does the same so
fixtures and seasonal anime do not go stale, and `workflow_dispatch` covers manual
runs.

The workflow reads `TMDB_API_KEY`, `TMDB_READ_TOKEN` and `SPORTSDB_KEY` from
repository secrets. A missing secret just leaves that source on its committed
JSON, so the site still builds.

Pages is configured with `build_type: workflow`, which is what allows
`actions/deploy-pages` to publish. To go back to branch publishing, run
`gh api -X PUT repos/iams1am/pixy-streams/pages -f build_type=legacy` and point
Pages at the `gh-pages` branch, which the older manual flow force-pushed.

## Roadmap

- **Done** - rebrand, streaming homepage, rails, genres, nav dropdowns
- **Done** - build-time catalogue fetch, generated title pages, live posters
- **Done** - client-side search over a build-time index, My List in `localStorage`
- **Done** - trailer modal on title pages, scheduled catalogue refresh workflow
- **Done** - TV catalogue, browse-all grids with sorting, post-build checks in CI
- **Done** - playback model, rights registry, three verified public-domain films on `/watch/` with native MP4 playback and Continue Watching
- **Next** - TMDB key for live movie artwork, film trailers and episode guides
- **Later** - Vimeo and self-hosted playback once authorized content needs them

## Attribution

Film data and artwork come from TMDB. This product uses the TMDB API but is not
endorsed or certified by TMDB. Anime data from AniList, fixtures from ESPN, with
TheSportsDB as a fallback.

## Licence

Site code: MIT. Metadata and artwork belong to their respective sources and
rights holders.

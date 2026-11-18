# Pixy Streams

A movie, anime and sport discovery site. Static, fast, and built to be hosted free
on GitHub Pages.

Pixy Streams is a **discovery layer**: it shows metadata, artwork, trailers and
where-to-watch links. It does not host or stream copyrighted video.

## Stack

| Piece | Choice |
|---|---|
| Static site generator | Hugo (extended, v0.154+) |
| Theme | `alert` - custom, in `themes/alert/` |
| Styling | Hand-written CSS with light/dark tokens, no framework |
| Hosting | GitHub Pages, served from the `gh-pages` branch |
| Catalogue build | `node scripts/fetch-catalog.mjs` (no dependencies) |
| Data | TMDB (film), AniList (anime), ESPN + TheSportsDB (sport) |

## Structure

```
hugo.toml                   site config, navigation, taxonomies
scripts/fetch-catalog.mjs   build-time catalogue fetch and normalisation
data/catalog/               generated: anime.json, movies.json, sports.json
data/home.yaml              hero fallback, stats, quick links
content/
  _index.md                 homepage copy
  movies/_content.gotmpl    generates one page per movie
  anime/_content.gotmpl     generates one page per anime title
  movies/ anime/ sports/ my-list/ about/
layouts/
  catalog/page.html         title page for a generated catalogue entry
  movies|anime|sports/section.html   rails for each vertical
  term.html taxonomy.html   genre browsing
themes/alert/               design system: CSS, JS, shared partials
```

## Local development

```bash
node scripts/fetch-catalog.mjs    # refresh data/catalog/*.json
hugo server -D                    # http://localhost:1313
hugo --gc --minify                # production build into public/
```

Node 20+ is only needed to refresh the catalogue. The generated JSON is committed,
so a plain `hugo` build works without Node or network access.

## Catalogue pipeline

`scripts/fetch-catalog.mjs` talks to each source, normalises the results into one
shape, and writes `data/catalog/<vertical>.json`. Templates read those files; Hugo
then generates the rails, section pages and one page per title.

| Source | Needs a key | Provides |
|---|---|---|
| AniList GraphQL | no | seasonal, trending and top anime, films, trailers, official streaming links |
| ESPN scoreboards | no | football, NBA and F1 fixtures, results, team crests |
| TMDB | yes | trending, top-rated and now-playing films with artwork |
| TheSportsDB | optional | fallback fixtures source when ESPN is unavailable |

```bash
node scripts/fetch-catalog.mjs                  # everything
node scripts/fetch-catalog.mjs --only=anime     # one vertical
node scripts/fetch-catalog.mjs --only=movies    # films (needs a TMDB key)
```

Environment variables: `TMDB_API_KEY` (or `TMDB_READ_TOKEN`), `SPORTSDB_KEY`.
Put them in a `.env` file at the repo root - copy `.env.example`, which is the
committed template while `.env` itself is git-ignored. Shell values win over the
file.

Without a TMDB key the movies vertical keeps the curated seed in
`data/catalog/movies.json` and the script reports `kept … cached items` instead of
failing. With a key it replaces the seed with live trending, top-rated and
now-playing films, complete with posters and backdrops. A source that errors also
leaves its previous JSON untouched, so a flaky API never breaks a build.

Keys are read at build time only. Nothing secret is shipped to the browser, which
is why this is a build step rather than client-side `fetch()`.

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

Live at <https://iams1am.github.io/pixy-streams/>, served from the `gh-pages`
branch.

`.github/workflows/deploy.yml` builds on every push to `main` and on a daily
`cron` schedule, refreshing the catalogue first so fixtures and seasonal anime do
not go stale. It reads `TMDB_API_KEY`, `TMDB_READ_TOKEN` and `SPORTSDB_KEY` from
repository secrets; a missing secret just leaves that source on its committed
JSON. Schedules only run once the workflow exists on the default branch.

The push token behind `gh` does not carry the `workflow` scope, so that file
cannot be pushed from this machine yet. Until it can, publish with:

```bash
node scripts/fetch-catalog.mjs
hugo --gc --minify --cleanDestinationDir
cd public && git init -q -b gh-pages && git add -A \
  && git commit -q -m "Deploy" \
  && git push -f https://github.com/iams1am/pixy-streams.git gh-pages && cd ..
```

To switch to the Actions pipeline later: run `gh auth refresh -s workflow`, then
remove the `.github/workflows/deploy.yml` line from `.git/info/exclude` and commit
the file.

## Roadmap

- **Done** - rebrand, streaming homepage, rails, genres, nav dropdowns
- **Done** - build-time catalogue fetch, generated title pages, live posters
- **Done** - client-side search over a build-time index, My List in `localStorage`
- **Done** - trailer modal on title pages, scheduled catalogue refresh workflow
- **Next** - TMDB key for live movie artwork and film trailers
- **Later** - per-title playback slot for public-domain / licensed media

## Attribution

Film data and artwork come from TMDB. This product uses the TMDB API but is not
endorsed or certified by TMDB. Anime data from AniList, fixtures from ESPN, with
TheSportsDB as a fallback.

## Licence

Site code: MIT. Metadata and artwork belong to their respective sources and
rights holders.

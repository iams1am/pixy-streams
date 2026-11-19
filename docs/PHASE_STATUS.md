# Pixy Streams — Phase Status

## Phase 1.1 — Baseline audit — Complete (re-verified 2026-11-20)

- Production build passes with Hugo extended 0.154.5 (`hugo --gc --minify`):
  145 pages, 114 HTML files, no warnings or template errors.
- 4,844 internal `href`/`src` references scanned; zero broken, every one
  base-path prefixed with `/pixy-streams/`.
- Static accessibility scan across all 114 HTML files: exactly one `<h1>` per
  page, every `<img>` has `alt`, no unnamed buttons or empty links, no duplicate
  `id` values, `lang` present on every document.
- Search index (`/search.json`) parses and covers all four media types with no
  duplicate URLs or titles.

## Phase 1.2 — Functional bug fixes — Complete (2026-11-19, extended 2026-11-20)

### Fixed (2026-11-19)

- Header no longer overflows at 769–1024 px; navigation collapses at
  `max-width: 1024px` while typography and grids still break at 768 px.
- Mobile dropdowns work after a desktop-to-mobile resize; the handler checks the
  active breakpoint at click time.
- Crossing the navigation breakpoint collapses the mobile menu and open
  dropdowns and restores body scrolling.
- Desktop dropdowns are keyboard-accessible via `:focus-within`, with
  `aria-expanded` tracking hover and focus.
- Themes are restored before first paint by an inline head script, with guarded
  `localStorage` access in the main script.
- Body scroll locking is centralized, so the trailer modal and the navigation
  outside-click handler no longer fight over it.
- Mobile submenus stay hidden until expanded; toggles expose
  `aria-expanded`/`aria-controls`.
- Search results close when focus leaves the search region without breaking
  result activation.
- Rail scroll controls refresh after filtering changes overflow.

### Fixed (2026-11-20)

- Remote artwork that fails to load is replaced with the monogram placeholder
  from `poster-fallback.html` (rail cards and title heroes; team crests in match
  cards are left alone so the scoreboard layout survives).
- Category filter no longer counts the same title once per rail: the status
  line reports distinct titles, and multi-select reads "matching A or B" instead
  of the misleading "in A + B" for what is a union.

### Verification

- `hugo --gc --minify --cleanDestinationDir`: pass, 145 pages, no warnings.
- Browser matrix at 360, 390, 768, 769, 800, 900, 1024, 1025, 1280 and 1440 px
  (2026-11-19): no document-level horizontal overflow.
- Mobile load, desktop-to-mobile resize, outside click, Escape, keyboard focus
  into submenus, pre-paint theme, trailer open/close scroll lock, search,
  filter, My List and rail refresh: pass.
- No browser console or runtime errors; link scan clean after the production
  build.

### Deferred

- Legacy unused CSS/JS remains from the robotics theme; the layout tree has
  already been pruned to the pages the site uses.

## Phase 2.1 — TMDB movie integration — Complete (2026-11-19)

### Implemented

- `scripts/fetch-catalog.mjs` enriches each TMDB movie with runtime, release
  date, poster, backdrop, genres, score, official trailer and regional watch
  availability (`append_to_response=videos,watch/providers`).
- Trailers outrank teasers, with official and English YouTube results preferred
  within each type.
- Watch providers are deduplicated by name, capped at eight, and labelled
  `Stream`, `Free`, `Free with ads`, `Rent` or `Buy`. Every link opens the
  TMDB/JustWatch region page; availability is explicitly not presented as
  playback permission.
- `TMDB_REGION` (ISO 3166-1, default `US`) selects the region; the deploy
  workflow forwards an optional repository variable of the same name.
- Per-movie detail failures keep the previous cached runtime, trailer, watch
  providers and attribution. A total source failure leaves the previous JSON
  untouched.

### Verification

- Production build passes; 136 pages at the time of the change.
- Mock TMDB success: four movies normalised with runtime, release date,
  preferred trailer, deduplicated providers, free/ads/rent labels, attribution.
- Mock total failure: exit 0, previous `movies.json` preserved byte-for-byte.
- `TMDB_REGION=GB` switched providers, link and attribution to GB.
- Enriched render emits `datePublished`, ISO 8601 `duration`, watch types,
  attribution and the licence disclaimer; titles without providers render no
  empty watch section.
- Generated output contains no TMDB credential markers.

### Limitations

- No `TMDB_API_KEY`/`TMDB_READ_TOKEN` in this environment, so the committed
  movie catalogue is still the curated 16-film seed and film trailers are empty.

## Phase 2.2 — TV series integration — Complete (2026-11-20)

### Implemented

- `data/catalog/series.json` (5 curated series with seasons, air dates, scores
  and TMDB ids) is committed now, so every build and the Actions pipeline get
  the same catalogue.
- `content/tv/_content.gotmpl` generates a page per series; `layouts/tv/section.html`
  renders Trending, Top rated and On the air rails plus the category filter.
- `scripts/fetch-catalog.mjs` enriches series through TMDB with the same
  cache-preserving failure behaviour as movies.
- Episode guides are bounded: `TMDB_EPISODE_SERIES_LIMIT` series,
  `TMDB_EPISODE_SEASON_LIMIT` newest seasons per series, `TMDB_EPISODE_LIMIT`
  episodes per season, and cached guides are reused instead of refetched.
- Routes live under `/tv/`, so they cannot collide with `/movies/` or `/anime/`.
- Series pages emit `TVSeries` JSON-LD with `numberOfSeasons`/`numberOfEpisodes`
  and `datePublished`, plus the seasons block and watch-provider section.
- `TV` was added to the main navigation, the home page gains a Trending TV rail,
  and search labels series results `TV Series`.

### Verification

- Production build: 145 pages, `/tv/` plus 5 series pages generated.
- Search index: 112 entries — 63 anime, 16 movies, 5 series, 28 fixtures.
- Synthetic fixture check (seed data restored afterwards): an episode list,
  episode air dates, runtime, watch chips with type labels, attribution and the
  trailer modal all render on `/tv/severance/`.
- `node scripts/fetch-catalog.mjs --only=series` without credentials: exit 0,
  `kept 5 cached items`, committed JSON unchanged.

### Limitations

- Season episode lists are empty in the committed seed because they require
  live TMDB data; the renderer and fetcher paths are verified by fixture.

## Phase 2.3 — Anime enrichment — Complete

- AniList supplies seasonal, trending, top and film lists; each item carries
  English and romaji titles, format, episode count, airing status, score,
  genres, overview, poster, backdrop, accent colour, official YouTube trailer
  and filtered official viewing links.
- A failed AniList request leaves the previous `anime.json` untouched.

## Phase 2.4 — Search and browsing — Complete (2026-11-20)

- Local search index at `/search.json` with lazy fetch on first focus, keyboard
  navigation, `role="combobox"`/`listbox` wiring and per-type labels (Movie,
  TV Series, Anime, Sport); external fixture results open in a new tab.
- Category filter chips are now derived from the section's own catalogue instead
  of the global genre taxonomy, so no section offers a genre it cannot show
  (previously `/tv/` had 14 dead chips and `/sports/` had no sport chips at all).
  The script then re-derives every count from the titles actually on the page,
  hides any chip left at zero, and reports distinct matches.
- Missing posters fall back to a monogram card; empty results and empty sections
  have explicit states.

### Limitations

- Section rails are curated and capped, so `/anime/` shows 49 of 63 titles and
  `/sports/` 20 of 28 fixtures; the remainder are reachable through search and
  genre pages. Chips reflect what the page can filter.
- No sort controls beyond the curated rail ordering (trending, top rated, new).

## Phase 2 acceptance gate

- Movie and TV metadata renders accurately from the committed catalogue, and the
  fetchers handle the live shape (verified with fixtures and mocks).
- Catalogue generation survives API failures: previous JSON preserved, exit 0.
- Search distinguishes media types with explicit labels.
- Provider availability is labelled as information, with the licence disclaimer
  on every title page and TMDB/JustWatch attribution when present.
- No frontend API credentials: the built output contains no key or token.
- Existing Hugo pages remain functional; 4,844 references resolve.

## Deployment

- `.github/workflows/deploy.yml` refreshes the catalogue, builds and publishes on
  push to `main`, on a daily 05:00 UTC schedule and on manual dispatch.
- Pages is configured with `build_type: workflow`, so `actions/deploy-pages`
  publishes the artifact.

## Next

Phase 3.1 — playback source model. Not started; it needs rights decisions for
any full-length playback source before code is written.

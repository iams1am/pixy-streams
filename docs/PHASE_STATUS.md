# Pixy Streams — Phase Status

Phases 1 and 2 are complete against `plan.md`. Verifications were run on
2026-11-20 against the production build with Hugo extended 0.154.5 and headless
Edge 157.

## Phase 1.1 — Baseline audit — Complete

- `hugo --gc --minify --cleanDestinationDir`: pass, 145 pages, 114 HTML files, no
  warnings or template errors.
- `node scripts/check-site.mjs`: pass — 4,928 internal references, all
  `/pixy-streams/`-prefixed and resolvable; every page has `lang`, `<title>`,
  meta description and canonical; exactly one `<h1>`; every `<img>` has `alt`;
  no unnamed buttons; no duplicate ids; search index well formed; no credential
  markers in the output.
- Headless Edge, 8 pages × 5 widths (360, 390, 768, 1024, 1440): no
  document-level horizontal overflow.

## Phase 1.2 — Functional bug fixes — Complete

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

- Failed remote artwork is replaced by the monogram placeholder (verified by
  pointing a poster at a missing file: the card renders `CE` / "Cyberpunk:
  Edgerunners 2" instead of a broken image). Team crests in match cards are
  excluded so the scoreboard layout survives.
- Category filtering counts distinct titles instead of the same card in several
  rails, and multi-select reads "matching A or B" rather than "in A + B".

### Verification

- 12/12 headless-Edge checks: overflow matrix, chip counts, filter narrowing
  and clearing, score and title sorting, trailer open/Escape, search result and
  type label, theme persistence, My List save and render, artwork fallback.
- Trailer: opens in a native dialog with the YouTube embed, Escape closes it,
  the iframe is removed and body scrolling is restored.
- Theme: toggle writes `theme` to `localStorage` and survives a reload.

## Phase 1.3 — Responsive refinement — Complete

- Reviewed the header, hero, rails, category chips, browse grid, search, title
  pages, sports cards, footer and empty states at 360–1440 px.
- The new browse grid uses `repeat(auto-fill, minmax(150px, 1fr))`, dropping to
  132 px columns below 480 px; it never widens the document.
- Rails keep intentional inner scrolling; page-level overflow stays at zero.

## Phase 1.4 — Maintenance and quality controls — Complete

- Added `scripts/check-site.mjs`, a post-build checker for internal links and
  base paths, document metadata, accessible markup, duplicate ids, search index
  shape and leaked credentials.
- The deploy workflow runs it between `hugo` and artifact upload, so a broken
  build cannot reach production. Failing it on a deliberately deleted page was
  confirmed (exit 1 with the dead links listed).
- The theme layout tree contains only templates the site uses.
- Documentation (README, `.env.example`, this status file) matches the code.

### Deferred

- Some unused CSS remains from the original robotics theme. It is inert, and
  pruning it needs a coverage measurement that no tool here provides, so it is
  tracked rather than removed blind.

## Phase 2.1 — TMDB movie integration — Complete

- `scripts/fetch-catalog.mjs` enriches each TMDB movie with runtime, release
  date, poster, backdrop, genres, score, official trailer and regional watch
  availability (`append_to_response=videos,watch/providers`).
- Trailers outrank teasers; official and English YouTube results are preferred
  within each type.
- Watch providers are deduplicated by name, capped at eight, and labelled
  `Stream`, `Free`, `Free with ads`, `Rent` or `Buy`. Every link opens the
  TMDB/JustWatch region page; availability is explicitly not playback permission.
- `TMDB_REGION` (ISO 3166-1, default `US`) selects the region; the workflow
  forwards an optional repository variable of the same name.
- Per-movie detail failures keep cached runtime, trailer, providers and
  attribution; a total failure leaves the previous JSON untouched (verified: exit
  0, file byte-identical).
- Title pages emit `datePublished`, ISO 8601 `duration`, watch chips, attribution
  and the licence disclaimer; titles without providers render no empty section.

## Phase 2.2 — TV series integration — Complete

- `data/catalog/series.json` (5 curated series with seasons, air dates, scores
  and TMDB ids) is committed, so local builds and CI share one catalogue.
- `content/tv/_content.gotmpl` generates a page per series; `layouts/tv/section.html`
  renders Trending, Top rated and On the air rails, the category filter and the
  browse grid.
- Episode enrichment is bounded (`TMDB_EPISODE_SERIES_LIMIT`,
  `TMDB_EPISODE_SEASON_LIMIT`, `TMDB_EPISODE_LIMIT`) and reuses cached guides.
- Routes live under `/tv/`; `TV` is in the main navigation, the home page has a
  Trending TV rail, and search labels series results `TV Series`.
- Series pages emit `TVSeries` JSON-LD with season and episode counts and
  `datePublished`.
- Fixture check (seed restored afterwards): episode list, air dates, runtime,
  watch chips with type labels, attribution and trailer modal all render.
- `--only=series` without credentials: exit 0, `kept 5 cached items`, file
  unchanged.

## Phase 2.3 — Anime enrichment — Complete

- AniList supplies seasonal, trending, top and film lists with English and romaji
  titles, format, episode count, airing status, score, genres, overview, poster,
  backdrop, accent colour, official trailer and filtered viewing links.
- A failed AniList request leaves the previous `anime.json` untouched.

## Phase 2.4 — Search and browsing — Complete

- Local search index at `/search.json` with lazy fetch on focus, debounce,
  keyboard navigation, `role="combobox"`/`listbox` wiring and per-type labels
  (Movie, TV Series, Anime, Sport). Fixtures open in a new tab. Verified: typing
  "sever" returns `Severance — TV Series · 2022 · Drama · 2 seasons`.
- Category chips are derived from each section's catalogue, then re-counted from
  the titles on the page, and any chip left at zero is hidden. `/tv/` no longer
  offers 14 dead genres, and `/sports/` finally offers its real sports.
- Every section has a browse-all grid (`All movies`, `All series`, `All anime`,
  `All fixtures`) covering the whole catalogue, so `/anime/` now exposes all 63
  titles and `/sports/` all 28 fixtures instead of only the rail picks.
- The grid sorts client-side by catalogue order, highest rated, newest, soonest
  (fixtures) and A to Z, announced through a `role="status"` line.
- Chips, grid, rails and the empty state share one filter; filtering a rare genre
  hides the rails that have no match (verified: Mecha → 3 of 4 rails hidden, one
  title shown).
- Missing posters fall back to monogram cards; empty results are explicit.

## Phase 2 acceptance gate

- Movie and TV metadata renders accurately from the committed catalogue; the
  fetchers handle the live shape (verified with fixtures and mocks).
- Catalogue generation survives API failures: previous JSON preserved, exit 0.
- Search distinguishes media types with explicit labels.
- Provider availability is information, not permission: disclaimer on every
  title page plus TMDB/JustWatch attribution where providers exist.
- No frontend credentials: the checker scans the whole output.
- Existing Hugo pages remain functional; 4,928 references resolve.

## Known limitations

- No `TMDB_API_KEY`/`TMDB_READ_TOKEN` here, so movies and series are still the
  curated seed: no film posters, trailers or watch providers, and no episode
  guides. The TV/movie render and fetch paths are verified with fixtures and
  mocks, not live data.
- Sports fixtures come from ESPN/TheSportsDB at build time; schedules shift and
  the page says so. Scores are informational, never an implied live stream.
- Unused legacy CSS remains (see Phase 1.4 deferred).

## Deployment

- `.github/workflows/deploy.yml` refreshes the catalogue, builds, runs
  `scripts/check-site.mjs` and publishes on push to `main`, daily at 05:00 UTC
  and on manual dispatch.
- Pages uses `build_type: workflow`, so `actions/deploy-pages` publishes the
  artifact.

## Next

Phase 3.1 — playback source model. Not started; it needs rights decisions for
any full-length playback source before code is written.

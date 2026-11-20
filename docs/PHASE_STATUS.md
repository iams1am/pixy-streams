# Pixy Streams — Phase Status

Phases 1 and 2 are complete against `plan.md`, and Phase 3.1 is complete as a
model. Verifications were run on 2026-11-20 against the production build with
Hugo extended 0.154.5 and headless Edge 157.

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

- Header no longer overflows; navigation collapses at `max-width: 1279px`
  while typography and grids still break at 768 px.
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

### Navigation alignment (2026-11-20)

- `Watch Free` and `My List` wrapped onto two lines between 1025 and 1440 px,
  dropping their text out of line with the single-line items. Labels are now
  `white-space: nowrap`, and desktop nav items are anchored to the header height
  so every label, the logo, the search field and the theme toggle share one
  baseline.
- The desktop bar now needs ~1170 px of content, so the drawer takes over below
  1280 px instead of 1025 px; the three-word menu no longer squeezes the search
  field to 63 px.
- Verified at 1440, 1280, 1279, 1024, 768 and 360 px: one baseline on desktop,
  drawer above 150 px search width, aligned single-column rows when open, and no
  horizontal overflow at any width. Dropdowns open flush with the header edge.

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

- CSS budget measured with headless-Edge coverage over 119 pages plus interaction
  states: 25,523 of 42,025 bundled bytes were actually used (60.7%). A static
  pass then found 66 rules whose class names appear in no page, template or
  script — the publications, sponsors, featured-sections, recent-posts and
  utility-class blocks left over from the robotics theme, plus `.btn-small`. All
  66 were removed (53,716 → 46,962 source bytes; 42,025 → 36,775 shipped). After
  the cut the same 25,523 bytes are used, now 69.4% of the bundle, which confirms
  only unreachable rules went. Post-prune smoke pass: 7/7 browser checks
  (computed styles, 360–1440 px overflow, filter, sort, trailer, search, watch
  page). JavaScript coverage is reported, not pruned: the module executes fully
  on load, so the number says nothing about dead functions.

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

### Key setup path

- `node scripts/fetch-catalog.mjs --status` reports whether TMDB is configured,
  which region is active, and how many items carry posters, trailers, watch
  links and episode guides. It never calls the API, so it is safe in CI; the
  workflow prints it on every run.
- Credentials are shape-checked on startup: a 32-character v3 key belongs in
  `TMDB_API_KEY`, the `eyJ…` v4 token in `TMDB_READ_TOKEN`. A swapped pair fails
  immediately with the variable named, instead of surfacing as a bare 401 mid-run.
- A real 401 is rewritten into the same actionable message pointing at
  <https://www.themoviedb.org/settings/api>.
- README documents the five-step setup (account, API settings, `.env`, `--status`,
  per-vertical refresh) and the GitHub secret/variable names.
- Verified against a local mock of the six list endpoints and the detail
  endpoints: movies gained posters, backdrops, runtime, an official trailer
  (Trailer outranking Teaser, YouTube outranking Vimeo) and watch providers
  labelled Stream/Rent with the regional link; series gained posters, trailers,
  providers and season/episode guides. The committed seed was restored
  afterwards, and `--status` reports it unchanged.

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

## Phase 3 — Playback — complete through 3.2, 3.3 and 3.5 for Internet Archive

### 3.1 Playback source model — Complete

- `data/playback/registry.json` holds full-content sources separately from the
  catalogue: **3 verified sources**, all Internet Archive embeds of films that
  are public domain in the United States (`his_girl_friday`,
  `TheGeneral1926`, `the-cabinet-of-dr.-caligari-1920.`). `data/playback/samples.json`
  is the curated library those records point at.
- `docs/PLAYBACK_MODEL.md` defines the record schema: content id, media type,
  episode id, provider, method, identifier, availability region and status,
  rights basis, terms, reviewer, HTTPS evidence, language, captions and the last
  verification date.
- `scripts/lib/playback-model.mjs` is the classifier and validator. Titles
  resolve to `play_here`, `official_provider`, `trailer_only` or `unavailable` in
  that priority order; a restricted source falls through, and an unverified
  source can never resolve to `play_here`. TMDB and AniList listings are never
  treated as playback rights.
- `themes/alert/layouts/_partials/playback-state.html` mirrors the classifier for
  Hugo, using `playbackRegion` (default `US`) from the site params. Every
  catalogue title page and every watch page now renders a labelled state line
  and a `data-playback-state` attribute; current build: **3 play_here, 59
  official_provider, 4 trailer_only, 21 unavailable** across 87 pages.
- `scripts/check-playback.mjs` fails closed on unverified rights, missing
  evidence, a missing reviewer, unknown catalogue ids, provider/method
  mismatches, invalid regions or dates, duplicate ids, and URLs that do not point
  at the declared identifier.
- `scripts/playback-model.test.mjs`: **19/19 tests pass**, covering all four
  states, region fallback, episode matching and every rejection path.
- `scripts/check-site.mjs` now also checks the rendered states against their
  payload: `play_here` needs a player, `official_provider` needs provider links
  and no player, `trailer_only` needs a trailer, `unavailable` must offer none of
  them. A state without a payload fails the build.

### 3.2 Official embedded providers — Complete for YouTube and Internet Archive

- `layouts/_partials/playback-embed.html` is the single adapter: Internet
  Archive embed, YouTube privacy-enhanced iframe, Vimeo iframe and a native MP4
  branch. Provider identifiers are validated against provider-specific patterns
  before a record is accepted, and each embed keeps the provider's own controls.
- Internet Archive is live for all three samples. YouTube is exercised by the
  trailer modal and by a synthetic registry fixture (movie page rendered
  `play_here` with the privacy-enhanced embed, then the fixture was removed).
- Vimeo and self-hosted MP4 are implemented but unused: no authorized content
  needs them yet.

### 3.3 Dedicated watch page — Complete for what the provider exposes

- `/watch/` library plus one page per verified film, with poster, licence line,
  rights panel (basis, region, language, captions, last verified, reviewer and
  the evidence list), and "back to all free films".
- Play, pause, seek, volume and fullscreen come from the Internet Archive
  player; custom controls are deliberately not faked.
- Captions are reported honestly ("Captions are not available for this
  transfer"). A missing or unverified rights record replaces the player with a
  "Playback is unavailable" panel and offers the archive.org page instead.
- Not implemented: Continue Watching. Progress inside a cross-origin provider
  iframe is not readable, so it would be an invented state; episode navigation is
  also unused because no serial source is registered.

### 3.4 Native playback — Adapter ready, no authorized file

- The `html5_mp4` branch renders `<video controls preload="metadata" playsinline>`
  with the poster, a direct-file fallback link, and error handling that reveals a
  message when the source fails. No self-hosted content is registered, so the
  branch is dormant; no storage service was introduced.

### 3.5 Verified sample library — Complete (3 items)

- Three films chosen and recorded with license evidence, provider, embedding
  rights, region (US) and verification date: *His Girl Friday* (1940),
  *The General* (1926), *The Cabinet of Dr. Caligari* (1920).
- Every registry identifier was re-checked today: the archive.org metadata
  carries a public-domain licence URL and the official embed returns 200 for all
  three.
- Desktop and mobile rendering of the watch pages was verified in a headless
  browser at 360–1440 px; see the browser section above for the method.

## Phase 3 acceptance gate

- **Met for the three public-domain samples.** Three independently verified
  authorized items play through the Internet Archive's official embed.
- Playback uses approved mechanisms only: registry record, provider validator,
  official embed. No proxy, mirror, download or re-host exists.
- Unsupported content shows an honest state instead of a dead player; the
  unreachable/ unverified case was verified by removing a rights record and
  confirming the page falls back to `unavailable` and the build check fails.
- Trailer buttons remain separate from full-content playback: the trailer modal
  is its own control and the state line says `Trailer only` when that is all
  there is.
- Playback errors are surfaced for the native branch; provider iframe failures
  fall back to a direct link.
- Limitation: progress tracking and episode navigation are not offered, because
  the provider iframe does not expose them.

## Known limitations

- Only three public-domain films are approved for playback. Everything else is
  discovery: `official_provider`, `trailer_only` or `unavailable`. Trailers and
  provider links are never treated as rights evidence.
- No `TMDB_API_KEY`/`TMDB_READ_TOKEN` here, so movies and series are still the
  curated seed: no film posters, trailers or watch providers, and no episode
  guides. `node scripts/fetch-catalog.mjs --status` reports exactly that, and the
  credentialed path was verified end to end against a local mock of the TMDB
  endpoints. Live data still needs a real key.
- Continue Watching and episode navigation are not offered on watch pages: a
  cross-origin provider iframe exposes no progress, so any bar would be invented.
- Sports fixtures come from ESPN/TheSportsDB at build time; schedules shift and
  the page says so. Scores are informational, never an implied live stream.

## Deployment

- `.github/workflows/deploy.yml` tests the playback model, refreshes the
  catalogue, builds, runs `scripts/check-site.mjs` and
  `scripts/check-playback.mjs`, then publishes on push to `main`, daily at 05:00
  UTC and on manual dispatch.
- Pages uses `build_type: workflow`, so `actions/deploy-pages` publishes the
  artifact.

## Next

Phase 3.2 — official embedded providers. Not started; blocked until the registry
contains at least one verified authorized source with recorded evidence, and the
Phase 3 acceptance gate still needs three.

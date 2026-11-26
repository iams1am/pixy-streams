# Pixy Streams — Phase Status

Phases 1 and 2 are complete against `plan.md`, Phase 3 is complete for the
verified Internet Archive library, Phase 4 (4.1–4.5) is complete, Phase 6
(6.1–6.5) is complete, and Phase 7 adds a full search results page beyond the
six phases in `plan.md`. Phase 5 was skipped by owner instruction; its proposed
backend decision remains unbuilt in `docs/BACKEND_DECISION.md`. Verifications
were run on 2026-11-25 and 2026-11-26 against Hugo extended 0.154.5, Node 22.14
and headless Edge 157. Phase 6.3 measurements are lab data from the local
production build.

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
  catalogue: **3 verified sources**, all Internet Archive MP4 derivatives of films
  that are public domain in the United States (`his_girl_friday`,
  `TheGeneral1926`, `the-cabinet-of-dr.-caligari-1920.`). Each record pins the
  exact file, and `data/playback/samples.json` is the curated library those
  records point at.
- `docs/PLAYBACK_MODEL.md` defines the record schema: content id, media type,
  episode id, provider, method, identifier, exact file, availability region and
  status, rights basis, terms, reviewer, HTTPS evidence, language, captions and
  the last verification date.
- `scripts/lib/playback-model.mjs` is the classifier and validator. Titles
  resolve to `play_here`, `official_provider`, `trailer_only` or `unavailable` in
  that priority order; a restricted source falls through, and an unverified
  source can never resolve to `play_here`. TMDB and AniList listings are never
  treated as playback rights. The validator accepts either the Internet Archive
  embed method or the pinned `internet_archive_mp4` method, and rejects a record
  whose download URL does not point at its declared identifier and file.
- `themes/alert/layouts/_partials/playback-state.html` mirrors the classifier for
  Hugo, using `playbackRegion` (default `US`) from the site params. Every
  catalogue title page and every watch page now renders a labelled state line
  and a `data-playback-state` attribute; current build: **3 play_here, 59
  official_provider, 4 trailer_only, 21 unavailable** across 87 pages.
- `scripts/check-playback.mjs` fails closed on unverified rights, missing
  evidence, a missing reviewer, unknown catalogue ids, provider/method
  mismatches, a missing or mismatched MP4 file, invalid regions or dates,
  duplicate ids, and URLs that do not point at the declared identifier.
- `scripts/playback-model.test.mjs`: **24/24 tests pass**, covering all four
  states, region fallback, episode matching, the native Internet Archive file
  rules and every rejection path.
- `scripts/check-site.mjs` checks the rendered states against their payload:
  `play_here` needs a player, `official_provider` needs provider links and no
  player, `trailer_only` needs a trailer, `unavailable` must offer none of them.
  It also verifies that every watch page renders the pinned MP4 in a native
  `<video>`, with no iframe player, plus the rights panel and resume control.

### 3.2 Provider adapters — Complete for Internet Archive and YouTube

- `layouts/_partials/playback-embed.html` is the single adapter: Internet
  Archive embed, pinned Internet Archive MP4 (native HTML5), YouTube
  privacy-enhanced iframe, Vimeo iframe and a self-hosted MP4 branch. Provider
  identifiers are validated against provider-specific patterns before a record
  is accepted, and each iframe keeps the provider's own controls.
- Internet Archive is live for all three samples through the pinned MP4 method.
  The embed adapter is retained for records that need it. The switch was made
  because the archive's embed sometimes selects a different derivative from the
  one that was verified; the native player guarantees the checked file.
- YouTube is exercised by the trailer modal and by a synthetic registry fixture
  (movie page rendered `play_here` with the privacy-enhanced embed, then the
  fixture was removed).
- Vimeo and self-hosted MP4 are implemented but unused: no authorized content
  needs them yet.

### 3.3 Dedicated watch page — Complete

- `/watch/` library plus one page per verified film, with poster, licence line,
  rights panel (basis, region, language, captions, last verified, reviewer and
  the evidence list), and "back to all free films".
- Play, pause, seek, volume and fullscreen come from the browser's native video
  controls. The page does not draw custom controls, so every control maps to the
  real player.
- Captions are reported honestly ("Captions are not available for this
  transfer"). A missing or unverified rights record replaces the player with a
  "Playback is unavailable" panel and offers the archive.org page instead.
- Continue Watching is implemented for the native player: progress is written to
  `localStorage` every few seconds and on pause, a resume prompt appears on the
  watch page, and `/watch/` lists in-progress films with a `?resume=1` link. A
  finished film or one within ten seconds of the end is cleared. Episode
  navigation is unused because no serial source is registered.

### 3.4 Native playback — Complete for the Internet Archive sources

- `internet_archive_mp4` records render `<video controls preload="metadata"
  playsinline>` with the poster, a direct-file fallback link, and error handling
  that reveals a message when the source fails. The old `html5_mp4` branch stays
  available for an authorized self-hosted file; no storage service was
  introduced.
- The player uses the archive's HTTP range support for seeking. Each watch page
  keeps a link to the archive's official player as a fallback.
- If no metadata arrives within 20 seconds, a slow-stream notice appears with
  the official-player link and is cleared by `loadedmetadata`, `canplay` or
  `playing`. A hard source error still takes precedence and replaces the player.
- Verified on 2026-11-20 in headless Edge: all three direct MP4s played and
  reported their full durations (His Girl Friday 5504.57 s, The General 4732.31 s,
  The Cabinet of Dr. Caligari 4637.74 s). On 2026-11-21 the native player,
  resume, continue-watching, error fallback and responsive layout were verified;
  Internet Archive throughput was intermittent on that date, which is a provider
  limitation rather than a rights or code failure.

### 3.5 Verified sample library — Complete (3 items)

- Three films chosen and recorded with license evidence, provider, playback
  permission, region (US) and verification date: *His Girl Friday* (1940),
  *The General* (1926), *The Cabinet of Dr. Caligari* (1920).
- Every registry identifier was re-checked: the archive.org metadata carries a
  public-domain licence URL, the item pages return 200, and the pinned MP4s
  answer range requests with `206 Partial Content`.
- Desktop and mobile rendering of the watch pages, the native player, resume and
  Continue Watching were verified in headless Edge at 360 and 1440 px. The
  2026-11-21 run used a local MP4 for player mechanics because Internet Archive
  throughput was intermittent; direct archive playback had been verified the
  previous day.

## Phase 3 acceptance gate

- **Met for the three public-domain samples.** Three independently verified
  authorized items play from pinned Internet Archive MP4s, with the archive's
  official player linked as a fallback.
- Playback uses approved mechanisms only: registry record, provider validator,
  exact-file check. No proxy, mirror, download or re-host exists.
- Unsupported content shows an honest state instead of a dead player; the
  unverified case was verified by removing a rights record and confirming the
  page falls back to `unavailable` and the build check fails.
- Trailer buttons remain separate from full-content playback: the trailer modal
  is its own control and the state line says `Trailer only` when that is all
  there is.
- Playback errors are surfaced for the native branch; iframe failures fall back
  to a direct link. A deliberately missing MP4 was verified to hide the player
  and show the error message.
- Watch pages work on mobile and desktop. The 2026-11-21 browser pass checked
  360 and 1440 px with no page-level overflow, play/pause/seek on a native clip,
  the resume prompt, the Continue Watching rail, the error fallback and the
  slow-stream notice. The slow notice was exercised on the real His Girl Friday
  page against a stalled archive response: it appeared after 20 seconds with
  `readyState` still 0, and no false error was shown.
- Limitation: episode navigation is not offered because no serial source is
  registered. Internet Archive throughput varies by data node; the provider can
  be slow independently of this site.

## Phase 4.1 — Homepage refinement — Complete

- Rail order is now: Continue watching (only when progress exists), Categories,
  Free to watch, Trending now, Anime this season, New additions, Sports this week,
  Picked for you (only when signals exist).
- **Trending now** merges the separate film and TV trending rails into one mixed
  rail, so the homepage has one clear "what people are watching" row instead of
  two half-empty ones. It links to the film catalogue's Trending section; the TV
  page keeps its own trending row.
- **New additions** is built from the catalogue at build time: the TMDB
  `new_releases` list first, then the newest series and anime, deduplicated and
  capped at 14. It has no "view all" link because it spans four verticals.
- **Continue watching** reads the same `pixy:watch:progress:<id>` records the
  watch pages write, orders films by most recent activity, links each card with
  `?resume=1` and shows the resume time and percentage. The partial already
  shipped with the playback work but was never included in the home template;
  it is now wired up, and the missing browser renderer was added to `main.js`.
- **Picked for you** ranks the embedded catalogue against genres in My List
  (weight 2) and genres of in-progress films (weight 3), excludes saved and
  in-progress titles, and caps at 14. Its subtitle changes to match the signals
  that exist ("Based on the genres in My List.", "Based on what you are
  watching." or both).
- Both personal rails ship `hidden` and are only revealed when real local data
  exists, so a first-time visitor sees no empty sections. Corrupted or blocked
  storage degrades to the catalogue rails instead of an error.
- Personal rails sit outside `[data-filterable]`, so the category filter never
  hides a visitor's own history; the catalogue rails, including New additions,
  still filter and re-count as before.
- Rail cards reuse the existing `rail-card` markup and monogram fallback; no new
  fonts, colours, tokens or dependencies were introduced.
- **Hero contrast.** The featured headline sets its own white colour, responsive
  clamp size, text shadow and a rounded eyebrow; a bottom fade and a vertical
  mobile scrim keep it legible over any backdrop. The global heading colour no
  longer reaches this hero.

### Verification

- 23/25 headless-Edge checks passed on the first run; the two failures were test
  mistakes (a saved URL built without the active base path, and an expectation
  of rail overflow with only one card), corrected and re-run. Final pass:
  fresh-visit hiding, rail order, resume link and "Resume at 20:00 · 25%" meta,
  saved/in-progress exclusion, signal-specific subtitle, rail scroll controls
  appearing at 360–390 px when the rail overflows, no overflow at 360, 390, 768
  and 1440 px, clearing My List keeping watch-based picks, and corrupted storage
  falling back to catalogue rails.
- Smoke pass after the change: category filter narrows the homepage (Comedy →
  "9 titles matching Comedy"), clearing restores every rail, header search still
  returns `Severance — TV Series · 2022 · Drama · 2 seasons`, the watch page still
  renders its `play_here` native player, and My List still lists saved titles.
- Production build: 154 pages, `check-site.mjs` passes with 5,431 references,
  `check-playback.mjs` passes, playback model tests 24/24.
- Personal rail URLs carry the deployment base path in production
  (`/pixy-streams/watch/the-general/`), verified in the built `index.html`.

## Phase 4.2 — Title detail pages — Complete

- **Primary action follows the playback state.** `play_here` titles lead with
  "Play here" anchored to the inline player; `official_provider` titles lead with
  "Where to watch" anchored to the provider list (or the source page when no
  provider links exist); `trailer_only` titles keep the trailer as the primary
  button; `unavailable` titles offer no watch or trailer call to action at all.
  The trailer drops to a secondary button whenever a watch action exists, and
  "More details" is suppressed when it would duplicate the primary link.
- **Availability context.** The provider section now states the region the links
  were checked for (`playbackRegion`, currently US) and that links open the
  service holding the rights. The section still renders only when provider links
  exist.
- **Seasons.** A season with no episode guide now says "Episode guide not
  available for this season." instead of ending silently after the header. The
  committed seed has no episode guides, so every season shows the honest note
  until TMDB credentials enrich it.
- **Similar titles.** "More like this" now ranks catalogue titles by how many
  genres they share with the current title, with score as the tie-break, instead
  of matching only the first genre. The subtitle says what the ranking means.
- **Poster and backdrop.** On screens narrower than 768 px the horizontal scrim
  becomes a near-opaque vertical one, and the hero metadata is brightened, so the
  backdrop cannot fight the title, score or state line when the layout stacks.
  Desktop keeps the existing side-by-side scrim.
- Metadata hierarchy, genre chips, overview layout, seasons, episode lists and
  the bookmark button were already in place and were kept unchanged. Cast data
  is not in any catalogue source, so no cast block was invented; the plan's
  "where supported" condition is not met.

### Verification

- Rendered checks in headless Edge on the local build: `official_provider`
  (ONE PIECE) shows "Where to watch" as the first action and the region line;
  the anchor scrolls to the provider section, which lands exactly at the header's
  bottom edge (scrollY 0 → 849, section top 71 px). `unavailable` (Dune, Severance)
  shows no watch or trailer action. `trailer_only` (Made in Abyss) keeps the
  trailer as the primary button. Season notes appear for both Severance seasons.
  Related rails render 11 cards ranked by shared genres.
- 768 px and 390 px: all hero actions stay inside the viewport, the provider CTA
  is first, the region line fits, season notes stay inside their cards, and the
  page has no horizontal overflow. Mobile screenshots confirm the darkened hero
  keeps the title and metadata legible over a bright backdrop.
- Production build 154 pages; `check-site.mjs` passes (120 pages, 5,427
  references, 87 playback states, unavailable pages still free of provider
  markup), `check-playback.mjs` passes, playback model tests 24/24.
- Limitation: no catalogue title currently resolves to `play_here` (the three
  verified films are watch-library pages with their own layout), so the
  "Play here" hero branch is implemented but not exercised by a live page.

## Phase 4.3 — Search and navigation — Complete

- **Search discovery.** Focusing the field opens a genre panel built from the
  existing search index: the eight most common genres with counts plus an
  "All genres" link to the `/genres/` hub. No search library or backend was
  added; `/search.json` is still the only index.
- **Genre hub.** `/genres/` lists every taxonomy term as a card with its title
  count, replacing the leftover checkmark list from the robotics theme.
- **Live results and feedback.** Queries need two characters and match title,
  metadata and genres, with title prefixes ranked first. Eight results are
  shown with a live count of the full match set. Loading, no-match and
  index-unavailable states are explicit, and the empty states link to
  `/genres/`. Results carry Movie, TV Series, Anime, Sport or Free film badges.
- **Keyboard.** Arrow Up/Down wrap, Home/End jump to the ends, Enter opens and
  Escape closes. The active result is exposed through `aria-activedescendant`
  and scrolled into view. `/` focuses search from anywhere; on mobile it opens
  the menu first, applies the open state, then focuses the field.
- **Navigation clarity.** Dropdown triggers expose `aria-haspopup`. Hugo marks
  the current link at build time: `aria-current="page"` on an exact match and
  `aria-current="true"` on the section ancestor of a detail page, with the home
  link compared against `site.Home.RelPermalink` so it only matches the root.
  The mobile menu traps Tab/Shift+Tab; Escape closes an open dropdown, then the
  results, then the menu.

### Fixed during verification

- The first implementation set `aria-current` from a client-side prefix match,
  which marked the section link as `page` even on detail pages. It also required
  JavaScript for a state that Hugo can render. The template now computes it once
  (`page` for an exact match, `true` for an ancestor) and the duplicate script
  was removed.
- Opening search with `/` on mobile focused the field while the drawer was still
  `visibility: hidden`, because that property was animated from the closed
  state. The drawer is now visible immediately on open and only delays hiding
  until the close animation ends, so focus lands in the same task.
- Inside the drawer the results panel was absolutely positioned and clipped by
  the menu's scroll box. It now sits in flow, so the menu grows and scrolls to
  every result. The mobile `.site-search` width rule had been placed before its
  base declaration and never applied; it now follows the base rule, which is
  what lets the panel use the full drawer width.

### Verification

- 17/17 headless-Edge checks at 1440 px: discovery showed 8 genres (Drama 55,
  Action 39, Adventure 31), "drama" returned 8 of 55 with an Anime badge,
  Home/End/ArrowDown/ArrowUp selected 0/7/0/7, Enter opened Severance, Escape
  closed the panel, an impossible query explained itself with a genres link,
  `/` focused search, a genre suggestion ran a search, and navigation marked
  exactly Home:page on `/`, Movies:page on `/movies/` and Movies:true on
  `/movies/dune-part-two/`.
- 14/14 mobile checks at 390 px: the closed menu starts hidden, `/` opens it and
  focuses search with 8 suggestions, Tab wraps from the last stop to the first
  and Shift+Tab back, the first Escape closes results while the menu stays open,
  and the second closes the menu and restores focus to the toggle.
- At 390 px the drawer gave the panel the full 290 px search width and scrolled
  to all eight results. `/genres/` rendered 23 genre cards in three columns at
  1440 px and one column at 390 px with no overflow.
- A blocked `/search.json` request showed "Search is unavailable right now." in
  the panel and the live region, with the genres link intact.
- `/movies/#trending` still lands clear of the sticky header; the overflow
  matrix covered 8 pages at 360, 390, 768 and 1440 px with no page-level
  overflow.

## Phase 4.4 — Personalization — Complete

- **Versioned local records.** My List writes `{ version: 1, items }`, watch
  progress writes `{ version: 1, t, d, at }`, and completed titles write
  `{ version: 1, items }`. Readers still accept the earlier raw arrays and
  objects. Malformed JSON, missing fields and blocked storage fall back to
  empty data without an exception. No accounts or cloud sync were added.
- **Watch library states.** In-progress cards show an "N% watched" badge and a
  bottom progress track; completed cards show "Watched" and no track. Completed
  titles are excluded from Continue watching. "Clear watch history" asks for
  confirmation and removes both progress and completed records.
- **Homepage personalization.** Continue watching shows a Resume badge, a
  progress track, the resume time and a `?resume=1` link, and excludes
  completed titles. Recommendations rank the embedded catalogue against My
  List genres and in-progress genres, exclude saved/in-progress titles, cap at
  14 and name the signals they used. Both rails refresh on cross-tab storage
  changes, bfcache `pageshow` and tab visibility changes.
- Progress remains native-player only; provider embeds still expose no progress
  API and are not included.

### Verification

- 17/17 headless-Edge checks. With seeded My List data, one completed film and
  one 20%-watched film, the homepage Continue rail showed only The General,
  with a Resume badge, 20% track and `?resume=1`; recommendations rendered 14
  cards, excluded the saved Dune entry and named both signals. The watch library
  showed His Girl Friday as Watched with no track and The General at 22% watched
  with a 22% track and "22% watched" badge.
- "Clear watch history" removed both progress keys and the completed record,
  hid Continue, reset the card badges/tracks and hid the clear control.
- Saving from a title page wrote `{ version: 1, items: [...] }` with genres; a
  paused player wrote `{ version: 1, t, d, at }`; finishing wrote
  `{ version: 1, items: [{ id, at }] }`.
- A legacy raw My List array, a raw completed string array and an unversioned
  progress object were read correctly. Corrupted values on every key left both
  personal rails hidden and produced no page exceptions.
- A `storage` event for `pixy-my-list` revealed the recommendation rail without a
  reload; `pageshow` and visibility changes run the same refresh.

## Phase 4.5 — Polish and accessibility — Complete

- **Reduced motion.** CSS collapses animation and transition durations, removes
  hover lift and forces auto scroll behaviour. JavaScript uses the same media
  query to choose `auto` instead of `smooth` for rail and anchor scrolling.
- **Focus and structure.** Focus-visible rings cover links, buttons, rail cards
  and watch cards; rails are labelled, grouped and focusable; headings balance;
  in-page targets reserve the sticky header height; the category chip row
  scrolls horizontally on small screens instead of growing into a tall block.
- **Mobile details.** The slash hint is hidden where the menu provides search.
  Opening search via `/` applies the menu's open state before focusing so the
  field is never focused while still `visibility: hidden`.
- **Cascade fixes found in review.** The mobile category and search-hint rules
  were moved after their base declarations; previously the later base rules
  silently overrode them. Search Escape now stops propagation so it closes the
  results without also closing the mobile menu.

### Verification

- 14/14 headless-Edge checks. At 1440, 390 and 360 px there is no horizontal
  overflow. The first Tab reaches the skip link with a 2 px focus ring, the next
  reaches the logo, and a focused rail card matches `:focus-visible` with a 2 px
  ring. Category chips scroll horizontally at 360 px (1,329 px of chips in 312
  px) without widening the page; the slash hint is hidden below 1280 px and
  visible at 1440 px.
- Search announced "Loading genres…" with `aria-busy="true"` while the index
  request was throttled. The empty My List explains how to save a title, the
  watch library hides history controls when empty, and a fresh visitor sees no
  personal rails.
- Typography and structure: body computes to Inter, headings to Space Grotesk,
  the hero headline uses balanced wrapping, rail artwork is lazy/async inside a
  2:3 box, and each page has one header, nav, main, footer and h1.
- Home shipped 43.7 KB of CSS and 30.5 KB of JavaScript over one stylesheet and
  one script, with 525 DOM nodes.
- With `prefers-reduced-motion: reduce` emulated, the media query matched,
  scroll behaviour computed to `auto` and card transition/animation to
  `1e-05s`.
- `check-site.mjs` now also fails if a representative page marks zero or more
  than one current navigation link, or marks the wrong one. It caught the home
  link being treated as an ancestor during this pass.
- Final browser audit: no console errors or page exceptions; all 4.3–4.5
  assertions passed (17 + 14 + 17 + 14 + 6 regression checks). Final build and
  checks: 154 Hugo pages; `check-site.mjs` passed with 120 pages, 5,431
  references, 115 search entries, 3 watch pages and 87 playback states;
  `node --test` passed 24/24; `check-playback.mjs` passed with 3 verified
  sources, 3 samples and 115 catalogue ids.

## Phase 6.1 — Sports Centre — Complete

- **Sports index.** Added an Upcoming fixtures rail beside live scores, results
  and the per-sport rails. The intro now has a styled two-column layout, a live
  score/live video notice, the refresh time, per-league chips with counts and a
  cached marker for any league served from the previous snapshot.
- **Event pages.** The previously uncommitted Phase 3 sports layer is finished:
  a dark event hero, status pill, scoreline with crests and records/form/team
  links, UTC kick-off plus converted local time, venue and source facts,
  sessions, broadcaster listings, official highlights, cached-snapshot note and
  a Schema.org SportsEvent plus breadcrumb. Every event now has a working page;
  the build produces 18 sports pages instead of only the section page.
- **Build fixes found while enabling the pages.** Two bugs had kept the sports
  detail layer out of production. `layouts/sport-event/page.html` ranged over
  the page context instead of `$broadcasts`/`$watch`, aborting every build with
  a sports event; and ESPN timestamps such as `2026-11-20T00:30Z` were rejected
  by Hugo's date parser. The template now ranges the right slices, and
  `normaliseKickoff` inserts seconds for minute-precision timestamps. The
  committed sports snapshot was regenerated with the fixed normaliser.
- **Broadcaster links.** `espnBroadcasts` keeps an http(s) URL when the provider
  supplies one and the page renders it as a link; otherwise the name remains a
  listing. Validation rejects a malformed broadcast URL. The current ESPN
  payloads supply no broadcaster URLs, so no link is invented.
- **Separation of score and video.** Every surface says a live score is not a
  live video feed. Live scores are labelled "Live score" (or "Live score ·
  cached" after six hours), highlights are provider-published links, and
  broadcaster names are explicitly listings only.

### Verification

- `node --test scripts/*.test.mjs`: 35/35, including score states, minute-only
  kick-off normalisation, broadcaster URL mapping and partial-refresh recovery.
- Browser: sports index and event pages at 1440 and 390 px, no horizontal
  overflow, local time rendered from UTC, upcoming/live/results rails present,
  league counts match the events, and the event page has one h1 and a readable
  scoreline at 390 px.
- `check-site.mjs` passes on 142 HTML pages and confirms one current nav item,
  image dimensions, heading order, skip links and landmarks across the new
  pages.

## Phase 6.2 — Catalogue reliability — Complete

- **Network handling.** Requests time out after 25 seconds, retry twice with
  backoff, and honour `Retry-After` up to 20 seconds. TheSportsDB's 200-body
  rate limit is detected and retried once after five seconds.
- **Cache preservation.** A failed source leaves its previous JSON untouched. A
  failed detail request keeps that title's cached trailer, providers, runtime
  and episode guide. Sports merges fresh leagues with carried items from failed
  leagues, marks them stale and records `partial` and `carried_leagues`.
- **Validation.** `validateCatalogue` checks item shape, duplicate ids/slugs,
  watch URLs, event states, scores, fixture links, broadcast URLs and sessions;
  the fetcher refuses to write an invalid snapshot. `check-catalog.mjs` adds
  freshness windows (60 days for film/TV, 30 for anime, 7 for sports), a
  six-hour live-score warning and per-league status, and now runs in CI.
- **Freshness UI.** `/movies/`, `/tv/` and `/anime/` show the snapshot time,
  source and a warning when the cache is older than its window. Sports already
  showed refresh time and partial-refresh state; its league chips now count the
  events actually present, including carried fixtures.
- **Reproducibility.** The committed JSON means `hugo` alone reproduces the site
  without network access; `check-config.mjs` and `check-catalog.mjs` validate it
  before a build. A provider failure only changes how old the snapshot is, not
  whether the build can run.

## Phase 6.3 — Performance — Complete

Measured cold with a local production build in headless Edge at 1440×950, DPR 1,
remote artwork enabled, cache disabled. Baseline was taken after the sports pages
were buildable but before the font and image changes.

| Page | Before | After |
|---|---|---|
| Home | 2,089 KB · LCP 1,400 ms · CLS 0.13 · 171 KB fonts | 1,131 KB · LCP 288 ms · CLS 0 · 69 KB fonts |
| Title detail | 2,439 KB · LCP 140 ms · CLS 0.001 | 839 KB · LCP 84 ms · CLS 0 |
| Sports | 1,311 KB · LCP 132 ms · CLS 0.013 | 1,727 KB · LCP 120 ms · CLS 0 |
| Movies | 173 KB · LCP 180 ms | 181 KB · LCP 92 ms |

- The 0.129 layout shift on the home page came from the Google Fonts swap; the
  section below the hero moved at 1,060 ms. Inter and Space Grotesk are now
  self-hosted as two variable WOFF2 files (69 KB total) and preloaded, removing
  the third-party stylesheet and the measured shift on every audited page.
- Anime cards request a 230 px `poster_small` through `srcset` and fall back to
  the 460 px cover on 2× displays. This cut the home image transfer from 1,773
  to 905 KB and the detail page from 2,278 to 668 KB.
- Every rendered image has intrinsic width/height; `check-site.mjs` fails if one
  does not. CSS (52 KB), JS (30 KB) and both fonts are fingerprinted/preloaded
  as appropriate; JS remains deferred.
- At 390×844 the home LCP is 312 ms, sports 104 ms and detail 68 ms, with CLS 0
  and no horizontal overflow. Sports grew to 1.7 MB because 96 team crests are
  now part of the desk; they remain lazy, low-priority images.
- The watch page LCP (about 4 s) is an artifact of blocking the MP4 request: the
  player waits for metadata and the measurement sees the later error state. Its
  document, CSS, JS and fonts are about 172 KB. This is documented rather than
  optimised away by removing the poster or the player.

## Phase 6.4 — Quality assurance — Complete

- **Unit tests.** `node --test scripts/*.test.mjs`: 35/35 across the playback and
  sports models, including the new kick-off and broadcaster cases.
- **Configuration and secrets.** `scripts/check-config.mjs` validates the Hugo
  base URL/path, theme, menu, playback region, required content and data files,
  `.gitignore` entries and 88 text files for committed credentials.
- **Site checks.** `check-site.mjs` still checks links, base path, metadata,
  search index, watch/playback states and leaked credentials, and now also
  checks `aria-current`, skip links, main landmarks, positive tabindex, empty
  links, heading order and width/height on every image.
- **Browser integration.** `scripts/check-browser.mjs` builds and serves the site
  and drives Chrome/Edge over CDP with no npm dependencies. It covers server
  navigation state, search discovery and keyboards, the 390 px drawer, genre
  cards, seeded watch history and horizontal overflow: 14/14.
- **CI.** The deploy workflow now runs both test files, `check-config.mjs`,
  `check-catalog.mjs`, `check-site.mjs`, `check-playback.mjs` and the browser
  smoke test before uploading the Pages artifact. Run `45541190105` passed and
  deployed; the same browser suite then passed 14/14 against the live URL.

## Phase 6.5 — Documentation and release — Complete

- README now describes the sports desk, catalogue recovery, measured
  performance, the QA commands and the actual Pages deployment model.
- `docs/DEPLOYMENT.md` covers prerequisites, local previews, secrets, the
  workflow stages, rollback and common failures.
- `docs/RELEASE_REPORT.md` records the release scope, evidence, acceptance
  criteria and known limitations.

## Phase 7 — Full search results page — Complete

`plan.md` stops at Phase 6. This phase extends the existing Phase 4 search work
without a search library, backend or new dependency.

- **Shared matcher.** Query parsing and ranking moved into
  `themes/alert/assets/js/search-core.js`, exposed as `window.PixySearch` and
  loaded before `main.js`. The header drawer and the full page now rank a query
  identically instead of keeping two copies.
- **Full page.** `/search/` loads the same build-time `/search.json` index and
  lists every match rather than eight. The query lives in `?q=`, so results can
  be linked, reloaded and navigated with back/forward; the document title follows
  the query. It shows categorical result counts, kind badges, loading, no-result
  and index-unavailable states, a genre discovery panel with counts for an empty
  query, and genre buttons that run a search. Escape clears the field.
- **Header integration.** When a query has more than eight matches, the drawer
  adds "View all N results" as the final keyboard option. End selects it and
  Enter opens the full page with the current query; form submission does the same
  when it is selected. It is reachable and announced through the existing
  combobox/`aria-activedescendant` pattern rather than being a click-only link.
- **Discoverability.** `/search/` is linked from the footer's Browse list and
  from the header's view-all option. A no-JavaScript block links to the movie, TV,
  anime, sport and genre pages.
- **Bug found during verification.** The header first used
  `data-search-page="/search/"`, which also matched the full page's own
  `[data-search-page]` root selector. The page script therefore grabbed the
  header wrapper, failed on the missing input and never initialised. The header
  attribute is now `data-search-page-url`, and the page starts cleanly.
- **Checks.** `check-config.mjs` requires the new content, layout and scripts;
  `check-site.mjs` requires `search/index.html` and verifies its root markers,
  labelled input and `name=q`; `check-browser.mjs` gained eight assertions for
  the view-all link, End/Enter navigation, every-match rendering, discovery,
  no-result recovery and genre buttons. The 390 px overflow matrix now includes
  the search page.

### Verification

- Production build: 181 Hugo pages; `check-site.mjs` passes on 143 HTML pages,
  6,813 references, 106 search entries, 3 watch pages and 89 playback states.
- `check-config.mjs` passes with 92 text files scanned; 35/35 unit tests pass.
- `check-browser.mjs`: 22/22, including "drama" returning 56 results on the full
  page and 26 genre suggestions with no query.
- No horizontal overflow at 390 px on the search page; no uncaught page errors.

## Phase 5.1 — Backend decision — Proposed (awaiting approval)

- Full decision record: `docs/BACKEND_DECISION.md`.
- **Recommendation: Cloudflare Workers + D1**, keeping Hugo on GitHub Pages.
  A single Worker exposes the public request/status API and the protected admin
  API; D1 stores requests, status events and optional rate-limit counters.
- **Why not Supabase:** it has the better account system for a future Phase 5.4,
  but its free projects pause after one week of inactivity, and avoiding that
  needs the $25/month Pro plan. A low-traffic personal site should not depend on
  a keepalive workaround. Its public anon key also makes RLS the only boundary
  around the queue, and anonymous inserts still need an Edge Function for
  Turnstile and rate limiting.
- **Why not a hosted form service:** Formspree/Basin/Getform free tiers are
  sized for contact forms (roughly 50–100 submissions per month) and provide no
  duplicate detection, status API or Phase 5.3 review workflow. Netlify Forms
  would require moving hosting; Google Forms, Airtable and GitHub Issues all
  still need custom duplicate, status and admin-authorisation code.
- **Workers + D1 fit:** no inactivity pause; free Workers allow 100,000
  requests/day with 10 ms CPU, and free D1 allows 5 million rows read/day,
  100,000 rows written/day and 5 GB. Turnstile is free with unlimited
  challenges. The API is the only public surface and no database credential
  reaches the browser.
- **Proposed security model:** 32-byte admin secret stored as a Worker secret,
  exchanged for a two-hour HMAC-signed session token held in `sessionStorage`
  and sent as a bearer token. No cookies, so third-party cookie blocking does
  not apply. Turnstile, rate limits, strict input caps, duplicate detection and
  a D1-backed audit trail cover abuse and moderation. No raw IP is stored.
- **Rights rule preserved:** a request can only become `available` after an
  admin records an https viewing option and a rights note. The playback
  registry remains the only source of `play_here`; user-supplied links are never
  treated as playback sources.
- **No external resources were created.** No Cloudflare account, Worker, D1
  database, Turnstile widget, secret or migration exists yet. Phase 5.2 starts
  only after the approval checklist in the decision record is accepted.

## Known limitations

- Only three public-domain films are approved for playback. Everything else is
  discovery: `official_provider`, `trailer_only` or `unavailable`. Trailers and
  provider links are never treated as rights evidence.
- No `TMDB_API_KEY`/`TMDB_READ_TOKEN` here, so movies and series are still the
  curated seed: no film posters, trailers or watch providers, and no episode
  guides. `node scripts/fetch-catalog.mjs --status` reports exactly that, and the
  credentialed path was verified end to end against a local mock of the TMDB
  endpoints. Live data still needs a real key.
- Continue Watching works for the native player. Provider embeds still expose no
  progress API, so the feature is not extended to them. Episode navigation is
  not offered because no serial source is registered.
- Internet Archive throughput varies by data node. A slow or stalled stream is a
  provider-side condition; the watch page keeps the official-player link, shows
  a slow-stream notice after 20 seconds, and shows a clear error if the source
  fails. No alternative mirror or download is offered.
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

Phase 7 is complete, on top of Phases 1–4 and 6. Phase 5 was skipped by owner
instruction: the Cloudflare Workers + D1 decision remains a proposal in
`docs/BACKEND_DECISION.md`, no external resources exist, and there is no request
UI or admin workflow. More public-domain films can be added through the same
registry once their rights and exact playback file are verified. Live TMDB
credentials remain the main catalogue limitation; they unlock movie and series
artwork, trailers, watch providers and episode guides without further template
work.

# Phase 6 release-readiness report

- **Release:** Phase 6.1–6.5 (sports, catalogue reliability, performance, QA,
  documentation)
- **Date:** 25 November 2026
- **Baseline commit:** `ca4d38e` (Phase 4 complete)
- **Host:** GitHub Pages, built and published by GitHub Actions
- **Status:** released. CI run `45541190105` built and deployed the release;
  the live browser suite passed 14/14 afterwards.

Phase 5 (content requests and accounts) was skipped by owner instruction. It is
not part of this release and nothing external was created for it. Follow-up
Phases 7–9 later added the full `/search/` results page, its type filters,
scheduled-fixture calendar downloads and `robots.txt`; see
`docs/PHASE_STATUS.md` for that work and its evidence.

## What changed

### 6.1 Sports Centre

- `/sports/` now has an Upcoming fixtures rail, per-league counts and cached
  status, a styled desk intro and the existing live/results/sport rails.
- Every sports event has a real page: scoreline, records and form, team links,
  status, UTC and local kick-off, venue, sessions, fixture/highlight links,
  broadcaster listings and a schema.org SportsEvent.
- The unfinished sports layer was also a build blocker. The template ranged over
  the page instead of `$broadcasts`/`$watch`, and Hugo rejected provider
  timestamps without seconds. Both were fixed, and `sports.json` was regenerated.
- Live scores are labelled as scores, never as streams. Broadcaster URLs are
  rendered only when the provider publishes one; names otherwise remain listings.

### 6.2 Catalogue reliability

- Timeouts, retries, `Retry-After`, TheSportsDB's 200-body rate limit, cache
  preservation on failure, per-league sports merging, per-title detail fallback
  and schema validation are in place.
- A freshness line now appears on the movie, TV and anime catalogues and warns
  when the snapshot is older than its window. Sports exposes refresh time,
  partial-refresh state and per-league status.
- `check-catalog.mjs` runs in CI and validates the committed snapshots without
  network access.

### 6.3 Performance

- Self-hosted Inter and Space Grotesk variable WOFF2 files, preloaded; the
  Google Fonts stylesheet is gone.
- Anime covers use a 230 px variant through `srcset`; detail pages still use the
  larger cover. All images have intrinsic dimensions.
- Measured cold on the local production build at 1440×950, DPR 1:

| Page | Before | After |
|---|---|---|
| Home | 2,089 KB · LCP 1,400 ms · CLS 0.13 | 1,131 KB · LCP 288 ms · CLS 0 |
| Title detail | 2,439 KB · LCP 140 ms · CLS 0.001 | 839 KB · LCP 84 ms · CLS 0 |
| Sports | 1,311 KB · LCP 132 ms · CLS 0.013 | 1,727 KB · LCP 120 ms · CLS 0 |
| Movies | 173 KB · LCP 180 ms | 181 KB · LCP 92 ms |

### 6.4 Quality assurance

- 35 unit tests for the playback and sports models.
- `check-config.mjs`: Hugo base path/theme/menu, required content and data,
  `.gitignore`, and 88 text files scanned for committed credentials.
- `check-site.mjs`: links, base path, metadata, navigation state, skip links,
  landmarks, heading order, empty links, image dimensions, duplicate ids,
  search index, watch pages and playback states.
- `check-browser.mjs`: 14 assertions in real Chrome/Edge covering navigation,
  search discovery/keyboard flow, the 390 px drawer, genre cards, seeded watch
  history and overflow.
- The deploy workflow runs all of the above before uploading the Pages artifact.

### 6.5 Documentation

- README updated for the sports desk, catalogue recovery, measured performance,
  QA commands and the artifact-based Pages deployment.
- `docs/DEPLOYMENT.md` added.
- This report added.

## Verification evidence

All commands were run on 25 November 2026 against the final working tree.

| Check | Command | Result |
|---|---|---|
| Hugo build | `hugo --gc --minify --cleanDestinationDir` | 179 pages, no errors |
| Site checks | `node scripts/check-site.mjs` | pass: 142 HTML pages, 6,490 references, 106 search entries, 3 watch pages, 89 playback states |
| Playback registry | `node scripts/check-playback.mjs` | pass: 3 verified sources, 3 samples, 106 catalogue ids |
| Catalogue | `node scripts/check-catalog.mjs` | pass: 16 movies, 5 series, 65 anime, 17 sports |
| Config/secrets | `node scripts/check-config.mjs` | pass, 88 text files scanned |
| Unit tests | `node --test scripts/*.test.mjs` | 35 pass, 0 fail |
| Browser smoke | `node scripts/check-browser.mjs` | 14/14 pass |
| Live browser suite | `PIXY_BASE_URL=https://iams1am.github.io/pixy-streams/ node scripts/check-browser.mjs` | 14/14 pass on the deployed site |
| Mobile layout | 390 px home/sports/event/detail | no horizontal overflow, CLS 0 |
| Local times | sports cards and event page | UTC rendered in markup, converted in the browser |
| Reduced motion | emulated `prefers-reduced-motion: reduce` | scroll behavior `auto`, transitions collapsed (Phase 4.5 audit) |

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Core functional tests pass | Met | 35/35 unit tests, 14/14 browser checks |
| Hugo builds cleanly | Met | 179 pages, no build errors |
| API failures degrade gracefully | Met for the implemented paths | source cache preserved, per-league and per-title fallback, unit tests for sports merge; TMDB live path still needs a real key |
| Sports data is correctly labeled | Met | live score vs video copy on index/event pages, score states validated, broadcaster listings distinguished from links |
| Performance measurements are documented | Met | before/after table above and in README, cold-load method stated |
| Accessibility issues resolved or tracked | Met within automated scope | skip links, landmarks, heading order, image dimensions, `aria-current`, focus and reduced motion checked; no manual screen-reader audit |
| Production deployment is reproducible | Met | committed JSON, pinned Hugo, committed lock-free scripts, CI checks; `generated_at` naturally changes per refresh |
| Known limitations are clearly documented | Met | README, `docs/PHASE_STATUS.md`, this report |

## Known limitations

- **No TMDB credentials.** Movie and TV pages still use the curated snapshots:
  no film posters, trailers, regional providers or episode guides. The
  credentialed path was previously verified against a local mock, but not
  against the live TMDB API in this environment.
- **No cast data** exists in any catalogue source or curated item.
- **Three verified films.** `/watch/` is limited to the public-domain Internet
  Archive records in the rights registry. Provider embeds expose no progress API,
  so Continue Watching is native-player only.
- **Sports are a snapshot.** Scores and states reflect the last build, not a live
  feed. ESPN currently supplies no broadcaster URLs, so listings are names only.
  No live sports video is hosted, mirrored or linked.
- **Remote artwork is the remaining weight.** Home transfers about 0.9 MB of
  AniList covers; sports has 96 lazy crests. Further gains need fewer above-fold
  cards or a different image host, not a speculative rewrite.
- **Browser QA needs Chrome/Edge.** CI has it; a machine without a browser fails
  the check rather than skipping it.
- **Watch page LCP is not meaningful with media blocked.** The player waits for
  metadata and the measurement records the later error state; the shell itself
  is about 172 KB.
- **Phase 5 is absent.** There is no request submission, admin queue, status API
  or account system. `docs/BACKEND_DECISION.md` is a proposal only.

## Recommended next steps

1. Add a TMDB key and run `node scripts/fetch-catalog.mjs --only=movies` and
   `--only=series`, then review the live artwork/trailer/provider diff.
2. Add further public-domain films only after recording the rights basis and the
   exact verified MP4 in the registry.
3. If live sports coverage matters, add more ESPN leagues and keep the score-only
   boundary; do not add unverified streams.
4. Revisit Phase 5 only with explicit approval for the external backend.

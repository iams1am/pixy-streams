# Deployment

Pixy Streams is a static Hugo site built from committed data and published to
GitHub Pages by `.github/workflows/deploy.yml`. There is no server process and no
runtime database.

- Live site: <https://iams1am.github.io/pixy-streams/>
- Repository: <https://github.com/iams1am/pixy-streams>
- Base path: `/pixy-streams/`

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Hugo extended | 0.154.5 | every build |
| Node.js | 22+ | catalogue fetch, checks and tests |
| Chrome or Edge | current | `check-browser.mjs` only |

No npm install is required; every script uses the Node standard library.

## Local preview

```bash
# Optional: refresh the catalogue first. Without a key this keeps committed data.
node scripts/fetch-catalog.mjs --status
node scripts/fetch-catalog.mjs

hugo server -D
# http://localhost:1313/
```

`hugo server` rewrites the configured GitHub Pages base path for local use. If a
preview is served from a different origin, build a copy with an explicit base URL:

```bash
hugo --gc --minify --cleanDestinationDir \
  --baseURL http://127.0.0.1:8125/ -d public-test
python -m http.server 8125 --bind 127.0.0.1 --directory public-test
```

Do not run `check-site.mjs` against a build made with a local base URL: it checks
that internal links carry `/pixy-streams/`, so use the production build for that
check.

## Production build and checks

```bash
hugo --gc --minify --cleanDestinationDir    # public/
node scripts/check-config.mjs               # config, required files, secrets
node scripts/check-catalog.mjs              # committed data schema/freshness
node scripts/check-site.mjs                 # links, base path, nav, a11y
node scripts/check-playback.mjs             # rights registry and samples
node scripts/check-browser.mjs              # built site in headless Chrome
node --test scripts/*.test.mjs              # 35 model tests
```

`check-browser.mjs` builds its own copy into `public-browser/`, serves it on
`127.0.0.1:8177` and removes the directory afterwards. Point it at the deployed
site instead with:

```bash
PIXY_BASE_URL=https://iams1am.github.io/pixy-streams/ node scripts/check-browser.mjs
```

Set `CHROME_PATH` when Chrome or Edge is not in a standard location. The script
fails rather than silently skipping if no browser is found.

## Configuration and secrets

Copy `.env.example` to `.env` for local work; `.env` is git-ignored, and the shell
overrides the file. Keys are read only by the build-time fetcher. Nothing secret
is shipped to the browser.

| Name | Kind | Required | Purpose |
|---|---|---|---|
| `TMDB_API_KEY` | secret | no | TMDB v3 key (32 hex characters) |
| `TMDB_READ_TOKEN` | secret | no | TMDB v4 JWT read token, alternative to the key |
| `TMDB_REGION` | variable | no | ISO 3166-1 watch region, default `US` |
| `SPORTSDB_KEY` | secret | no | TheSportsDB key; public test key otherwise |
| `CHROME_PATH` | local env | no | browser used by `check-browser.mjs` |

A missing TMDB credential is expected in this repository: the movie and TV
verticals keep the curated snapshots. A malformed or swapped credential is
rejected by name (`fetch-catalog.mjs --status`) before a long run starts.

## Workflow stages

On every push to `main`, the daily 05:00 UTC schedule, or `workflow_dispatch`:

1. Checkout with submodules and full history.
2. Install Hugo 0.154.5 extended and Node 22.
3. Run `node --test scripts/*.test.mjs`.
4. Run `node scripts/check-config.mjs`.
5. Refresh the catalogue (missing keys are non-fatal; each source falls back to
   its committed JSON).
6. Run `node scripts/check-catalog.mjs`.
7. Configure Pages and run `hugo --gc --minify --baseURL <Pages URL>/`.
8. Report catalogue coverage with `fetch-catalog.mjs --status`.
9. Run `check-site.mjs`, `check-playback.mjs` and `check-browser.mjs`.
10. Upload `public/` with `actions/upload-pages-artifact@v3` and publish with
    `actions/deploy-pages@v4`.

Pages must use `build_type: workflow`. No `gh-pages` branch is involved. The
build job has `pages: write` and `id-token: write`; concurrency is serialised so
two deploys cannot publish at once.

## Rollback

1. If the build or a check failed, the previous Pages artifact stays live.
2. To redeploy the last known good commit, revert the offending commit on `main`
   and let the workflow run, or re-run that commit's successful workflow from the
   Actions tab. Re-running an old run republishes its artifact, not the current
   `main`.
3. Avoid long-lived rollback branches; Pages publishes artifacts, not branches.

## Catalogue failures

- A failed source leaves `data/catalog/<source>.json` unchanged.
- A partial sports refresh merges fresh leagues with cached items and marks the
  carried fixtures stale; the page shows a partial-refresh note and cached league
  chips.
- A failed TMDB detail request keeps that title's cached artwork, trailer,
  providers and episode guide.
- If every source fails and no cached file exists, the fetch exits non-zero. The
  site cannot be built from an entirely empty catalogue, by design.
- Fix a stale snapshot with `node scripts/fetch-catalog.mjs --only=sports` (or
  `movies`, `series`, `anime`) and commit the refreshed JSON.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `unable to parse date` during a Hugo build | A provider timestamp lacked seconds. `normaliseKickoff` adds them; regenerate the affected snapshot with the fetcher. |
| `missing base path` in `check-site.mjs` | The build used a local base URL. Rebuild without `--baseURL` or use the production build. |
| Browser test says no browser found | Install Chrome/Edge or set `CHROME_PATH`. CI uses the runner's Chrome. |
| TMDB 401 or credential-shape error | Put a 32-hex v3 key in `TMDB_API_KEY`, or the `eyJ…` v4 JWT in `TMDB_READ_TOKEN`. |
| Cache warning on a catalogue page | The snapshot is older than its freshness window; run the fetcher with a key and commit the result. |
| Sports detail page missing | The build would have failed on the event template or a malformed kickoff; check the Hugo log and regenerate `sports.json`. |

## Out of scope

The Phase 5 content-request backend was intentionally skipped. No Worker, D1
database, Turnstile widget, secret or migration exists, and the site has no
request form or admin workflow. `docs/BACKEND_DECISION.md` remains a proposal
only.

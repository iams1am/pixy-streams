# Backend decision — content requests (Phase 5.1)

**Status:** Proposed — awaiting approval
**Date:** 2026-11-25
**Scope:** Phase 5.1 of `plan.md`
**Recommendation:** Cloudflare Workers + D1 for the request API. Keep the Hugo
site on GitHub Pages. Do not create a Supabase project.

> No external resource, database, schema, secret or account has been created for
> this decision. The SQL below is a proposal, not an applied migration. Phase 5.2
> starts only after the approval checklist at the end of this document is
> accepted.

## 1. What the backend has to do

The Phase 5 goal is narrow: visitors can request a movie, TV series or anime,
and one administrator can review and resolve those requests. Requests must be
persisted, duplicates handled, status visible, abuse limited and rights
verification kept mandatory. Accounts are not part of the current requirement;
Phase 5.4 makes them optional and conditional.

The current site is a static Hugo build published to GitHub Pages. It has no
server runtime, no package manager and no authentication. My List, watch
progress and completed films are intentionally local-only. The backend must not
change that model unless a later phase explicitly asks for it.

### Constraints

- The site must stay as close to free as reasonably possible.
- Hugo and GitHub Pages must remain the frontend and host. Phase 5.1 does not
  authorise a hosting migration.
- No secret may reach the browser bundle or the repository.
- Visitors should not be asked for account data, email addresses or other
  unnecessary personal information.
- The rights registry stays the only source of `play_here`; a viewer request is
  not evidence of rights.
- The existing build, catalogue, search, playback and personalisation must keep
  working.

### Requirements to evaluate

| Requirement | Why it matters |
|---|---|
| Free-tier sustainability | The site is personal and low-traffic; a backend that sleeps or requires a paid plan is not sustainable. |
| Security | Public write endpoint, private admin actions, untrusted text and URLs. |
| Operational complexity | One maintainer, no server administration, simple deploys and rollbacks. |
| Hugo integration | Browser `fetch` from a static page, CORS, no build-time server. |
| Authentication | Anonymous visitors now; a single admin. No visitor accounts in this phase. |
| Database permissions | Visitors may create and read only their own request status; admins may update; nobody else may read the queue. |
| Abuse prevention | Bots, floods, duplicate spam, oversized payloads, link spam. |
| Future extensibility | Optional accounts, cross-device sync and family profiles in Phase 5.4, only if justified. |

## 2. Options considered

### A. Supabase

Supabase provides hosted Postgres, row-level security (RLS), authentication,
generated REST endpoints and Edge Functions.

**Strengths**

- RLS is a strong, declarative permission model when policies are written and
  tested correctly.
- Built-in Auth is the shortest path to Phase 5.4 accounts and cross-device
  synchronisation.
- The free tier includes 500 MB of database, 50,000 monthly active users and
  unlimited API requests.

**Why it is not the recommendation now**

- **Free projects pause after one week of inactivity.** A personal site with
  sporadic traffic would regularly be offline until someone manually unpauses
  it. A scheduled keepalive query is a workaround around the plan's lifecycle,
  not a dependable foundation. Avoiding the pause means the Pro plan from
  $25/month, which conflicts with the free-to-operate goal.
- The anon key is designed to be public, so the database REST API is directly
  reachable. RLS then becomes the only boundary between the public and the
  request queue. That is powerful but unforgiving: one policy mistake exposes
  or corrupts data.
- Abuse controls are not built in. A CAPTCHA on Supabase Auth does not protect
  arbitrary table inserts, so anonymous submissions would still need an Edge
  Function with a service-role secret to verify Turnstile and rate-limit. That
  removes much of the "less custom code" advantage.
- It adds a second dashboard, a second CLI and a second set of credentials for
  a queue that needs one table and a handful of endpoints.

Supabase remains the fallback if Phase 5.4 turns cross-device accounts into a
hard requirement. The request data is ordinary SQL and can be exported to
Postgres without redesigning the API.

### B. Cloudflare Workers + D1 — recommended

A single Worker exposes a small JSON API. D1 stores requests and audit events.
The Hugo site stays on GitHub Pages and calls the API from the browser.

**Strengths**

- **No inactivity pause.** Free Workers allow 100,000 requests per day with
  10 ms CPU per invocation. Free D1 allows 5 million rows read per day, 100,000
  rows written per day and 5 GB of storage, with no egress charges.
- **One public facade.** There is no public database endpoint. Every read and
  write goes through code that validates input and checks authorisation.
- **Abuse controls are available on the same platform.** Turnstile is free for
  unlimited challenges (up to 20 widgets and 10 hostnames per widget) and does
  not require the site to be proxied through Cloudflare.
- **No hosting migration.** GitHub Pages continues to serve the site. The
  Worker is an API on a separate hostname; the site's hosting is unchanged.
- **Simple data model.** Requests, status history and optional rate-limit
  counters fit in three SQLite tables. Deploys and migrations use Wrangler.
- **Portable data.** D1 is SQLite; a `wrangler d1 export` produces a normal SQL
  dump if the backend ever needs to move.

**Trade-offs**

- D1 has no row-level security. Authorisation must be implemented and tested in
  the Worker. This is acceptable because the API surface is small and no client
  ever receives database credentials, but it is a real responsibility.
- A single-admin authentication flow has to be built rather than configured.
  The proposed design keeps it small: a high-entropy admin secret exchanged for
  a short-lived signed session token.
- Cloudflare Access cannot protect the admin area today because it requires an
  active domain on Cloudflare, and the site is on `github.io`. Access becomes an
  option if a custom domain is added later.
- The project gains a `backend/` directory, a Wrangler dependency and a second
  deployment workflow. This is still far less than running a server.

### C. A simpler request-only service

Options in this category include Formspree, Basin, Getform, Netlify Forms,
Google Forms with Sheets, Airtable and a GitHub Issues queue.

**Why they were rejected**

- Hosted form endpoints on free tiers typically allow around 50–100
  submissions per month and deliver an email or dashboard entry. They do not
  provide duplicate detection, a status API, private status lookup or the
  Phase 5.3 review workflow.
- Netlify Forms would require moving the site off GitHub Pages, which is not
  authorised.
- Google Forms and Airtable add a second product and API token but still leave
  duplicate handling, status transitions, abuse controls and admin
  authorisation to custom code.
- A GitHub Issues queue would still need a Worker (or similar) to hold a GitHub
  token, and issues are public by default. Request comments and moderation do
  not belong in a public issue tracker.

A plain `mailto:` link is a contact channel, not a backend. It cannot satisfy
the Phase 5 acceptance criteria and should not be presented as one.

## 3. Evaluation

| Criterion | Supabase | Workers + D1 | Hosted form service |
|---|---|---|---|
| Free-tier sustainability | 500 MB, 50k MAU, unlimited API requests, but **pauses after 7 days idle**; Pro from $25/mo | 100k requests/day, 5M D1 reads/day, 100k writes/day, 5 GB, no idle pause, no egress fees | ~50–100 submissions/month; no workflow |
| Security | Strong RLS/Auth primitives, but the anon key exposes the database API; policy errors are high-impact | Single API facade, parameterised SQL, explicit auth checks, no database credentials in the client | Vendor-managed; limited control and visibility |
| Operational complexity | Dashboard + CLI + Auth configuration; pause risk; two products to reason about | One Worker + one D1 database + Wrangler; no server; separate deploy workflow | Lowest effort, but cannot meet the requirements |
| Hugo integration | REST from the browser | `fetch` from the browser with a locked CORS origin | Native form posts, but no status or admin workflow |
| Authentication | Built-in Auth, best path to Phase 5.4 accounts | Custom single-admin session now; an IdP can be added later | None, or the vendor's form dashboard |
| Database permissions | RLS policies in Postgres | Enforced in the Worker; must be tested | Not applicable |
| Abuse prevention | Not built in; needs an Edge Function, CAPTCHA and rate limiting | Turnstile + rate limiting + duplicate detection + validation | Vendor-dependent, usually weak |
| Future extensibility | Excellent for accounts and sync | Good; accounts need an auth layer; SQL data is portable | Poor |
| Cost at rest | $0 with pause risk; $25/mo for reliability | $0 | $0–$20/mo but does not meet scope |

The deciding factor is not feature count. It is the combination of a low-traffic
personal site, a hard free-tier requirement and a small, well-bounded workflow.
Supabase is the better product for a future account system; it is the weaker
choice for a queue that may see a handful of submissions per week and must stay
available without intervention. Workers + D1 fits the current phase and keeps
the door open.

## 4. Proposed design (subject to approval)

### 4.1 Architecture

```
Browser
  Hugo page on https://iams1lam.github.io
  fetch() + Turnstile token
        |
        | HTTPS, CORS allowlist, JSON
        v
Cloudflare Worker
  /v1/requests          public create + status
  /v1/admin/*           session-protected review
        |
        | parameterised SQL
        v
D1
  requests, request_events, optional rate_limits
```

The admin page is part of the same static Hugo site. It calls the Worker with a
short-lived bearer session. No cookie is required, which avoids third-party
cookie restrictions between `github.io` and `workers.dev`.

### 4.2 Data model

The schema is deliberately small. Times are ISO 8601 UTC strings; IDs are
server-generated UUIDs. The public reference is 128 bits of randomness encoded
as base64url, never a sequential ID.

```sql
-- Foreign keys are declared for integrity. The Worker deletes dependent event
-- rows explicitly so behaviour does not depend on D1 cascade enforcement.
CREATE TABLE requests (
  id               TEXT PRIMARY KEY,
  public_ref       TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL CHECK (kind IN ('movie', 'tv', 'anime')),
  title            TEXT NOT NULL,
  year             INTEGER CHECK (year IS NULL OR year BETWEEN 1888 AND 2100),
  external_source  TEXT CHECK (external_source IN ('tmdb', 'anilist')),
  external_id      TEXT,
  genres           TEXT,              -- JSON array, optional
  comment          TEXT,              -- optional, capped at 1,000 characters
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'under_review', 'available',
                                       'unavailable', 'rejected', 'closed')),
  duplicate_of     TEXT REFERENCES requests(id),
  admin_note       TEXT,
  viewing_option   TEXT,             -- https URL, only when available
  rights_note      TEXT,             -- why the option is authorised
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  requester_hash   TEXT,             -- HMAC of IP + user agent, truncated
  CHECK ((external_source IS NULL) = (external_id IS NULL)),
  CHECK (status <> 'available'
         OR (viewing_option IS NOT NULL AND rights_note IS NOT NULL))
);

CREATE UNIQUE INDEX requests_open_external
  ON requests(external_source, external_id)
  WHERE external_id IS NOT NULL AND status IN ('new', 'under_review');

CREATE UNIQUE INDEX requests_open_natural
  ON requests(kind, lower(title), ifnull(year, 0))
  WHERE status IN ('new', 'under_review');

CREATE INDEX requests_status_created ON requests(status, created_at DESC);

CREATE TABLE request_events (
  id          INTEGER PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor       TEXT NOT NULL CHECK (actor IN ('visitor', 'admin', 'system')),
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX request_events_request ON request_events(request_id, created_at);

-- Optional durable fallback if the Workers rate-limit binding is not used.
CREATE TABLE rate_limits (
  key        TEXT NOT NULL,
  bucket     TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (key, bucket)
);

CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
```

Notes:

- `requests_open_*` indexes are a backstop. Duplicate detection happens in the
  API first so the visitor gets a useful "already requested / already
  available" response instead of a database error.
- `request_events` is the audit trail. Every status change records the previous
  and next status, the actor and an optional admin note.
- `viewing_option` and `rights_note` are required before a request can become
  `available`. This keeps "authorized viewing option" separate from "someone
  found a link". The playback registry is still the only place that can produce
  `play_here`.
- `requester_hash` is for abuse control only. It is never returned by the API
  and is deleted after 30 days.
- The Worker deletes dependent event rows explicitly, so the design does not
  depend on D1 foreign-key cascade behaviour. SQLite/D1 behaviour is verified
  during 5.2 before any production migration.

### 4.3 Status model

| From | To | Conditions |
|---|---|---|
| `new` | `under_review` | Admin starts review. |
| `new`, `under_review` | `rejected` | Spam, abuse or out-of-scope; a reason is required. |
| `under_review` | `available` | `viewing_option` (https) and `rights_note` are required. |
| `under_review` | `unavailable` | Admin records why no authorised option was found. |
| `available`, `unavailable` | `closed` | Work is complete and archived. |
| `rejected` | — | Terminal; retained for abuse auditing, then purged. |

A duplicate submission does not create a competing row. The API returns `200`
with `{ duplicate: true, status, title }` and a clear message. A resolved
`unavailable` title may be requested again after a cooling-off period (proposed:
30 days) so changed availability can be discovered; `available` titles do not
need another request.

### 4.4 API surface

| Method and path | Access | Purpose |
|---|---|---|
| `POST /v1/requests` | Public + Turnstile | Validate, deduplicate and create a request. Returns the public reference and status. |
| `GET /v1/requests/:ref` | Public | Return only title, kind, year, status, timestamps and, when available, the authorised viewing option. Never comment, admin note or hash. |
| `POST /v1/admin/session` | Admin secret | Exchange the long-lived admin secret for a short-lived signed session token. |
| `GET /v1/admin/requests` | Session | List and filter the queue, newest first, cursor paginated. |
| `PATCH /v1/admin/requests/:id` | Session | Apply a status transition, admin note or viewing option. Writes an event. |
| `GET /v1/health` | Public | Lightweight health check; no schema or secret details. |

JSON errors use a stable shape:

```json
{ "error": { "code": "duplicate", "message": "This title is already under review." } }
```

`400` validation, `401` missing or invalid session, `403` origin or policy
failure, `404` unknown reference, `409` conflicting state or a concurrent
unique-constraint race, `429` rate limited, `503` dependency unavailable.
Responses are `application/json; charset=utf-8` and `Cache-Control: no-store`.

### 4.5 Admin authentication

The admin is a single trusted person, so the baseline is intentionally small:

1. A 32-byte random admin secret is stored as the Worker secret `ADMIN_TOKEN`.
   It is never committed, logged or shipped to the browser.
2. The admin page posts the secret once to `/v1/admin/session` over HTTPS.
   Login attempts are rate-limited and compared in constant time.
3. The Worker returns a signed session token: a base64url payload containing
   `sub`, `iat`, `exp` (two hours) and `jti`, signed with HMAC-SHA256 using
   `SESSION_SECRET`. No session table is required.
4. The page keeps the session token in `sessionStorage` and sends it as
   `Authorization: Bearer …` on admin requests. It is discarded on tab close.
   There is no cookie, so third-party cookie blocking does not apply.
5. Rotating `SESSION_SECRET` invalidates every issued session. Rotating
   `ADMIN_TOKEN` prevents new logins.
6. The admin page uses a restrictive CSP and renders API data with `textContent`,
   never `innerHTML`. No third-party scripts are loaded on it.

This is adequate for one administrator and avoids an OAuth app or a custom
domain. If the admin surface grows or a custom domain is added, the upgrade path
is GitHub OAuth with an allowlisted GitHub user ID, or Cloudflare Access in
front of the API. The request API and schema do not change.

### 4.6 Abuse prevention and privacy

- **Turnstile** is the primary bot control. The Worker verifies the token
  server-side with `TURNSTILE_SECRET`, checks the expected hostname and rejects
  failures. Tokens are single-use.
- **Rate limits** start conservative and are tuned during 5.2: five submissions
  per hour and twenty status lookups per hour per pseudonymous fingerprint,
  plus a global ceiling. A D1 fixed-window counter is the portable fallback;
  the Workers Rate Limiting binding can be used as a cheap first check if it is
  available on the free plan.
- **Input limits**: JSON body at most 8 KB; title 200 characters; comment 1,000
  characters; at most five genres; `kind` is an enum; `year` is an integer in
  range; URLs must be `https:`. Unknown fields are ignored, not reflected.
- **Duplicate detection**: external IDs (TMDB/AniList) first, then normalised
  title + kind + year within the open-request window.
- **No raw IP storage.** `requester_hash` is an HMAC of IP + user agent using a
  server secret, truncated. It is used only for rate limiting and abuse review
  and is deleted after 30 days.
- **No unnecessary personal data.** No name, email, account or phone number is
  requested. The comment field is optional and the form warns against including
  personal information.
- **Retention**: rejected spam 90 days; closed requests 12 months for audit;
  requester hashes 30 days. A scheduled cleanup is a single daily Cron Trigger
  or an opportunistic cleanup on admin writes.
- **Public status lookup** uses the unguessable reference. There is no endpoint
  that lists requests or enumerates references.
- **Rights**: a user-supplied link is never treated as a playback source. Only
  an admin-recorded, verified `viewing_option` is shown, and `play_here` still
  requires a registry entry.

### 4.7 Hugo integration

Phase 5.2 adds a Requests page and a nav link only when the backend is
configured:

- `params.requestsApiBase` and `params.turnstileSiteKey` are empty by default.
  With no API base, the page explains that requests are not open yet rather than
  showing a form that cannot submit.
- The form collects kind, title, year, optional TMDB/AniList selection and an
  optional comment. It submits JSON with `fetch` and displays the returned
  public reference and status.
- Metadata selection reuses the existing `/search.json` index for title
  autocomplete and can warn when a title is already on the site. The API remains
  authoritative for duplicate requests. The browser does not call TMDB or
  AniList directly and no new metadata key is exposed.
- The status page accepts a reference and shows the server's public fields. It
  never renders untrusted HTML. The reference is private tracking without an
  account, so Phase 5.4 does not need to be pulled forward for this feature.
- A `<noscript>` message explains that JavaScript and Turnstile are required.
  There is no misleading non-functional fallback.
- The API origin is `https://iams1lam.github.io`. Local development origins are
  allowed only when the Worker runs in development mode; production rejects
  them. CORS allows `GET`, `POST`, `PATCH` and `OPTIONS` from the production
  origin only, with `Vary: Origin`. If a custom domain is added later, the
  allowlist is updated explicitly.

### 4.8 Deployment and operations

- New `backend/` directory with `wrangler.toml`, `src/`, `migrations/`, tests
  and a small `package.json` pinned to a Wrangler version. The Hugo site keeps
  its current no-bundler setup.
- D1 migrations are forward-only SQL. A backup (`wrangler d1 export`) is taken
  before any schema change. Wrangler deployments provide Worker rollback.
- A separate `.github/workflows/backend.yml` deploys the Worker. Production
  deployment is manual or protected by a GitHub `production` environment; it is
  not wired to every push. Schema migrations require an explicit approval.
- GitHub Actions secrets: `CLOUDFLARE_API_TOKEN` (scoped to Workers Scripts and
  D1 for this account only) and `CLOUDFLARE_ACCOUNT_ID`. Worker runtime secrets:
  `ADMIN_TOKEN`, `SESSION_SECRET`, `TURNSTILE_SECRET`,
  `REQUESTER_HASH_SECRET` (all distinct). Public values: `TURNSTILE_SITE_KEY`
  and the API base URL. No Cloudflare secret is embedded in the Hugo output.
- Observability: Workers Logs (current free tier: 200,000 events/day, three-day
  retention; Cloudflare changes Workers Logs pricing on 2026-12-01, so re-check
  the free allowance before relying on it) with structured route, status and
  error codes and no titles, comments or IP addresses. `wrangler tail` during
  testing. A `/v1/health` smoke test after deploy.
- Tests: handler/unit tests with `node --test` and integration tests against
  `wrangler dev --local` with a temporary D1 database. Test at least: validation
  failures, duplicate paths, CORS rejection, Turnstile failure, the full
  authorisation matrix for public/admin routes, unauthenticated admin access,
  expired/tampered sessions, every status transition, and rights fields required
  for `available`.

### 4.9 Free-tier budget

| Item | Assumption | Monthly use | Free allowance | Headroom |
|---|---|---:|---:|---:|
| Worker requests | 500 submissions + 2,000 status checks + 300 admin calls | ~2,800 | ~3,000,000 (100k/day) | >99% |
| D1 rows written | 500 creates + 500 events + 300 updates + counters | < 5,000 | ~3,000,000 (100k/day) | >99% |
| D1 rows read | lookups, lists, status checks | < 30,000 | ~150,000,000 (5M/day) | >99% |
| D1 storage | a few thousand requests | < 10 MB | 5 GB | >99% |
| Turnstile | every submission | ~500 | Unlimited challenges | — |
| **Cost** | | | | **$0/month** |

Even a 10× increase stays comfortably inside the free tier. The design fails
closed with a clear `503` if a limit is ever reached rather than losing data
silently.

## 5. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cloudflare account or API token compromise | High | Enable 2FA, scope the API token to Workers + D1 for this account, store it in a protected GitHub environment, rotate on exposure. |
| D1 has no RLS; an authorisation bug exposes data | High | Single data-access layer, deny by default, parameterised SQL, tests for every route and role, no direct database credentials in the browser. |
| Admin secret leak | High | 32-byte secret, login rate limit, constant-time compare, two-hour sessions, no secret in the bundle or logs, `SESSION_SECRET` rotation revokes sessions. |
| Spam or flood | Medium | Turnstile, rate limits, body/field caps, duplicate detection, moderation and a terminal `rejected` state. |
| Free-tier limit reached | Medium | Monitor usage, alert, return `503` with a retry message; volume is tiny and the counters are indexed. |
| D1/SQLite limitations | Low | Small schema, indexed queries, no heavy processing; D1 batch for create + event. |
| Vendor lock-in | Low | Plain SQLite schema and SQL export; API client isolated in one module; migration to Postgres remains possible. |
| Rights mistake | High | `available` requires an https viewing option plus a rights note; `play_here` remains registry-only; no user-supplied playback URLs. |
| Third-party cookie blocking | Low | Bearer session in `sessionStorage`, no cookies. |
| Data loss during migration | Medium | Export before every migration, forward-only migrations, verify D1 Time Travel retention before relying on it. |
| CORS misconfiguration | Medium | Exact origin allowlist, no wildcard, `Vary: Origin`, automated tests for allowed and rejected origins. |

## 6. Why only one backend

Running Supabase and D1 together would double the credentials, dashboards,
backup routines and failure modes without serving a current requirement. The
recommendation is one backend for Phase 5. If Supabase is chosen instead, no
Worker or D1 database should be created. If Workers + D1 is chosen, no Supabase
project should be created. A future migration is a deliberate, documented move,
not a parallel deployment.

## 7. Approval checklist

Phase 5.2 does not start until these are agreed:

- [ ] Approve **Cloudflare Workers + D1** as the Phase 5 backend.
- [ ] Confirm the Cloudflare account owner and that a free account may be used.
- [ ] Approve creating one Worker, one D1 database and one Turnstile widget.
- [ ] Approve one scoped Cloudflare API token for deployment.
- [ ] Confirm the admin authentication baseline: admin secret + two-hour signed
      session (recommended), GitHub OAuth from day one, or defer with no admin
      API.
- [ ] Confirm retention: requester hash 30 days, rejected spam 90 days, closed
      requests 12 months.
- [ ] Confirm the production origin `https://iams1lam.github.io` and whether a
      custom domain is planned.
- [ ] Confirm that Phase 5.4 accounts remain optional and are not part of this
      build.
- [ ] Authorise Phase 5.2 implementation after the above.

## 8. What Phase 5.2 will do after approval

1. Create the Worker, D1 database and Turnstile widget; apply the first
   migration; set the secrets.
2. Implement and test the public create/status endpoints, validation, duplicate
   detection, Turnstile verification and rate limiting.
3. Add the Requests page, nav link and feature flag to the Hugo site.
4. Add `backend.yml` with a protected deploy and a post-deploy smoke test.
5. Document the API, the schema, the secrets and the rollback procedure.
6. Keep Phase 5.3 (admin workflow) separate so the public submission path is
   verified before administrative actions are exposed.

## Sources

Fetched on 2026-11-24/25:

- Supabase pricing — free plan limits and one-week inactivity pause:
  <https://supabase.com/pricing>
- Cloudflare Workers pricing — free plan requests and CPU:
  <https://developers.cloudflare.com/workers/platform/pricing/>
- Cloudflare D1 pricing — free plan rows, storage and databases:
  <https://developers.cloudflare.com/d1/platform/pricing/>
- Cloudflare Turnstile plans — free plan widgets, hostnames and challenges:
  <https://developers.cloudflare.com/turnstile/plans/>
- Cloudflare Turnstile overview — verification and privacy:
  <https://developers.cloudflare.com/turnstile/>
- Cloudflare Access self-hosted applications — active-domain prerequisite:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/>

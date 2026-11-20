# Playback source model

Pixy Streams is a discovery layer. It may embed full-length video only when a
source has been checked and its rights are recorded. A catalogue listing from
TMDB or AniList is metadata, not permission to play anything.

The model lives in `data/playback/registry.json` and is enforced by
`scripts/check-playback.mjs`. The shared classifier is
`scripts/lib/playback-model.mjs`.

## The four states

Every title resolves to one state, in this priority order:

| State | Meaning | Source of truth |
|---|---|---|
| `play_here` | A verified source is available in the visitor's region | A valid entry in the playback registry |
| `official_provider` | The title is available on a provider; the visitor leaves the site | Catalogue `watch` links |
| `trailer_only` | Only an official trailer is available | Catalogue `trailer` URL |
| `unavailable` | No playback, provider link or trailer is known | Fallback |

A registry source that is restricted to another region falls through to the
next state. Unverified sources never resolve to `play_here`, even if they reach
the resolver without passing validation.

## Registry shape

```json
{
  "version": 1,
  "updated_at": "2026-11-20T00:00:00.000Z",
  "notes": "Why the registry is in its current state.",
  "sources": []
}
```

Only sources that may be played on Pixy Streams belong in `sources`, and every
one of them needs a verified rights record. `availability.status` says whether
the source is open everywhere (`available`) or limited to named regions
(`region_restricted`); a restricted source still resolves to `play_here` for a
visitor inside those regions. Trailers and where-to-watch links stay in the
catalogue: they are discovery data, not playback permission.

The committed registry contains three Internet Archive films that are public
domain in the United States, and they are listed at `/watch/`. The Hugo mirror of
the classifier is `themes/alert/layouts/_partials/playback-state.html`; it reads
`playbackRegion` from `hugo.toml` (default `US`) and is what renders the state
line on catalogue title pages.

## Source record

| Field | Required | Rule |
|---|---|---|
| `id` | yes | Unique lowercase slug. |
| `content_id` | yes | Stable catalogue `id` (for example `seed-dune-part-two`). |
| `media_type` | yes | `movie`, `series`, `episode`, `anime` or `event`; must match the catalogue kind. |
| `episode_id` | for episodes | Non-empty id such as `S1E1`; `null` for title-level sources. |
| `provider` | yes | `youtube`, `internet_archive`, `vimeo` or `self_hosted`. |
| `method` | yes | Must match the provider: `youtube_iframe`, `internet_archive_embed`, `vimeo_iframe` or `html5_mp4`. |
| `identifier` | yes | Provider video id, archive identifier, Vimeo id or MP4 path. |
| `url` | yes | HTTPS page that points at the same identifier. |
| `availability.status` | yes | `available` or `region_restricted`. `unavailable` records do not belong here. |
| `availability.regions` | yes | Uppercase ISO 3166-1 codes, or `["worldwide"]`. A restricted source must name specific regions. |
| `availability.checked_at` | yes | ISO 8601 date or timestamp. |
| `rights.verified` | yes | Must be exactly `true`. |
| `rights.basis` | yes | `public_domain`, `creative_commons`, `direct_permission`, `platform_license` or `owned`. |
| `rights.terms` | yes | Short summary of what the permission allows, including embedding and region limits. |
| `rights.approved_by` | yes | Who reviewed the evidence. |
| `rights.evidence` | yes | At least one `{ source, url, checked_at }` item; `url` must be HTTPS. |
| `language` | yes | BCP-47 tag or `null` when unknown. |
| `captions` | yes | Array of BCP-47 tags; an empty array means none are known. |
| `last_verified` | yes | ISO 8601 date or timestamp of the latest availability check. |

Provider URL rules:

- `youtube` — `https://www.youtube.com/watch?v=<11-character-id>`
- `internet_archive` — `https://archive.org/details/<identifier>`
- `vimeo` — `https://vimeo.com/<numeric-id>`
- `self_hosted` — HTTPS URL ending in `.mp4`; `identifier` is its path

### Illustrative record

The following shows the shape only. It is **not** an approval and must not be
copied into the registry without real evidence.

```json
{
  "id": "youtube-example-film",
  "content_id": "seed-dune-part-two",
  "media_type": "movie",
  "episode_id": null,
  "provider": "youtube",
  "method": "youtube_iframe",
  "identifier": "example0000",
  "url": "https://www.youtube.com/watch?v=example0000",
  "availability": {
    "status": "available",
    "regions": ["worldwide"],
    "checked_at": "2026-11-20T00:00:00.000Z"
  },
  "rights": {
    "verified": true,
    "basis": "direct_permission",
    "terms": "Embedding approved worldwide; attribution required.",
    "approved_by": "rights-review",
    "evidence": [
      {
        "source": "Written permission",
        "url": "https://example.com/permission-letter",
        "checked_at": "2026-11-20T00:00:00.000Z"
      }
    ]
  },
  "language": "en",
  "captions": ["en"],
  "last_verified": "2026-11-20T00:00:00.000Z"
}
```

## Adding a source

1. Confirm the rights holder permits embedding or self-hosting this exact
   content in the intended regions.
2. Save the evidence somewhere that can be cited with an HTTPS URL.
3. Check the source plays the correct content and is still available.
4. Add the record and run `node scripts/check-playback.mjs`.
5. Run `node --test scripts/playback-model.test.mjs`.
6. Have a second person review the evidence before merging.

The validator checks the record's shape, not whether a document is genuine.
Human review is still required. Never infer permission from a public URL, a
TMDB/JustWatch listing or an AniList `externalLinks` entry.

## Current status

The committed registry contains **zero** sources. No full-length playback has
been approved, so the site remains trailer-and-provider-links only. Phase 3.2
must not add an adapter until at least one record passes this check, and the
Phase 3 gate needs three independently verified items.

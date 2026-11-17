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
| Hosting | GitHub Pages via GitHub Actions |
| Data | TMDB (film/TV), AniList (anime), TheSportsDB + football-data.org (sport) |

## Structure

```
hugo.toml             site config, navigation, taxonomies
content/              page + section copy
  movies/ anime/ sports/ my-list/ about/
data/home.yaml        homepage hero + catalog rails
themes/alert/         design system: CSS, JS, templates
  assets/css/main.css
  assets/js/main.js
  layouts/
.github/workflows/    build + deploy to Pages
```

## Local development

```bash
hugo server -D          # http://localhost:1313
hugo --gc --minify      # production build into public/
```

No Node install, no package manager, no build step beyond Hugo.

## Editing the homepage

`data/home.yaml` drives everything above the fold:

- `hero` - eyebrow, title, meta line, synopsis, two CTAs, backdrop image
- `rows` - any number of catalog rails; each has a title, subtitle, "view all" link
  and a list of `{ title, meta, poster, href, badge }` items
- `genres` - genre chips
- `stats` - the four-number strip
- `quick_links` - the jump-back-in cards (icon: `film`, `sparkles`, `trophy`, `bookmark`)

Images currently point at `placehold.co`; swap in real artwork when the catalog
pipeline is wired up.

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

## Roadmap

- **Done** - rebrand, streaming homepage, rails, genres, sections, nav dropdowns
- **Next** - build-time catalog fetch (TMDB + AniList) and generated title pages
- **Then** - search index, watchlist in `localStorage`, trailer modal
- **Then** - sports fixtures and near-live scores
- **Later** - per-title playback slot for public-domain / licensed media

## Attribution

Film and TV data and artwork come from TMDB. This product uses the TMDB API but is
not endorsed or certified by TMDB. Anime data from AniList, sports data from
TheSportsDB and football-data.org.

## Licence

Site code: MIT. Metadata and artwork belong to their respective sources and
rights holders.

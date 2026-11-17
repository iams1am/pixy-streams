---
title: "About"
description: "What Pixy Streams is, and what it is not."
---

## A discovery layer, not a streaming service

Pixy Streams helps you work out what to watch and where to watch it. It does not
host video. Title pages link to the official trailer, and to the services that
license each title - Netflix, Prime Video, Crunchyroll, Disney+ and friends.

## Where the data comes from

- Film and television metadata and artwork: **TMDB**
- Anime metadata, scores and airing schedules: **AniList**
- Sports fixtures, results and team crests: **ESPN** scoreboards, with
  **TheSportsDB** as a fallback source

This product uses the TMDB API but is not endorsed or certified by TMDB.

## How it is built

A Hugo static site, deployed to GitHub Pages. Catalogue data is fetched at build
time, so pages are static and fast, and no API key ever reaches your browser.
Where-to-watch links always point at the provider that holds the rights - nothing
is hosted or proxied here.

---
title: "About"
description: "What Pixy Streams is, and what it is not."
---

## A discovery layer, not a streaming service

Pixy Streams helps you work out what to watch and where to watch it. It does not
host video. Title pages link to the official trailer, and to the services that
license each title in your region - Netflix, Prime Video, Crunchyroll, Disney+ and
friends.

## Where the data comes from

- Film and television metadata, artwork and watch-provider availability: **TMDB**
- Anime metadata and airing schedules: **AniList**
- Sports fixtures, teams and badges: **TheSportsDB** and **football-data.org**

This product uses the TMDB API but is not endorsed or certified by TMDB.

## How it is built

A Hugo static site, deployed to GitHub Pages. Catalogue data is pulled at build
time, so pages are static, fast, and no API keys ever reach your browser.

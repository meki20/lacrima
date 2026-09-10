# Lacrima — working notes

Decisions live in CLAUDE.md. This file is the scratchpad: findings, open questions, and
things deliberately deferred.

## Verified

- `docker compose up -d` brings up Suwayomi on :4567, GraphQL at `/api/graphql`.
- Ships zero sources (`extensions.nodes` empty on a fresh volume). Sources come from
  user-added repos via `addExtensionStore`. Exactly the posture we want.
- Suwayomi already provides, for manga: repos, search/browse, pages, a download queue, and
  AniList/MAL tracker OAuth + progress push. Do not rebuild any of that.
- Suwayomi jar: 79,226 files / 396 MB. Contains a reimplementation of `eu.kanade.tachiyomi.*`
  (extensions link against those exact signatures), an `AndroidManifestParser` (extensions
  are APKs -> dex -> JVM bytecode), the `androidx.preference` surface bridged to GraphQL,
  and an embedded Chromium (`/opt/kcef/jcef`) for Cloudflare challenges.
  => reimplementing the extension runtime is 6-18 months and forces a JVM into the stack.
  Settled: Suwayomi stays.

### Reader, against real MangaDex pages

- One chapter mixes wildly different page sizes: page 0 of One Piece ch.1 is a 5.6 KB
  342x533 near-black filler, page 1 is 780x1200, page 2 is a 1560x1200 double spread.
  Any "fit" rule has to survive all three, and double-page mode will need real
  intrinsic-size probing rather than a width heuristic.
- MangaDex lists the same chapter number more than once, one row per scanlation group
  (ch.1 appears twice, PowerManga and GTScans). Chapter *number* is not a key; the
  source chapter id is. Progress anchors store the id for this reason.
- MangaDex's One Piece has 2 English chapters — a takedown, not a bug. The 764-chapter
  "One Piece (Official Colored)" entry is the readable one.

## Mockups

`python -m http.server 8123` inside `mockups/`.
- `home.html` — Home. Cinematic hero + rails. Chosen direction.
- `yours.html` — Yours. Identity, shelf, stickers, library, downloads, appearance.
- `b-console.html` — rejected as a homepage, kept for reference: its sidebar source-health
  treatment is where the top-bar health chip came from.

Known rough edges: the shelf nudge buttons collide with a sticker at default placement
(stickers are user-draggable, so possibly moot).

## Open questions

1. Novel metadata source. AniList covers light novels (format LIGHT_NOVEL) but is thin on
   general/western books. Open Library or Hardcover would fill that. Which shelf is the
   novels tab actually for?
2. Search UI. Currently a top-bar field on every page, but Netflix-style metadata search
   usually wants a full-page takeover with its own result grid. Not designed yet, and it's
   one of the three most-used screens.
3. Rails vs grids. Home is rails, Yours is grids. That split may just be the answer
   (browse in rails, own in grids) but it was defaulted into, not decided.
4. Recommendations v1: tag/genre overlap against rated titles + trending is a SQL join, not
   ML. Assume good enough to start; revisit on real usage data.
5. Server hardware — sizes the page-image cache, which is what makes "fast loading" real.
6. Deploy is written but unrun: `Dockerfile`, `Caddyfile`, `docker compose --profile serve`.
   The Caddyfile defaults to plain HTTP because a tailnet is already WireGuard-encrypted;
   uncomment the `tls` line after `tailscale cert <machine>.<tailnet>.ts.net`.
   `node:24-alpine` runs `node:sqlite` unflagged (checked: v24.20.0, in-memory read/write).
   The production build and standalone output are verified; the compose stack is not.

## Deferred deliberately

- Whisper subtitle generation. Fetch-only first.
- Multi-user auth. Profiles are a data partition; add real auth only if it leaves the LAN.
- Own TypeScript extension format. Suwayomi covers manga; revisit only if it becomes a
  bottleneck rather than a dependency.

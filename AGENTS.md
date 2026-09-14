# Lacrima

Self-hosted media app for anime, manga and novels. One beautiful web UI, accessible from
anywhere on the network, with progress synchronised across every device.

Lacrima hosts and indexes nothing. Sources come from extension repositories the user adds
themselves. Ship with an empty repo list. Never bundle, suggest, or hardcode a source.

---

## Architecture

**Metadata-first, source-second.** This is the central decision; do not invert it.

    browse / rows / search / recs  ->  AniList, TMDB, MangaUpdates   (catalog, genres, tags)
                                         | user picks a title
    resolve title -> source        ->  search extensions, bind best match, cache binding
                                         |
    read / watch                   ->  Suwayomi (manga) / Stremio addon (anime) / LNReader (novel)

Extensions have no catalog — they offer "latest" and "search", never "popular sci-fi you'd
like". So discovery is built on metadata providers, and extensions only fetch bytes.

**Metadata is a fallback chain, never a single provider.** `lib/metadata.ts` walks
`PROVIDERS` in order and the first success wins, flagging `degraded` when it wasn't the
preferred one. This is not speculative: during phase 1 AniList was fully disabled upstream
("temporarily disabled due to severe stability issues") and Jikan began returning 504s in
the same hour. Kitsu served the page. Every provider implements `Provider` in `lib/media.ts`
and normalises to one `Media` shape; adding one is a single line in `PROVIDERS`.

Consequences that must be preserved:
- A dead source never empties the homepage. Rows come from metadata.
- Lacrima's DB owns profiles, library and progress, keyed by metadata ID.
- Suwayomi is a fetcher behind a thin adapter, never the data model. Same for anime addons
  and novel plugins. All three sit behind one source interface.

**Stream proxy is mandatory.** `?url=&referer=` with m3u8 rewriting so segment URLs route
back through us. Sources hotlink-block and CORS-block; nothing works without it.

**An in-buffer remux seek is `currentTime` only. Never restart the remux.**
MSE already holds ~2 min around the playhead. If `clampBuffered` hits, set
`video.currentTime` and stop. `setStartAt` / a new `t=` / a new ffmpeg / a new
MediaSource is allowed only when the target is outside that buffer. Subtitle
clock work must not change this path. Learned the hard way: using the measured
keyframe as the seek origin missed the buffer and rebuilt the entire pipe on
every ±10.

**One extension can register dozens of sources.** MangaDex alone installs 61 — one per
language. Never fan a search out across every installed source: filter by language
(`LACRIMA_LANGS`, default `en,all`) and cap the count, or you will fire 61 parallel requests
at one site and get rate-limited. See `pickSearchable` in `lib/resolve.ts`.

**Suwayomi reports counts lazily.** Search results carry `chapters.totalCount: 0` and
chapter lists carry `pageCount: -1` until the relevant fetch has run. Treat both as
"unknown", never as zero — the matcher re-fetches real chapter counts for its top
candidates so the count signal actually works.

**`fetchChapters` and `fetchChapterPages` are mutations: they scrape the source.** The
`chapters` *query* reads Suwayomi's local cache and is instant. Read the cache; only
mutate when it is empty or the user asked to refresh. Opening a chapter must never
re-scrape a 764-chapter list.

**A binding, once made, is the fast path.** Re-searching every source on every view of a
title page is slow and rude to the source, so `resolveSource` returns the cached binding
and no candidates. The user asking to change the match (`?change=1`) is the only thing
that pays for a search — and a pinned binding survives that search rather than
suppressing it. Getting this wrong makes "Change" a link to a section that isn't there.

**Repositories are not populated by adding them.** `addExtensionStore` registers the URL;
`fetchExtensions` pulls the index. Adding without refreshing shows a repo with 0 extensions
and looks broken. Note also that repo index formats differ: older repos publish
`index.min.json`, newer ones a gzipped `index.pb`, and `isLegacy` distinguishes them.

**Fuzzy matching is imperfect by nature.** Chapter/episode COUNT agreement is a stronger
confidence signal than title similarity — exact title with 200 vs 12 chapters is a weak
match; a fuzzy title with matching counts is a strong one. Cache the binding per title and
always give the user a way to correct it.

**Metadata providers report no unit count for ongoing series.** Kitsu returns
`chapterCount: null` for One Piece, which removes the corroborating signal entirely and
leaves every same-named entry tied on title alone. Ties are therefore the normal case, not
the exception, and must break on something — `rank` breaks on chapter count, because an
entry with 2 chapters is not a readable match for a 1148-chapter series no matter how
exactly its title agrees. Never leave a tie to source order.

**A source can list a title and have nothing behind it.** MangaDex's One Piece entry holds
2 English chapters because the rest were taken down. That is a real answer, not a bug —
say so in the UI and offer the alternatives rather than rendering a two-row chapter list
as if it were complete.

---

## Data rules (non-negotiable, expensive to retrofit)

0. **Media ids are namespaced by provider.** Kitsu 7442 and AniList 7442 are different
   titles. Every `Media` carries `via`, every route is `/title/{via}/{kind}/{id}`, and
   `library`, `progress` and `source_bindings` all key on `(via, media_id)`. Lookups by id
   never fall back to another provider — only *browsing* does.
1. **`profile_id` on every row.** Netflix-style profiles, up to 10, avatar + name, optional
   PIN. It's a data partition, not an auth boundary — don't build a login system for it.
2. **Sources return `Ok(items) | Err(reason, lastSuccess)`, never a bare array.** "Source is
   down" must be structurally distinct from "no results" so the UI cannot render an empty
   grid for a failure. This is the single most important rule in the codebase.
3. **Progress anchors must be portable across devices.** Video = seconds. Manga = page index.
   Novels = paragraph/CFI anchor, NEVER scroll offset — it breaks across screen and font size.
4. **Theming is first-class.** CSS variables plus a per-profile customization record
   (wallpaper, accent, sticker placement). Never a settings page bolted on later.

---

## Design

**Thesis: Geist-grade discipline in the chassis, all colour from content and personalization.**
Neutral near-black chrome, hairline borders, typography and spacing carrying hierarchy,
accent used like punctuation. Cover art, banners, wallpapers and stickers supply the colour.
Same reason Netflix and Spotify chrome is near-monochrome: it lets personalization go loud
without the app ever looking cluttered.

UI is a pillar of this project, not a layer over the backend. Budget at least as much effort
for it. Every element deliberately positioned, sized, coloured, and justified.

Tokens live in `styles/tokens.css` — the source of truth for colour, radius, spacing, type,
imported by both the app and the static mockups.
Reference mockups: `mockups/home.html`.

- Dark-first. `--canvas` #0c0908, warm rust surfaces stepping up from there.
- Border-first elevation. 1px hairlines for structure; shadows only for overlays and popovers.
- Type: Geist Sans, Geist Mono for metadata and technical labels. Tight negative tracking at
  display sizes, relaxed at body. Two weights: 400 and 500. Never heavier.
- Sentence case everywhere. No title case.
- `--accent` is per-profile and defaults to rust (`#c44532`). `--highlight` is blonde
  (`#e8c56b`) from the logo. Treat both as punctuation, not decoration.
- Motion explains, never performs.

---

## Information architecture

Nav: **Home · Anime · Manga · Novels · Yours**

**Home is temporal. Yours is permanent.** This is the non-duplication rule — obey it when
adding anything.

- **Home** — what to do right now: cinematic hero, continue, new-from-your-list, popular,
  recommended. Rails.
- **Yours** — who you are and what you own: identity header on your wallpaper, stats, pinned
  shelf, full library with status filters, downloads. Grids. Stickers live on their own page.

Continue appears only on Home. The library grid appears only on Yours.

---

## UI patterns

**Source health** is a permanent quiet chip in the top bar (`• 4 sources`), expanding to
detail on click. Ambient, never a banner that appears only on failure.

**The reader owns the viewport.** No top bar, no nav. Chrome floats over the art and
hides (`h`, or tap the middle third). Keys: arrows and space turn pages — direction-aware,
so in RTL "right" still means back — `w` webtoon, `r` RTL, `f` fullscreen, `Esc` out.
Pages are fit to height, because sources mix 342px filler, 780px singles and 1560px
spreads inside one chapter and the eye wants a constant page height.

**Progress is a side effect of reading, never a step in it.** Writes are debounced and
fire-and-forget; a page turn does not wait on the database, and a failed write loses a
position, not a page.

**Match correction** is tiered by confidence and never modal, never blocking:
- confident: silent, with one permanent quiet affordance — a source chip in the detail
  header ("Reading from MangaDex, change").
- low confidence: load anyway, plus a dismissible inline note above the chapter list.
  Dismissal remembered per title.
- no match: a real empty state that says so and offers manual source search.

**Errors are transparent and graceful.** Never a raw exception, never a silent empty grid.
Say what happened and what the user can do. A failed source degrades one title's
readability and falls back to another source — it never degrades the app.

**Locked stickers stay visible** as dashed empty slots. Collectible, not decorative.

**Scanlation ads:** ads are baked into page images, so DOM blocking is useless. Scan groups
reuse the same credit image across hundreds of chapters — perceptual-hash each page, let a
user mark one as ad/credits, then auto-hide every match server-wide. No ML.

**Pinned shelf** holds ~10 titles, height locked to its neighbouring tile, overflow scrolls
horizontally by both gesture and buttons.

---

## Running it

    npm run dev     # http://localhost:3000
    npm test        # node:test, no framework
    npx tsc --noEmit
    docker compose up -d                   # Suwayomi on :4567, for dev
    docker compose --profile serve up -d   # + the app and Caddy, for the server

**`node:sqlite` returns null-prototype rows.** React refuses to serialise those, both as
client-component props and inside a server action's closure — the error reads "Only plain
objects... can be passed to Client Components" and points at the action, not at the query.
Every row leaving `lib/` goes through `plain`/`plainAll` in `lib/db.ts`. Add a new row
reader, add the call.

SQLite lives at `./data/lacrima.db` (override with `LACRIMA_DB`). Schema changes go in the
append-only `MIGRATIONS` array in `lib/db.ts`, tracked by `pragma user_version` — never edit
a shipped migration, and never tell anyone to delete the database (the dev server holds the
file open, so that isn't even possible).

The image relay at `/api/proxy` is allowlisted to the Suwayomi host plus
`LACRIMA_PROXY_HOSTS`. Keep it that way: an open `?url=` proxy is an SSRF hole.

Internal `lib/` imports carry explicit `.ts` extensions so the same modules run under
`node --test` without a build step. Keep that convention.

## Stack

Next.js PWA (one app, phone + desktop) · SQLite via built-in `node:sqlite` (no ORM, no
driver dependency) · Docker Compose · Caddy + Tailscale.
Video: Vidstack. Novels: shared reader component. Manga: hand-rolled reader — no good
library exists, and it's the one place worth writing real code.

Subtitles: fetch existing only (OpenSubtitles/Jimaku, match + auto-select language).
No Whisper unless coverage proves bad.

---

## Working style

Reuse before writing. Stdlib and native platform features before dependencies. The shortest
diff that fully solves the problem wins — but read the whole flow before choosing it.
Never simplify away input validation, error handling, accessibility, or anything the user
explicitly asked for.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

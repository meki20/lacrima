# Lacrima — build plan

Decisions: `CLAUDE.md`. Findings and open questions: `NOTES.md`. This file is the scope:
everything Lacrima has been asked to be, and which phase each part lands in.

---

## What Lacrima has to be

One self-hosted app for anime, manga and novels — MangaDex, Miruro and Anna's Archive in
one place — reachable from anywhere on the network, as plug-and-play as possible. It hosts
and indexes nothing: sources come from extension repositories the user adds. Everything a
paid product has, no cut corners.

**The core value is synchronised progress.** Read on the phone, continue on the desktop, in
all three media types, without thinking about it. Every other feature is downstream of that.

### Must have

| | Requirement | Where |
|---|---|---|
| 1 | Fast loading | cross-cutting, [Performance](#performance) |
| 2 | Clean, deliberate UI — every element positioned, sized, coloured with a purpose. **UI is a pillar: at least as much effort as the server work.** | every phase |
| 3 | In-browser viewers for video, manga and novels | Phases 2, 5, 6 |
| 4 | Household, Netflix-style: up to 10 accounts, avatars and names, per-person taste and recommendations, popular sections for everything | Phases 3, 4 |
| 5 | Customisation — your series, characters, likes and dislikes, wallpapers, banners, earnable stickers you can paste onto the UI and your library | Phase 4 |
| 6 | Store / download media locally | Phase 7, surfaced in Phase 4 |
| 7 | Automatic subtitles | Phase 6 |
| 8 | Netflix-style spreads per media type — popular, popular by genre, recommended — plus metadata-backed search, each type in its own tab | Phase 3 |

### Must never happen

| | Requirement | Where |
|---|---|---|
| A | **No ads, including scanlation group ads baked into page images.** | Phase 7, ad pHash |
| B | **A broken source must never show empty content.** Metadata-first architecture exists for this; `Ok\|Err` makes it unrepresentable. | done in Phases 1–2, audited in Phase 7 |
| C | **Every error handled, transparently and gracefully.** Never a raw exception, never a silent empty grid. | every phase, audited in Phase 7 |

These three are not features to add later. B is enforced by the type system already; A and C
get a dedicated audit in Phase 7 because "mostly handled" is the same as unhandled.

---

## Ordering

**Every phase ends with something you can actually use.** No phase exists only to enable the
next one. The riskiest, rot-prone work (anime) goes last, once the shell around it is proven.

Four things are cross-cutting and apply from the first commit, not a later hardening pass:
`profile_id` on every row · `Ok|Err` source results · portable progress anchors · theming
via CSS variables. See CLAUDE.md "Data rules".

> **Reordered:** browse and search moved ahead of Yours. Four of the five nav tabs are dead
> links today, which is the most visible hole in the app, and fixing them needs no new
> backend — only metadata that already flows. Say so if you'd rather have Yours first.

---

## Phase 1 — Spine — DONE

The app exists and shows real data. Nothing is readable yet.

- [x] Next.js 16 + React 19, `styles/tokens.css` shared by the app and the mockups.
- [x] SQLite via `node:sqlite` — profiles, profile_genres, library, progress,
      source_bindings. Self-migrating, seeded with two profiles.
- [x] Metadata provider chain: AniList → Jikan → Kitsu, all behind one `Provider` type.
- [x] Home against live data — hero, popular anime, for-you by genre, manga, novels.
- [x] Profile switcher; accent is applied per profile at the document root.
- [x] Verified at 375 / 900 / 1280. Nav relocates to a bottom bar on phones.
- [x] `npm test` covers the fallback chain, including the total-failure path.

Two things this phase changed: metadata became a chain rather than a single provider (see
CLAUDE.md), and the phone gained a bottom nav because hiding the tabs left no way to
navigate at all.

---

## Phase 2 — Manga, end to end — READABLE, NOT DEPLOYED

The money milestone. Exercises every hard part of the architecture exactly once.

- [x] `SourceBackend` interface + Suwayomi adapter, written against the introspected schema.
- [x] `/sources` — add/remove extension repositories. Ships empty, suggests nothing.
- [x] Top-bar health chip wired to real source counts (backend down / no sources / N sources).
- [x] `/api/proxy` image relay, allowlisted to prevent SSRF.
- [x] Matcher: count-weighted confidence, cached + pinnable bindings.
- [x] `/title/{via}/{kind}/{id}` with the tiered correction UI (silent / inline note /
      empty state) and a ranked "other matches" picker.
- [x] Schema migrations (`user_version`) and provider-namespaced media ids.
- [x] Extension management: refresh index, search, install/uninstall.
- [x] Whole fetch path verified against a real source — search, chapters, pages, and a
      1.8 MB page image byte-identical through `/api/proxy`. SSRF guard returns 403.
- [x] Manga reader: paged + webtoon, RTL, preload window, keyboard, progress anchor.
- [x] Progress write on page turn; resume from anchor; Continue rail on Home.
- [~] Deploy behind Caddy + Tailscale: `Dockerfile`, `Caddyfile` and a `serve` compose
      profile are written and the production build is verified, but nothing has been run
      on the server itself. **This is the only thing left in Phase 2.**

Four bugs the first real read surfaced, all fixed:

- **Bound to the wrong entry.** Kitsu reports no chapter count for an ongoing series, so
  the count signal was absent and every "One Piece" on MangaDex tied at 80% on title alone
  — source order then picked the entry holding 2 chapters over the one holding 764. `rank`
  now breaks ties on chapter count.
- **"Change" was a dead anchor.** A pinned binding returned zero candidates, so the link
  pointed at a section that was never rendered. Re-searching is now an explicit
  `?change=1`, and a pin survives it instead of suppressing it.
- **Every title view re-searched every source.** The cached binding is now the fast path;
  only `?change=1` pays for a search. Chapter lists likewise read Suwayomi's cache, with an
  explicit Refresh button, instead of re-scraping the source on every page view.
- **`node:sqlite` rows are null-prototype**, which React refuses to serialise into a server
  action's closure. Fixed at the shared readers, not the one call site.

Deliberately not built yet: double-page spreads (needs intrinsic-size probing — sources mix
780px singles and 1560px spreads inside one chapter), fit-width and zoom controls, and
offline page caching.

**Done when:** you pick a manga on Home, read three chapters on the desktop, open your phone
on the couch, and it resumes on the right page. Everything but the deployment half of that
sentence is verified.

---

## Phase 3 — Browse and search

Four of five nav tabs currently 404. This phase is the one that makes the app feel finished
rather than half-wired, and it needs no new backend — only metadata that already flows.

### The three media tabs

`/anime`, `/manga`, `/novels`. Same philosophy, separate tabs (CLAUDE.md, IA).

- Popular now, popular by genre (several genre rails, seeded from the profile's taste),
  recommended, recently added.
- Genre filter chips that switch the whole page, not just one rail.
- Pagination or infinite scroll on the grid below the rails.
- Each tab is temporal like Home: no library grid here, that lives on Yours.

### Search

- Full-page takeover, not a dropdown. It's one of the three most-used screens and the
  top-bar field is currently decorative.
- Metadata-backed and cross-type: one query returns anime, manga and novels, grouped.
- Keyboard-first — focus on `/`, arrow through results, Enter opens.
- Debounced, cancellable, with a real empty state and a real failure state.

### Provider work this needs

- `Provider` gains `search(query, kind)` and `browse(kind, genre, page)`. It currently has
  only `fetchHome` and `fetchTitle`.
- **Genres are missing from Kitsu.** `shape()` returns `genres: []` because categories are
  a separate JSON:API relationship. Genre rails and filter chips are unbuildable until that
  is fixed — either an extra request per title or a provider that returns them inline.
- Both new methods go through the same fallback chain, and both must return `Ok|Err`.

**Open:** rails vs grids as a deliberate split (NOTES q3), and the novel metadata source
(NOTES q1) — the novels tab is the one that can't be finished without answering it.

**Done when:** every nav tab leads somewhere real, and you can find any title by typing
its name from any page.

---

## Phase 4 — Yours

Who you are and what you own. Grids, not rails. Nothing here duplicates Home — Continue and
the rails stay there; the library grid and identity live only here. Mockup: `mockups/yours.html`.

### Household

- Up to 10 profiles: create, rename, avatar, delete. Optional PIN.
- Profiles are a data partition, not an auth boundary — no login system (CLAUDE.md rule 1).
- Per-profile taste: liked and disliked genres and tags, feeding recommendations.

### Identity and stats

- Header on your own wallpaper: avatar, name, accent.
- Stats: titles, chapters read, episodes watched, hours, streak.

### Library

- CRUD with statuses: reading/watching, completed, on hold, dropped, planning.
- Score per title. Filters by status, kind and genre; sorting; search within the library.
- Grid, with the status filters as the primary control.

### Pinned shelf

- ~10 titles, height locked to the tile beside it.
- Overflow scrolls horizontally by **both** gesture and buttons.

### Characters

Favourite characters, pulled from the metadata provider, kept per profile.

### Stickers

Steam-achievement energy — collectible, not decorative.

- Earn rules (finish a series, read N chapters, a streak, first novel, and so on).
- Collection view where **locked stickers stay visible as dashed empty slots**.
- Drag to place onto the UI and onto the library; placement persisted per profile.

### Appearance

- Accent picker and wallpaper, per profile, applied at the document root.
- Banners per title where the metadata provides one.

### Downloads

The list and its quota live here; the download machinery itself is Phase 7.

**Done when:** the Yours page is real and your profile looks like yours, not like the default.

---

## Phase 5 — Novels

Cheap once the shell exists — the reader is the only genuinely new surface.

- LNReader plugin runner in-process (plain TS, no JVM) behind the same `SourceBackend`.
- Novel metadata provider — **blocked on NOTES q1**: AniList covers light novels
  (`format: LIGHT_NOVEL`) but is thin on general and western books.
- Reader with typography controls: font, size, line height, measure, margins, theme.
- Paragraph/CFI anchor, never scroll offset (CLAUDE.md rule 3).

**Done when:** you read a novel chapter on your phone and resume at the same paragraph on a
27" monitor at a different font size.

---

## Phase 6 — Anime

Last on purpose: hardest, rots fastest, and by now everything around it is proven.

- Stremio addon client behind the same source interface.
- m3u8 rewriting through the proxy — mandatory, sources hotlink- and CORS-block.
- Vidstack player: subtitle tracks, keyboard, PiP, cast, speed, thumbnail scrubbing,
  next-episode.
- **Automatic subtitles**: fetch from OpenSubtitles/Jimaku, match to the release, auto-select
  the profile's language. Fetch-only — no Whisper unless coverage proves bad.
- Progress in seconds, written on a timer and on pause, resumed anywhere.

**Done when:** you start an episode on the desktop and finish it on your phone at the right
second, with subtitles.

---

## Phase 7 — The things that make it feel paid

Roughly parallel, each independently shippable.

- **Downloads and offline.** PWA, page and chapter caching to IndexedDB, per-profile quota,
  eviction policy. Covers must-have 6.
- **Scanlation ad hiding.** Perceptual hash per page, user marks one as ad/credits, every
  match auto-hides server-wide. No ML — scan groups reuse the same credit image across
  hundreds of chapters. Covers must-not A.
- **Recommendations v2.** Tag and genre overlap against rated titles plus trending; a SQL
  join, not ML. Revisit on real usage data.
- **Source health monitor.** Scheduled checks feeding the top-bar chip, with per-source
  history, so the chip reports a fact rather than one live request.
- **Command palette** and full keyboard control across the app.
- **AniSkip** intro/outro skip.
- **Error-surface audit.** Walk every failure path — dead provider, dead source, no match,
  empty chapter list, proxy 502, offline — and confirm each has a real, graceful state that
  says what happened and what to do. Covers must-not C.
- **Image cache sizing** once the server hardware is known (NOTES q5).

---

## Cross-cutting tracks

These don't belong to one phase; they get touched in several and must not be deferred to a
"polish" pass that never happens.

**Performance (must-have 1).** Cached bindings and cached chapter lists are the fast path;
only explicit user action re-scrapes. Metadata responses are revalidated, not refetched.
Page images are immutable and cached hard. Never fan a search across every installed source.

**UI (must-have 2).** Tokens in `styles/tokens.css` are the source of truth, shared by the
app and the static mockups. Dark-first,
border-first elevation, sentence case, two font weights, accent as punctuation. Every new
surface gets designed, not assembled.

**Accessibility.** Keyboard reachable, focus visible, labels on icon-only controls, motion
that explains rather than performs. Never simplified away.

**Errors (must-not C).** Every fetch returns `Ok|Err`; every render branch on `Err` says
what broke and what happens next. A failed source degrades one title, never the app.

---

## Open questions

Tracked in full in `NOTES.md`. The ones that block a phase:

| Question | Blocks |
|---|---|
| Novel metadata source — light novels only, or general books too? | Phase 3 novels tab, Phase 5 |
| Rails vs grids as a deliberate split | Phase 3 |
| Server hardware — sizes the page-image cache | Phase 7 |

---

## Not doing yet

Whisper subtitle generation · real multi-user auth · an own extension format.
Rationale in `NOTES.md`.

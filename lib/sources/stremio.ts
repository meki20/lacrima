import type { Lang } from "../audio.ts";
import { animeIds, nativeIds, type AnimeIds } from "../anime-ids.ts";
import { dedupeCues, toCue, type SubCue } from "../subs.ts";
import { ensureSubFiles, loadSubIndex, saveSubIndex } from "../sub-cache.ts";
import type { CacheCtx } from "../play-cache-client.ts";
import {
  browserPlayable,
  forLang,
  present,
  RANK_VERSION,
  type Candidate,
  type Playlist,
} from "../streams.ts";
import { normalize } from "../match.ts";
import { Err, Ok, type Result } from "../result.ts";
import type { Extension, Repo, SourceBackend, SourceChapter, SourceInfo, SourceManga } from "./types.ts";
import {
  addStoredRepo,
  getPlugin,
  listStoredPlugins,
  listStoredRepos,
  removeStoredRepo,
  setPluginInstalled,
  upsertPlugin,
} from "./store.ts";

type Extra = { name: string } | string;
type Catalog = {
  type: string;
  id: string;
  name?: string;
  extra?: Extra[];
  extraSupported?: string[];
};
type Manifest = {
  id?: string;
  name?: string;
  version?: string;
  logo?: string;
  types?: string[];
  idPrefixes?: string[];
  resources?: (string | { name: string; types?: string[]; idPrefixes?: string[] })[];
  catalogs?: Catalog[];
  addonCatalogs?: { type: string; id: string }[];
};

type Video = {
  id: string;
  title?: string;
  season?: number;
  episode?: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
};

type Meta = {
  id: string;
  name?: string;
  poster?: string;
  videos?: Video[];
};

function get(url: string, ms = 12_000, extra?: AbortSignal) {
  const timeout = AbortSignal.timeout(ms);
  return fetch(url, {
    cache: "no-store",
    signal: extra ? AbortSignal.any([timeout, extra]) : timeout,
  });
}

/** Stremio ids use colons (`tt2560140:1:1`). Encoding them makes some addons miss the title. */
function streamPath(type: string, id: string) {
  return `/stream/${type}/${id}.json`;
}

function subtitlePath(type: string, id: string) {
  return `/subtitles/${type}/${id}.json`;
}

function metaPath(type: string, id: string) {
  return `/meta/${type}/${id}.json`;
}

type Stream = {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  sources?: (string | { url?: string })[];
  behaviorHints?: {
    filename?: string;
    proxyHeaders?: { request?: Record<string, string> };
  };
};

/** Which episode the user actually clicked. Streams that disagree are wrong, not "alternatives". */
export type Slot = { season: number; episode: number };

const HASH = /^[a-fA-F0-9]{40}$/;

function httpUrl(s: Stream): string | null {
  if (s.url?.startsWith("http")) return s.url;
  for (const x of s.sources ?? []) {
    const u = typeof x === "string" ? x : x.url;
    if (u?.startsWith("http")) return u;
  }
  return null;
}

/** Stremio's `infoHash`, or a magnet in `url` / `sources` (`btih:`). */
function infoHashOf(s: Stream): string | null {
  if (s.infoHash && HASH.test(s.infoHash)) return s.infoHash.toLowerCase();
  const blob = [s.url, ...(s.sources ?? []).map((x) => (typeof x === "string" ? x : x.url ?? ""))].join(
    " ",
  );
  const m = /btih:([a-fA-F0-9]{40})/i.exec(blob);
  return m ? m[1].toLowerCase() : null;
}

const M3U8 = /\.m3u8(?:$|[?#])/i;

/** Same-origin so the video element is not CORS-blocked; torrents become WebTorrent. */
export function streamHref(s: Stream, want?: Slot): string | null {
  const http = httpUrl(s);
  if (http) {
    if (/signin\.mp4(?:$|[?#])/i.test(http) || /you must sign in/i.test(streamText(s))) return null;
    const q = new URLSearchParams({ url: http });
    const ref =
      s.behaviorHints?.proxyHeaders?.request?.Referer ??
      s.behaviorHints?.proxyHeaders?.request?.referer;
    if (ref) q.set("referer", ref);
    /* Relaying strips the extension off the URL, and the player has to choose HLS or
       plain video before it fetches anything — so the choice has to travel with it. */
    if (M3U8.test(http)) q.set("hls", "1");
    return `/api/stream?${q}`;
  }
  const ih = infoHashOf(s);
  if (!ih) return null;
  const q = new URLSearchParams({ ih });
  if (typeof s.fileIdx === "number") q.set("i", String(s.fileIdx));
  // A season pack has one file per episode; without this the relay would guess.
  if (want) {
    q.set("s", String(want.season));
    q.set("e", String(want.episode));
  }
  return `/api/stream?${q}`;
}

const streamText = (s: Stream) =>
  [s.name, s.title, s.description, s.behaviorHints?.filename].filter(Boolean).join(" ");

/**
 * Episode/season the stream claims to be. Torrent titles are freeform, so only
 * unambiguous forms count — a wrong guess here rejects a good stream.
 */
const EP_TAIL = "(?![\\da-z])(?!\\.\\d{1,2}(?!\\d))";

export function claimedSlot(text: string): { season: number | null; episode: number | null } {
  const se = new RegExp(`s(\\d{1,2})[\\s._-]?e(\\d{1,3})${EP_TAIL}`, "i").exec(text);
  if (se) return { season: Number(se[1]), episode: Number(se[2]) };
  const x = new RegExp(`\\b(\\d{1,2})x(\\d{1,3})${EP_TAIL}`, "i").exec(text);
  if (x) return { season: Number(x[1]), episode: Number(x[2]) };
  const ep = new RegExp(`(?:\\bep?(?:isode)?[\\s._-]?|\\s-\\s)(\\d{1,3})${EP_TAIL}`, "i").exec(text);
  if (ep) return { season: null, episode: Number(ep[1]) };
  return { season: null, episode: null };
}

/** Some HTTP addons put the real slot in the path (`…/tv.10687.S4E1.original.mp4`). */
function urlSlot(s: Stream): { season: number | null; episode: number | null } {
  const u = httpUrl(s);
  if (!u) return { season: null, episode: null };
  const se = /(?:[?&/._-])s(\d{1,2})e(\d{1,3})(?:[?&/._-]|$)/i.exec(u);
  if (!se) return { season: null, episode: null };
  return { season: Number(se[1]), episode: Number(se[2]) };
}

/** Wrong episode/season is not an "alternative". OVA dumps are not S01E01. */
export function episodeMatches(s: Stream, want?: Slot): boolean {
  if (!want) return true;
  const text = streamText(s);
  const claim = claimedSlot(text);
  const fromUrl = urlSlot(s);
  if (claim.episode != null && claim.episode !== want.episode) return false;
  if (claim.season != null && claim.season !== want.season) return false;
  if (fromUrl.episode != null && fromUrl.episode !== want.episode) return false;
  if (fromUrl.season != null && fromUrl.season !== want.season) return false;
  const spelled = namedSeason(text);
  if (spelled != null && spelled !== want.season) return false;
  const named = claim.season === want.season && claim.episode === want.episode;
  if (isSpecial(text) && !named) return false;
  return true;
}

/**
 * A season written out in words, which can contradict the SxxExx beside it.
 *
 * `One-Punch.Man.Season.3.S01E02` is season three, episode two: these releases
 * number each cour from S01, so the SxxExx alone says nothing about which season
 * it belongs to and `claimedSlot` waved it through as season one. The spelled-out
 * name is the only part that disagrees, so it is the only part worth reading.
 */
export function namedSeason(text: string): number | null {
  const m = /\bseasons?[\s._-]*(\d{1,2})\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * A side release: an OVA, an OAD, a special, a picture drama.
 *
 * `\bova\b` alone missed every real form. AniScraper offers One-Punch Man's
 * `OAD 01.mkv` and `S01OVA01.mkv` for `kitsu:10740:1` — a pack's side files, each
 * one carrying the addon's own "📜 Season 1 Episode 1" caption, which is simply
 * untrue. The word boundary was the bug: there is none inside `S01OVA01`.
 *
 * A special still plays if it names the exact slot asked for, because season 0
 * genuinely is where some entries keep their episodes.
 */
export function isSpecial(text: string): boolean {
  return /\bovas?\b|\+ova|\d(?:ova|oad)\d|\boad\b|\bnc(?:op|ed)\b|\bs00e\d|\bspecials?\b|\bpicture[\s._-]?drama\b/i.test(
    text,
  );
}

/**
 * The listing names exactly the season and episode we asked for.
 *
 * `- 01` is ambiguous across every season a show has; `S01E01` is not. Without
 * this, `One Punch Man (2025) - 01` — season three — sorted level with a file
 * that says `S01E01` outright, and won on codec. Evidence of the right episode
 * should beat the absence of evidence.
 */
export function namesSlot(text: string, want?: Slot): boolean {
  if (!want) return false;
  const se = new RegExp(`s0*${want.season}[\\s._-]?e0*${want.episode}${EP_TAIL}`, "i");
  const x = new RegExp(`\\b0*${want.season}x0*${want.episode}${EP_TAIL}`, "i");
  return se.test(text) || x.test(text);
}

/*
 * Which work a release file is actually of.
 *
 * TorrentClaw answers One Piece's own IMDB id with, among seventeen results,
 * "One Piece Fan Letter S01E01", "One Piece Log Fish-Man Island Saga S01E01" and
 * seven "ONE PIECE 2023 ... NF WEB-DL" live-action files. Every one of them
 * genuinely is an S01E01, so `episodeMatches` passes them and the quality and
 * codec rules rank them well. The filename is the only thing that distinguishes
 * a spin-off from the show you asked for, and we were not reading it.
 */
/* `s\d{1,2}` is optionally followed by an episode: a bare `Death.Note.S01.720p`
   marks a season just as clearly as `S01E01` does, and failing to cut there left
   the work reading as "Death Note S01", which matches no title anyone holds. */
const RELEASE_TAIL =
  /\b(s\d{1,2}(?:\s*e\d{1,3})?|\d{1,2}x\d{1,3}|season|temporada|staffel|saison|cap\.?\s*\d|ep(?:isode)?[\s._-]*\d|\d{3,4}p|4k|uhd|web[\s._-]?dl|webrip|blu[\s._-]?ray|hdtv|dvdrip|x26[45]|h\.?26[45]|hevc|vostfr|dual[\s._-]?audio)\b/i;

/**
 * The part of a release name before any season, episode or quality marker.
 *
 * Bracketed runs go first and whole: a title is essentially never inside them,
 * while release groups, hashes and quality tags always are — without that,
 * `[SubsPlease] One Piece - 1122` reads as a work called "SubsPlease One Piece".
 *
 * Only the last path segment is read. `behaviorHints.filename` is often a path,
 * and `Attack on Titan/Shingeki no Kyojin - S01E01.mkv` judged whole reads as one
 * title carrying both names — which is exactly the shape `wrongWork` rejects, so
 * the best-seeded files in the swarm were being discarded as a different work.
 */
export function releaseTitle(name: string): string {
  const cleaned = (name.split(/[\\/]/).pop() ?? name)
    .replace(/^\s*www\.[^\s]+\s*-\s*/i, "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[[({{][^\])}]*[\])}]/g, " ");
  const m = RELEASE_TAIL.exec(cleaned);
  return (m ? cleaned.slice(0, m.index) : cleaned).replace(/\s+/g, " ").trim();
}

/**
 * True when the file names the expected work *plus* something more — the mark of
 * a spin-off or side story, not an alternative encode of the same episode.
 *
 * Deliberately one-directional. A release sharing no words with the title we hold
 * ("Shingeki no Kyojin" against "Attack on Titan") is unjudgeable, not wrong, so
 * it is allowed through: this rejects only what it can actually prove.
 */
export function wrongWork(filename: string, expected: string): boolean {
  const want = new Set(normalize(expected).split(" ").filter(Boolean));
  if (!want.size) return false;
  const got = normalize(releaseTitle(filename)).split(" ").filter(Boolean);
  if (!got.length) return false;
  const has = new Set(got);
  for (const w of want) if (!has.has(w)) return false;
  // Bare numbers are years, resolutions and part numbers — never a different work.
  return got.some((t) => !want.has(t) && /^[a-z]{3,}$/.test(t));
}

/** The release names exactly the work we asked for, with nothing bolted on. */
function sameWork(filename: string | undefined, expected: string | undefined): boolean {
  if (!filename || !expected) return false;
  return normalize(releaseTitle(filename)) === normalize(expected);
}

const IMDB_EP = /^(tt\d+):(\d+):(\d+)$/;
const IMDB_BARE = /^tt\d+$/;

/** Stremio movie ids are bare IMDB ids; series ids carry `:season:episode`. */
export function isBareMovieId(id: string): boolean {
  return IMDB_BARE.test(id);
}

/** The season/episode a Stremio video id points at, so streams can be checked against it. */
export function wantedSlot(id: string): Slot | undefined {
  const imdb = IMDB_EP.exec(id);
  if (imdb) return { season: Math.max(Number(imdb[2]), 1), episode: Number(imdb[3]) };
  const kitsu = /^kitsu:\d+:(\d+)$/.exec(id);
  if (kitsu) return { season: 1, episode: Number(kitsu[1]) };
  return undefined;
}

/** Widest reach first: every anime addon speaks `kitsu:`, only some speak the rest. */
const ANIME_NS = ["kitsu", "anilist", "mal"] as const;

/**
 * Which ids to ask with, best question first.
 *
 * Anime-namespaced ids lead deliberately. `collectStreams` stops at the first id
 * that answers, so whichever id is first *is* the question the addon gets asked —
 * and an IMDB id asks "what files exist for this work", which for One Piece
 * includes the 2023 live action. Asking `kitsu:12:1` first made ten of twenty-seven
 * results stop being live action, and cut the resolve from 13.3s to 1.6s because
 * the addons that only speak `tt` are the slow ones.
 */
export function extraStreamIds(
  id: string,
  extras?: { via?: string; mediaId?: number; ids?: AnimeIds },
): string[] {
  const catalog = [id];
  const imdb = IMDB_EP.exec(id);
  if (imdb && imdb[2] === "0") catalog.push(`${imdb[1]}:1:${imdb[3]}`);

  /* `kitsu:{id}:{n}` is episode n of that one entry, so it is only the same
     episode as a catalog id shaped like season 1. A bare movie id has no
     episode at all — `kitsu:176:tt0748454` is not a question anyone can answer. */
  const season = imdb ? Number(imdb[2]) : null;
  if (season != null && season > 1) return catalog;
  const episode = imdb ? imdb[3] : id.split(":").at(-1);
  if (!episode || !/^\d+$/.test(episode)) return catalog;

  const ids = { ...nativeIds(extras?.via, extras?.mediaId), ...extras?.ids };
  const anime = ANIME_NS.filter((ns) => ids[ns] && !id.startsWith(`${ns}:`)).map(
    (ns) => `${ns}:${ids[ns]}:${episode}`,
  );
  return [...anime, ...catalog];
}

function videoSlot(v: Video, i: number) {
  const m = /:(\d+):(\d+)$/.exec(v.id);
  return {
    season: v.season ?? (m ? Number(m[1]) : 1),
    episode: v.episode ?? (m ? Number(m[2]) : i + 1),
  };
}

function seasonRank(s: number) {
  return s > 0 ? s : 1000;
}

function addonBase(indexUrl: string) {
  return indexUrl.replace(/\/manifest\.json$/i, "").replace(/\/$/, "");
}

function split(id: string): [string, string] {
  const i = id.indexOf("::");
  return i < 0 ? ["", id] : [id.slice(0, i), id.slice(i + 2)];
}

async function manifest(indexUrl: string): Promise<Result<Manifest>> {
  try {
    const res = await get(indexUrl);
    if (!res.ok) return Err(`Addon returned ${res.status}.`);
    const json: unknown = await res.json();
    if (looksLikeAniyomi(json)) {
      return Err(
        "That's an Aniyomi APK index. Anime here uses a Stremio addon (a manifest.json), not Android extensions.",
      );
    }
    const man = json as Manifest;
    if (!man || typeof man !== "object" || Array.isArray(man) || !(man.id || man.name || man.catalogs)) {
      return Err("That URL is not a Stremio addon manifest.");
    }
    return Ok(man);
  } catch (e) {
    return Err(e instanceof Error ? e.message : "Could not reach the Stremio addon.");
  }
}

function resourceNames(m: Manifest): string[] {
  return (m.resources ?? []).map((r) => (typeof r === "string" ? r : r.name));
}

/**
 * The `stream` resource may narrow `idPrefixes` and `types` for itself, and the
 * spec says that entry wins over the manifest-level fields.
 *
 * Reading only the top level is how Peerflix — which declares `idPrefixes: ["tt"]`
 * on its stream resource and nothing at the top — was sent the `kitsu:` id we
 * synthesise. Asking an addon for a namespace it told us it does not speak is
 * how you get an answer about some other title entirely.
 */
function namedResource(m: Manifest, name: string) {
  return (m.resources ?? []).find(
    (r): r is { name: string; types?: string[]; idPrefixes?: string[] } =>
      typeof r === "object" && r.name === name,
  );
}

function streamResource(m: Manifest) {
  return namedResource(m, "stream");
}

function subtitleResource(m: Manifest) {
  return namedResource(m, "subtitles");
}

function declaredTypes(m: Manifest): string[] | undefined {
  return streamResource(m)?.types ?? m.types;
}

/** Cinemeta ships catalog + meta and no streams; asking it for one is a guaranteed 404. */
export function servesStreams(m: Manifest): boolean {
  return resourceNames(m).includes("stream");
}

export function servesSubtitles(m: Manifest): boolean {
  return resourceNames(m).includes("subtitles");
}

/**
 * Which of our candidate ids this addon will even recognise. AnimePahe declares
 * `idPrefixes: ["ap"]`, so every `tt…` request to it is a wasted round trip.
 */
function idsForResource(
  prefixes: string[] | undefined,
  fallback: string[] | undefined,
  ids: string[],
): string[] {
  const list = prefixes ?? fallback;
  if (!list?.length) return ids;
  return ids.filter((id) => list.some((p) => id.startsWith(p)));
}

export function idsFor(m: Manifest, ids: string[]): string[] {
  return idsForResource(streamResource(m)?.idPrefixes, m.idPrefixes, ids);
}

export function idsForSubs(m: Manifest, ids: string[]): string[] {
  return idsForResource(subtitleResource(m)?.idPrefixes, m.idPrefixes, ids);
}

/** Resource paths to try, narrowed to the types the addon claims to serve. */
export function streamTypes(m: Manifest): string[] {
  const order = ["series", "anime", "movie"];
  const types = declaredTypes(m);
  const declared = types?.length ? order.filter((t) => types.includes(t)) : [];
  return declared.length ? declared : order;
}

/** Bare `tt…` ids are films; ask `/stream/movie/` before series-shaped paths. */
export function streamTypesFor(m: Manifest, id: string): string[] {
  if (!isBareMovieId(id)) return streamTypes(m);
  const order = ["movie", "series", "anime"];
  const types = declaredTypes(m);
  const declared = types?.length ? order.filter((t) => types.includes(t)) : [];
  return declared.length ? declared : order;
}

export function subtitleTypesFor(m: Manifest, id: string): string[] {
  const order = isBareMovieId(id) ? ["movie", "series", "anime"] : ["series", "anime", "movie"];
  const types = subtitleResource(m)?.types ?? m.types;
  const declared = types?.length ? order.filter((t) => types.includes(t)) : [];
  return declared.length ? declared : order;
}

// ponytail: process-lifetime manifest cache, no TTL — restart picks up changes.
const manifests = new Map<string, Manifest>();

async function manifestCached(url: string): Promise<Manifest | null> {
  const hit = manifests.get(url);
  if (hit) return hit;
  const r = await manifest(url);
  if (!r.ok) return null;
  manifests.set(url, r.value);
  return r.value;
}

function isAnimeAddon(m: Manifest): boolean {
  const types = m.types ?? [];
  return types.includes("anime") || /anime/i.test(`${m.name ?? ""} ${m.id ?? ""}`);
}

function isSubtitleAddon(m: Manifest): boolean {
  return servesSubtitles(m);
}

async function pullRepo(indexUrl: string, man: Manifest): Promise<Result<number>> {
  const id = man.id ?? indexUrl;
  addStoredRepo(indexUrl, "anime", man.name ?? id);
  upsertPlugin({
    id,
    kind: "anime",
    repo_url: indexUrl,
    name: man.name ?? id,
    lang: "all",
    version: man.version ?? "1",
    icon_url: man.logo ?? null,
    plugin_url: indexUrl,
    installed: 1,
  });
  setPluginInstalled(id, "anime", true);

  const cats = man.addonCatalogs ?? [];
  const cat =
    cats.find((c) => c.type === "all" && c.id === "community") ??
    cats.find((c) => c.id === "community") ??
    cats[0];
  if (!cat) return Ok(1);

  try {
    const res = await get(`${addonBase(indexUrl)}/addon_catalog/${cat.type}/${cat.id}.json`);
    if (!res.ok) return Ok(1);
    const json = (await res.json()) as {
      addons?: { transportUrl?: string; manifest?: Manifest }[];
    };
    let n = 1;
    for (const a of json.addons ?? []) {
      const m = a.manifest;
      const transport = a.transportUrl;
      if (!m?.id || !transport || m.id === id || transport.includes("127.0.0.1")) continue;
      if (!isAnimeAddon(m) && !isSubtitleAddon(m)) continue;
      upsertPlugin({
        id: m.id,
        kind: "anime",
        repo_url: indexUrl,
        name: m.name ?? m.id,
        lang: "all",
        version: m.version ?? "1",
        icon_url: m.logo ?? null,
        plugin_url: transport,
      });
      n++;
    }
    return Ok(n);
  } catch {
    return Ok(1);
  }
}

function looksLikeAniyomi(json: unknown): boolean {
  const first = Array.isArray(json) ? json[0] : null;
  return Boolean(first && typeof first === "object" && ("apk" in first || "pkg" in first));
}

function extraNames(c: Catalog): string[] {
  const named = (c.extra ?? []).map((e) => (typeof e === "string" ? e : e.name));
  return [...named, ...(c.extraSupported ?? [])];
}

const JUNK_META =
  /\b(pro|upgrade|premium|debrid|personalized)\b|^(tc-|addon:)/i;

function junkMeta(m: Meta, cat?: Catalog): boolean {
  const id = m.id ?? "";
  const name = m.name ?? "";
  if (JUNK_META.test(id) || JUNK_META.test(name)) return true;
  if (id.startsWith("tc-upgrade") || cat?.id?.includes("upgrade")) return true;
  return false;
}

function searchableCatalogs(man: Manifest): Catalog[] {
  const cats = man.catalogs ?? [];
  const searchable = (c: Catalog) => extraNames(c).includes("search");
  const found = cats.filter(searchable);
  const order = ["movie", "series", "anime"];
  return [...found].sort((a, b) => {
    const ai = order.indexOf(a.type);
    const bi = order.indexOf(b.type);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

function metaChapterCount(m: Meta, catType: string): number | null {
  const n = m.videos?.length;
  if (n) return n;
  if (catType === "movie" || isBareMovieId(m.id)) return 1;
  return null;
}

/**
 * Ask one addon for streams, sequentially, stopping at the first answer.
 *
 * Never fan id × type out in parallel: TorrentsDB answers `series` on the first
 * try and 429s the rest, so the parallel version rate-limited the one addon that
 * actually works. Same rule as `pickSearchable` — one addon is one host.
 */
export type Bag = { name: string; streams: Stream[]; error?: string };

/**
 * Whole-chain budget, and it has to clear the slowest addon that actually works.
 *
 * Measured, not guessed: AnimeStream scrapes on first ask and caches per episode
 * upstream, so the same request costs ~28s once and ~0.6s forever after. A 22s
 * budget therefore threw away the only answer available roughly six seconds before
 * it arrived — the addon was never too slow, we just stopped listening too early.
 * Cutting this back below ~30s silently breaks playback again.
 */
const ADDON_BUDGET_MS = 34_000;
/** Nobody answered with a playable stream; stop hanging the player. */
const HARD_DEADLINE_MS = 36_000;

/**
 * Resolved candidates, kept because the first answer is so expensive.
 *
 * A retry, a re-open, and the next-episode warm-up must never pay AnimeStream's
 * ~28s scrape twice. Deliberately short-lived and in-process: torrent hrefs never
 * expire, but debrid links do, so this is a latency cache and not storage.
 * Failures are never cached — a rate-limited addon has to be retryable.
 */
const RESOLVED_TTL_MS = 15 * 60_000;
const RESOLVED_MAX = 300;
const resolved = new Map<string, { at: number; picks: Playlist }>();

function cached(key: string): Playlist | null {
  const hit = resolved.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RESOLVED_TTL_MS) {
    resolved.delete(key);
    return null;
  }
  return hit.picks;
}

function remember(key: string, picks: Playlist) {
  // Map keeps insertion order, so the oldest key is the first one out.
  if (resolved.size >= RESOLVED_MAX) resolved.delete(resolved.keys().next().value!);
  resolved.set(key, { at: Date.now(), picks });
}

const CHAPTERS_TTL_MS = 30 * 60_000;
const chapterLists = new Map<string, { at: number; chapters: SourceChapter[] }>();

function chaptersCached(key: string) {
  const hit = chapterLists.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CHAPTERS_TTL_MS) {
    chapterLists.delete(key);
    return null;
  }
  return hit.chapters;
}

function rememberChapters(key: string, chapters: SourceChapter[]) {
  chapterLists.set(key, { at: Date.now(), chapters });
}

/**
 * Which resource path an addon actually answered on, per id shape.
 *
 * An addon that declares no `types` is asked for series, then anime, then movie,
 * for every candidate id — up to nine sequential round trips before the first
 * stream, repeated for every episode of the show. It answers on the same one
 * every time, so remember it and lead with it. Never a negative cache: a
 * rate-limited addon has to stay retryable.
 */
const answered = new Map<string, string>();

function idShape(id: string) {
  if (/^tt\d/.test(id)) return "tt";
  const i = id.indexOf(":");
  return i < 0 ? id : id.slice(0, i);
}

/**
 * A listing with nothing to play is an advert, not a stream.
 *
 * PenguPlay answers every id with "support the project! pengu.uk/donate" and
 * AIOStreams with a "Removal Reasons" notice. Both are `streams: [...]` of length
 * one, so both used to end the id loop as if the addon had answered — the good
 * ids after them were never tried, and the addon was memoised as working.
 */
export function playableListing(s: Stream): boolean {
  return Boolean(httpUrl(s) || infoHashOf(s));
}

/**
 * Addons that told us *they* are broken, not that this title is missing.
 *
 * Measured on a live install: Meteor 401s every request, TorrentsDB 429s every
 * request, and each one costs a round trip on every id × type combination, for
 * every episode. A 404 is never cached — that is "I don't have this id", which
 * is a property of the title and not of the addon.
 */
const COOLDOWN_MS: Record<number, number> = { 401: 30 * 60_000, 403: 30 * 60_000, 429: 5 * 60_000 };
const cooling = new Map<string, { until: number; why: string }>();

/** Why this addon is being skipped, or null when it should be asked. */
export function coolingOff(name: string): string | null {
  const hit = cooling.get(name);
  if (!hit) return null;
  if (Date.now() >= hit.until) {
    cooling.delete(name);
    return null;
  }
  return hit.why;
}

export function coolDown(name: string, status: number, why: string) {
  const ms = COOLDOWN_MS[status];
  if (ms) cooling.set(name, { until: Date.now() + ms, why });
}

export function clearCooldowns() {
  cooling.clear();
}

async function collectStreams(
  name: string,
  base: string,
  ids: string[],
  types: string[],
  signal: AbortSignal,
): Promise<Bag> {
  const cold = coolingOff(name);
  if (cold) return { name, streams: [], error: cold };
  const until = Date.now() + ADDON_BUDGET_MS;
  let error: string | undefined;
  for (const id of ids) {
    const memoKey = `${name}|${idShape(id)}`;
    const known = answered.get(memoKey);
    const order = known ? [known, ...types.filter((t) => t !== known)] : types;
    for (const type of order) {
      if (signal.aborted) return { name, streams: [], error: "dropped — another source already answered" };
      const left = until - Date.now();
      if (left <= 500) return { name, streams: [], error: error ?? "was too slow to answer" };
      try {
        const res = await get(`${base}${streamPath(type, id)}`, left, signal);
        if (res.status === 429) {
          const why = "rate-limited us";
          error ??= why;
          coolDown(name, res.status, why);
          return { name, streams: [], error };
        }
        /* The public manifest of a debrid addon answers 403 to everyone. That is a
           setup step, not an outage, so say so instead of failing silently. */
        if (res.status === 401 || res.status === 403) {
          const why =
            "refused us: its public manifest needs your own configured URL (a debrid account)";
          error ??= why;
          coolDown(name, res.status, why);
          return { name, streams: [], error };
        }
        if (!res.ok) continue;
        const json = (await res.json()) as { streams?: Stream[] };
        const streams = (json.streams ?? []).filter(playableListing);
        if (streams.length) {
          answered.set(memoKey, type);
          return { name, streams };
        }
      } catch {
        error ??= "did not answer in time";
      }
    }
  }
  return { name, streams: [], error };
}

function playlistFrom(bags: Bag[], want?: Slot, prefer?: Lang, title?: string): Playlist {
  const items: Candidate[] = [];
  const seen = new Set<string>();
  for (const b of bags) {
    for (const s of b.streams) {
      if (!episodeMatches(s, want)) continue;
      const file = s.behaviorHints?.filename;
      /* Only the filename is judged. The other fields are the addon's own card —
         seeders, size, flags — and a title regex over that proves nothing. */
      if (file && title && wrongWork(file, title)) continue;
      const url = streamHref(s, want);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      items.push({
        text: streamText(s),
        url,
        provider: b.name,
        described: Boolean(s.title || s.description || file),
        sameWork: sameWork(file, title),
        exactSlot: namesSlot(streamText(s), want),
      });
    }
  }
  return present(items, prefer);
}

function playableUrls(streams: Stream[], want?: Slot): string[] {
  const urls: string[] = [];
  for (const s of streams) {
    if (!episodeMatches(s, want)) continue;
    const url = streamHref(s, want);
    if (!url || !browserPlayable(streamText(s))) continue;
    urls.push(url);
  }
  return urls;
}

/**
 * Fire every addon at once. The first *browser-playable* answer starts an 8s
 * window so siblings can still land; HEVC/DDP listings do not count as a win.
 * Empty/403/wrong-episode replies never count as a win.
 */
export async function raceFirstPlayable(
  jobs: { name: string; run: (signal: AbortSignal) => Promise<Bag> }[],
  want?: Slot,
  budgetMs = HARD_DEADLINE_MS,
): Promise<Bag[]> {
  const ac = new AbortController();
  const bags: Bag[] = [];
  let settled = 0;
  /* Long enough for siblings that are already answering to land, short enough that
     it is not simply added to every cold start. The addons this used to wait eight
     seconds for are the slow debrid ones you would never have played anyway, and
     the menu they were filling in is now stored per episode, so a later resolve
     recovers anything missed here. */
  const GRACE_MS = 2_000;

  await new Promise<void>((resolve) => {
    let closed = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(hard);
      if (grace) clearTimeout(grace);
      ac.abort();
      resolve();
    };
    const hard = setTimeout(finish, budgetMs);
    if (!jobs.length) {
      finish();
      return;
    }
    for (const job of jobs) {
      job
        .run(ac.signal)
        .catch((e: unknown): Bag => ({
          name: job.name,
          streams: [],
          error: e instanceof Error ? e.message : "failed",
        }))
        .then((bag) => {
          bags.push(bag);
          settled++;
          const urls = playableUrls(bag.streams, want);
          if (urls.length) {
            grace ??= setTimeout(finish, GRACE_MS);
            if (settled === jobs.length) finish();
          } else if (settled === jobs.length) finish();
        });
    }
  });

  for (const job of jobs) {
    if (!bags.some((b) => b.name === job.name)) {
      bags.push({ name: job.name, streams: [], error: "dropped — another source already answered" });
    }
  }
  return bags;
}

/*
 * One resolve per episode, however many callers ask.
 *
 * The page starts this while it renders so the addon fan-out overlaps hydration
 * instead of following it. Without dedup the player's own request lands mid-flight,
 * misses the cache, and fires a second full fan-out at the same addons.
 */
const inflight = new Map<string, Promise<Result<Playlist>>>();

export async function resolveStreams(
  chapterId: string,
  extras?: { via?: string; mediaId?: number; lang?: Lang; title?: string },
): Promise<Result<Playlist>> {
  const lang = extras?.lang;
  const key = `${RANK_VERSION}|${chapterId}|${extras?.via ?? ""}|${extras?.mediaId ?? ""}`;
  const hit = cached(key);
  if (hit) return Ok(forLang(hit, lang));

  let run = inflight.get(key);
  if (!run) {
    run = resolveUncached(chapterId, key, extras);
    inflight.set(key, run);
    void run.catch(() => undefined).finally(() => inflight.delete(key));
  }
  const r = await run;
  return r.ok ? Ok(forLang(r.value, lang)) : r;
}

async function resolveUncached(
  chapterId: string,
  key: string,
  extras?: { via?: string; mediaId?: number; lang?: Lang; title?: string },
): Promise<Result<Playlist>> {
  const [boundId, id] = split(chapterId);
  const lang = extras?.lang;
  const plugins = listStoredPlugins("anime").filter((p) => p.installed && p.plugin_url);
  const ordered = [
    ...plugins.filter((p) => p.id === boundId),
    ...plugins.filter((p) => p.id !== boundId),
  ];
  const want = wantedSlot(id);

  /* The mapping lookup and the manifests are independent, and both are cached
     after the first title — running them together keeps the added round trip off
     the critical path entirely. */
  const [mapped, mans] = await Promise.all([
    animeIds(extras?.via, extras?.mediaId),
    Promise.all(ordered.map((p) => manifestCached(p.plugin_url!))),
  ]);
  const ids = extraStreamIds(id, {
    via: extras?.via,
    mediaId: extras?.mediaId,
    ids: mapped,
  });

  const targets = ordered
    .map((p, i) => {
      const man = mans[i];
      if (!man || !servesStreams(man)) return null;
      const mine = idsFor(man, ids);
      return mine.length ? { p, ids: mine, types: streamTypesFor(man, id) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (targets.length === 0) {
    return Err(
      "No installed addon can stream this. Cinemeta and other catalog addons only supply metadata — add a stream addon.",
    );
  }

  const bags = await raceFirstPlayable(
    targets.map((t) => ({
      name: t.p.name,
      run: (signal) => collectStreams(t.p.name, addonBase(t.p.plugin_url!), t.ids, t.types, signal),
    })),
    want,
    HARD_DEADLINE_MS,
  );
  const all = bags.flatMap((b) => b.streams);
  const failures = bags.filter((b) => b.error).map((b) => `${b.name} ${b.error}.`);

  const list = playlistFrom(bags, want, lang, extras?.title);
  if (list.groups.length) {
    remember(key, list);
    return Ok(list);
  }

  const tail = failures.length ? ` ${failures.join(" ")}` : "";
  if (all.length) {
    return Err(
      want
        ? `${all.length} streams came back, but none was season ${want.season} episode ${want.episode} in a format the browser can play.${tail}`
        : `The addon returned no playable streams for this episode.${tail}`,
    );
  }
  return Err(`No stream for this episode.${tail || " The addon may be catalog-only."}`);
}

type StremioSub = {
  url?: string;
  lang?: string;
  language?: string;
  id?: string;
  label?: string;
  name?: string;
  filename?: string;
};

const SUB_BUDGET_MS = 8_000;
const SUB_TTL_MS = 15 * 60_000;
const SUB_MAX_ADDONS = 8;
const subtitles = new Map<string, { at: number; cues: SubCue[] }>();
const subInflight = new Map<string, Promise<Result<SubCue[]>>>();

function cachedSubs(key: string): SubCue[] | null {
  const hit = subtitles.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SUB_TTL_MS) {
    subtitles.delete(key);
    return null;
  }
  return hit.cues;
}

async function collectSubtitles(
  name: string,
  base: string,
  ids: string[],
  types: string[],
  signal: AbortSignal,
): Promise<SubCue[]> {
  const cold = coolingOff(name);
  if (cold) return [];
  const until = Date.now() + SUB_BUDGET_MS;
  for (const id of ids) {
    for (const type of types) {
      if (signal.aborted) return [];
      const left = until - Date.now();
      if (left <= 400) return [];
      try {
        const res = await get(`${base}${subtitlePath(type, id)}`, left, signal);
        if (res.status === 429 || res.status === 401 || res.status === 403) {
          coolDown(name, res.status, res.status === 429 ? "rate-limited us" : "refused us");
          return [];
        }
        if (!res.ok) continue;
        const json = (await res.json()) as { subtitles?: StremioSub[]; Subtitles?: StremioSub[] };
        const rows = json.subtitles ?? json.Subtitles ?? [];
        const cues = rows.map((row) => toCue(row, name)).filter((c): c is SubCue => c !== null);
        if (cues.length) return cues;
      } catch {
        continue;
      }
    }
  }
  return [];
}

/**
 * Ask every installed addon that serves subtitles. Unlike streams, the first
 * answer is not enough — we want the language list, so replies are merged.
 */
export async function resolveSubtitles(
  chapterId: string,
  extras?: { via?: string; mediaId?: number },
): Promise<Result<SubCue[]>> {
  const ctx: CacheCtx | null =
    extras?.via && extras.mediaId != null && Number.isFinite(extras.mediaId)
      ? { via: extras.via as CacheCtx["via"], mediaId: extras.mediaId, chapterId }
      : null;
  if (ctx) {
    const disk = loadSubIndex(ctx);
    if (disk.length) {
      void ensureSubFiles(ctx, disk);
      return Ok(disk);
    }
  }

  const [, id] = split(chapterId);
  const key = `sub|${chapterId}|${extras?.via ?? ""}|${extras?.mediaId ?? ""}`;
  const hit = cachedSubs(key);
  if (hit) return Ok(hit);

  let run = subInflight.get(key);
  if (!run) {
    run = resolveSubtitlesUncached(id, extras).then((r) => {
      if (r.ok) {
        subtitles.set(key, { at: Date.now(), cues: r.value });
        if (ctx && r.value.length) {
          saveSubIndex(ctx, r.value);
          ensureSubFiles(ctx, r.value);
        }
      }
      return r;
    });
    subInflight.set(key, run);
    void run.catch(() => undefined).finally(() => subInflight.delete(key));
  }
  return await run;
}

async function resolveSubtitlesUncached(
  id: string,
  extras?: { via?: string; mediaId?: number },
): Promise<Result<SubCue[]>> {
  const plugins = listStoredPlugins("anime").filter((p) => p.installed && p.plugin_url);
  const [mapped, mans] = await Promise.all([
    animeIds(extras?.via, extras?.mediaId),
    Promise.all(plugins.map((p) => manifestCached(p.plugin_url!))),
  ]);
  const ids = extraStreamIds(id, {
    via: extras?.via,
    mediaId: extras?.mediaId,
    ids: mapped,
  });

  const targets = plugins
    .map((p, i) => {
      const man = mans[i];
      if (!man || !servesSubtitles(man)) return null;
      const mine = idsForSubs(man, ids);
      return mine.length
        ? { p, ids: mine, types: subtitleTypesFor(man, id) }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, SUB_MAX_ADDONS);

  if (!targets.length) return Ok([]);

  const ac = new AbortController();
  const hard = setTimeout(() => ac.abort(), SUB_BUDGET_MS);
  try {
    const bags = await Promise.all(
      targets.map((t) =>
        collectSubtitles(t.p.name, addonBase(t.p.plugin_url!), t.ids, t.types, ac.signal).catch(
          () => [] as SubCue[],
        ),
      ),
    );
    return Ok(dedupeCues(bags.flat()));
  } finally {
    clearTimeout(hard);
    ac.abort();
  }
}

export const stremio: SourceBackend = {
  name: "Stremio",
  kind: "anime",

  async listSources() {
    const installed = listStoredPlugins("anime").filter((p) => p.installed);
    return Ok(
      installed.map(
        (p): SourceInfo => ({
          id: p.id,
          name: p.name,
          lang: p.lang,
          iconUrl: p.icon_url,
          kind: "anime",
          isLocal: false,
        }),
      ),
    );
  },

  async search(sourceId, query) {
    const p = getPlugin(sourceId, "anime");
    if (!p?.plugin_url) return Err(`Addon ${sourceId} is not installed.`);
    const man = await manifest(p.plugin_url);
    if (!man.ok) return man;
    const catalogs = searchableCatalogs(man.value);
    if (!catalogs.length) return Ok([]);
    const base = addonBase(p.plugin_url);
    const seen = new Set<string>();
    const items: SourceManga[] = [];
    let hardError: string | undefined;
    for (const cat of catalogs) {
      try {
        const url = `${base}/catalog/${cat.type}/${cat.id}/search=${encodeURIComponent(query)}.json`;
        const res = await get(url, 8_000);
        if (!res.ok) {
          hardError ??= `${p.name} search returned ${res.status}.`;
          continue;
        }
        const json = (await res.json()) as { metas?: Meta[] };
        for (const m of json.metas ?? []) {
          if (!m.id || seen.has(m.id) || junkMeta(m, cat)) continue;
          seen.add(m.id);
          items.push({
            id: `${sourceId}::${m.id}`,
            sourceId,
            sourceName: p.name,
            title: m.name ?? m.id,
            thumbnailUrl: m.poster ?? null,
            chapterCount: metaChapterCount(m, cat.type),
          });
        }
      } catch (e) {
        hardError ??= e instanceof Error ? e.message : `${p.name} failed to search.`;
      }
    }
    if (items.length) return Ok(items);
    return hardError ? Err(hardError) : Ok([]);
  },

  async chapters(mangaId) {
    const [sourceId, id] = split(mangaId);
    const p = getPlugin(sourceId, "anime");
    if (!p?.plugin_url) return Err("That anime addon is not installed.");
    const cacheKey = `ch2|${mangaId}`;
    const hit = chaptersCached(cacheKey);
    if (hit) return Ok(hit);
    const base = addonBase(p.plugin_url);
    const metaOrder = isBareMovieId(id) ? ["movie", "series", "anime"] : ["series", "anime", "movie"];
    let videos: Video[] | null = null;
    for (const type of metaOrder) {
      try {
        const res = await get(`${base}${metaPath(type, id)}`, 4_000);
        if (!res.ok) continue;
        const json = (await res.json()) as { meta?: Meta };
        const meta = json.meta;
        if (!meta?.id) continue;
        if (meta.videos?.length) {
          videos = meta.videos;
          break;
        }
        if (meta.name && (type === "movie" || isBareMovieId(id))) {
          videos = [{ id: meta.id, title: meta.name, season: 1, episode: 1 }];
          break;
        }
      } catch {
        continue;
      }
    }
    if (!videos) return Err("The addon has no episode list for that title.");
    const ordered = [...videos].sort((a, b) => {
      const sa = videoSlot(a, 0);
      const sb = videoSlot(b, 0);
      return seasonRank(sa.season) - seasonRank(sb.season) || sa.episode - sb.episode;
    });
    const chapters = ordered.map((v, i): SourceChapter => {
      const slot = videoSlot(v, i);
      return {
        id: `${sourceId}::${v.id}`,
        number: slot.episode,
        name: v.title ?? `Episode ${slot.episode}`,
        scanlator: slot.season > 0 ? `S${slot.season}` : "Specials",
        uploadDate: v.released ? Date.parse(v.released) : null,
        pageCount: null,
        season: slot.season,
        thumbnailUrl: v.thumbnail ?? null,
        overview: v.overview ?? null,
      };
    });
    rememberChapters(cacheKey, chapters);
    return Ok(chapters);
  },

  async pages(chapterId, extras) {
    const r = await resolveStreams(chapterId, extras);
    if (!r.ok) return r;
    const g = r.value.groups.find((x) => x.id === r.value.preferred) ?? r.value.groups[0];
    return Ok(g?.picks.map((p) => p.url) ?? []);
  },

  async listRepos() {
    return Ok(
      listStoredRepos("anime").map(
        (r): Repo => ({
          indexUrl: r.index_url,
          name: r.name,
          kind: "anime",
          isLegacy: true,
          extensionCount: listStoredPlugins("anime").filter((p) => p.repo_url === r.index_url)
            .length,
        }),
      ),
    );
  },

  async addRepo(indexUrl) {
    const man = await manifest(indexUrl);
    if (!man.ok) return man;
    const pulled = await pullRepo(indexUrl, man.value);
    return pulled.ok ? Ok(true as const) : pulled;
  },

  async removeRepo(indexUrl) {
    removeStoredRepo(indexUrl, "anime");
    return Ok(true as const);
  },

  async refreshExtensions() {
    const repos = listStoredRepos("anime");
    const rs = await Promise.all(
      repos.map(async (r) => {
        const man = await manifest(r.index_url);
        if (!man.ok) return man;
        return pullRepo(r.index_url, man.value);
      }),
    );
    let n = 0;
    for (const r of rs) {
      if (!r.ok) return r;
      n += r.value;
    }
    return Ok(n);
  },

  async listExtensions(query: string) {
    const q = query.toLowerCase();
    return Ok(
      listStoredPlugins("anime")
        .filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
        .map(
          (p): Extension => ({
            pkgName: p.id,
            name: p.name,
            lang: p.lang,
            version: p.version,
            iconUrl: p.icon_url,
            isInstalled: Boolean(p.installed),
            hasUpdate: false,
            kind: "anime",
          }),
        ),
    );
  },

  async setExtensionInstalled(pkgName, install) {
    setPluginInstalled(pkgName, "anime", install);
    return Ok(true as const);
  },
};

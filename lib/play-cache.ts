import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Lang } from "./audio.ts";
import type { ProviderSlug } from "./media.ts";
import { finalizeRacePoolsForStore } from "./torrent.ts";
import { persistMedia, type CacheCtx } from "./play-cache-client.ts";
import { RANK_VERSION, type Playlist, type Quality, type StreamGroup, type StreamPick } from "./streams.ts";

export { RANK_VERSION };

export type { CacheCtx } from "./play-cache-client.ts";
export { persistMedia, withCacheParams } from "./play-cache-client.ts";

function cacheRoot() {
  return process.env.LACRIMA_CACHE ?? join(process.cwd(), "data", "cache", "anime");
}

export type CachedPick = {
  groupId: string;
  url: string;
  provider: string;
  hint?: string;
  subtitles?: Lang[];
  kind: "torrent" | "http";
  ih?: string;
  fileIdx?: number | null;
  httpUrl?: string;
  referer?: string | null;
  s?: number;
  e?: number;
  committedAt: number;
  /** Absent means it predates versioning, which is exactly what must be dropped. */
  v?: number;
};

type PicksFile = Record<string, Record<string, CachedPick>>;

export function parseCacheCtx(q: URLSearchParams): CacheCtx | null {
  const via = q.get("cv");
  const mediaId = Number(q.get("cm"));
  const chapterId = q.get("cc");
  if (!via || !Number.isFinite(mediaId) || !chapterId) return null;
  return { via: via as ProviderSlug, mediaId, chapterId };
}

/* Path helpers are pure. Creating directories is a side effect of *writing*, and
   putting it here meant three mkdir syscalls on every byte-range request. */
export function animeDir(via: string, mediaId: number): string {
  return join(cacheRoot(), `${via}-${mediaId}`);
}

export function chapterSlug(chapterId: string): string {
  return createHash("sha256").update(chapterId).digest("hex").slice(0, 20);
}

export function torrentStore(via: string, mediaId: number): string {
  if (!persistMedia()) return join(tmpdir(), "lacrima-torrents", `${via}-${mediaId}`);
  return join(animeDir(via, mediaId), "torrents");
}

export function mediaDir(ctx: CacheCtx): string {
  return join(animeDir(ctx.via, ctx.mediaId), "media", chapterSlug(ctx.chapterId));
}

export function ensureMediaDir(ctx: CacheCtx): string {
  const dir = mediaDir(ctx);
  if (persistMedia()) mkdirSync(dir, { recursive: true });
  return dir;
}

export function partPath(ctx: CacheCtx) {
  return join(mediaDir(ctx), "video.part");
}

export function videoPath(ctx: CacheCtx) {
  return join(mediaDir(ctx), "video");
}

/** Seekable remux of the cached source, one file per spoken language. */
export function playPath(ctx: CacheCtx, lang: string) {
  return join(mediaDir(ctx), `play-${lang}.mp4`);
}

function picksPath(via: string, mediaId: number) {
  return join(animeDir(via, mediaId), "picks.json");
}

function readPicks(via: string, mediaId: number): PicksFile {
  if (!persistMedia()) return {};
  try {
    return JSON.parse(readFileSync(picksPath(via, mediaId), "utf8")) as PicksFile;
  } catch {
    return {};
  }
}

function writePicks(via: string, mediaId: number, data: PicksFile) {
  if (!persistMedia()) return;
  mkdirSync(animeDir(via, mediaId), { recursive: true });
  writeFileSync(picksPath(via, mediaId), JSON.stringify(data, null, 2));
}

/**
 * The resolved playlist, on disk.
 *
 * Re-asking every addon costs up to half a minute and the in-process cache dies
 * with the dev server, so a restart used to make every episode cold again. This
 * also keeps the full quality/language menu on the warm path — the old fast path
 * returned only the one pick that had worked, which quietly removed the menu.
 */
function playlistPath(ctx: CacheCtx) {
  return join(mediaDir(ctx), "playlist.json");
}

export function savePlaylist(ctx: CacheCtx, pl: Playlist) {
  if (!persistMedia() || !pl.groups.length) return;
  try {
    ensureMediaDir(ctx);
    writeFileSync(playlistPath(ctx), JSON.stringify({ ...pl, v: RANK_VERSION }));
  } catch {
    /* a cache write must never fail a play */
  }
}

export function loadPlaylist(ctx: CacheCtx): Playlist | null {
  if (!persistMedia()) return null;
  try {
    const pl = JSON.parse(readFileSync(playlistPath(ctx), "utf8")) as Playlist & { v?: number };
    if (pl?.v !== RANK_VERSION) return null;
    return pl.groups?.length ? pl : null;
  } catch {
    return null;
  }
}

/*
 * A completed file never changes, so a hit is memoised for the process; a miss
 * is re-checked every few seconds because a download can finish mid-playback.
 * Without this every byte-range request re-read picks.json and walked the
 * torrent store — hundreds of sync filesystem passes per episode.
 */
const stats = new Map<string, { at: number; hit: { path: string; size: number } | null }>();
const MISS_TTL_MS = 5_000;

function statKey(ctx: CacheCtx) {
  return `${ctx.via}|${ctx.mediaId}|${chapterSlug(ctx.chapterId)}`;
}

function forget(ctx: CacheCtx) {
  stats.delete(statKey(ctx));
}

/**
 * The on-disk copy of this episode, or null.
 *
 * `video` exists only when something wrote it byte-complete. Serving a partial
 * file with its own length as content-length is worse than not caching at all:
 * the player believes the episode is three minutes long, forever.
 */
export function cachedFileStat(ctx: CacheCtx) {
  if (!persistMedia()) return null;
  const key = statKey(ctx);
  const memo = stats.get(key);
  if (memo && (memo.hit || Date.now() - memo.at < MISS_TTL_MS)) return memo.hit;
  const path = videoPath(ctx);
  const hit = existsSync(path) ? { path, size: statSync(path).size } : null;
  stats.set(key, { at: Date.now(), hit });
  return hit;
}

export function hasVideo(ctx: CacheCtx): boolean {
  return cachedFileStat(ctx) != null;
}

export const hasLocalVideo = hasVideo;

export function discardPart(ctx: CacheCtx) {
  if (!persistMedia()) return;
  try {
    if (existsSync(partPath(ctx))) unlinkSync(partPath(ctx));
  } catch {
    /* gone */
  }
}

/** Promote a mirrored download only when its size matches what upstream promised. */
export function promotePart(ctx: CacheCtx, expected: number | null) {
  if (!persistMedia()) return;
  const part = partPath(ctx);
  if (!existsSync(part)) return;
  if (expected == null || statSync(part).size !== expected) {
    discardPart(ctx);
    return;
  }
  const video = videoPath(ctx);
  if (existsSync(video)) unlinkSync(video);
  renameSync(part, video);
  forget(ctx);
}

/** Adopt a torrent file that has finished downloading, so a rewatch needs no peers. */
export function adoptCompleted(ctx: CacheCtx, src: string, replace = false) {
  if (!persistMedia()) return;
  const video = videoPath(ctx);
  if ((!replace && existsSync(video)) || !existsSync(src)) return;
  try {
    ensureMediaDir(ctx);
    const next = `${video}.next`;
    const old = `${video}.old`;
    if (existsSync(next)) unlinkSync(next);
    if (existsSync(old)) unlinkSync(old);
    linkSync(src, next);
    if (existsSync(video)) renameSync(video, old);
    try {
      renameSync(next, video);
      if (existsSync(old)) unlinkSync(old);
    } catch (error) {
      if (existsSync(old) && !existsSync(video)) renameSync(old, video);
      throw error;
    }
    forget(ctx);
  } catch {
    /* different volume — WebTorrent still has it, and the store is kept */
  }
}

export function getCachedPick(
  via: string,
  mediaId: number,
  chapterId: string,
  lang?: Lang,
  groupId?: string | null,
): CachedPick | null {
  const stored = readPicks(via, mediaId)[chapterSlug(chapterId)];
  if (!stored) return null;
  // A pick chosen by superseded rules is a wrong episode, not a stale menu.
  const chapter = Object.fromEntries(
    Object.entries(stored).filter(([, p]) => p.v === RANK_VERSION),
  );
  if (!Object.keys(chapter).length) return null;
  if (groupId && chapter[groupId]) return chapter[groupId];
  if (lang) {
    const hit = Object.entries(chapter).find(([id]) => id.endsWith(`-${lang}`));
    if (hit) return hit[1];
  }
  return Object.values(chapter).sort((a, b) => b.committedAt - a.committedAt)[0] ?? null;
}

function relayUrl(entry: Pick<CachedPick, "kind" | "ih" | "fileIdx" | "s" | "e" | "httpUrl" | "referer" | "url">) {
  if (entry.kind === "torrent" && entry.ih) {
    const params = new URLSearchParams({ ih: entry.ih });
    if (entry.fileIdx != null) params.set("i", String(entry.fileIdx));
    if (entry.s != null && Number.isFinite(entry.s) && entry.s > 0) params.set("s", String(entry.s));
    if (entry.e != null && Number.isFinite(entry.e) && entry.e > 0) params.set("e", String(entry.e));
    return `/api/stream?${params}`;
  }
  if (entry.kind === "http" && entry.httpUrl) {
    const params = new URLSearchParams({ url: entry.httpUrl });
    if (entry.referer) params.set("referer", entry.referer);
    return `/api/stream?${params}`;
  }
  return entry.url;
}

function pickFromStreamPick(groupId: string, pick: StreamPick): CachedPick {
  const u = new URL(pick.url, "http://lacrima.local");
  const ihs = u.searchParams.getAll("ih");
  const kind = ihs.length || u.searchParams.has("ih") ? "torrent" : "http";
  const entry: CachedPick = {
    groupId,
    url: pick.url,
    provider: pick.provider,
    hint: pick.hint,
    subtitles: pick.subtitles,
    kind,
    committedAt: Date.now(),
    v: RANK_VERSION,
  };
  if (kind === "torrent") {
    entry.ih = ihs[0] ?? u.searchParams.get("ih") ?? undefined;
    const i = u.searchParams.getAll("i")[0] ?? u.searchParams.get("i");
    entry.fileIdx = i != null && i !== "" ? Number(i) : null;
    const s = Number(u.searchParams.get("s"));
    const e = Number(u.searchParams.get("e"));
    if (Number.isFinite(s) && s > 0) entry.s = s;
    if (Number.isFinite(e) && e > 0) entry.e = e;
  } else {
    entry.httpUrl = u.searchParams.get("url") ?? undefined;
    entry.referer = u.searchParams.get("referer");
  }
  entry.url = relayUrl(entry);
  return entry;
}

export function commitPick(ctx: CacheCtx, groupId: string, pick: StreamPick): CachedPick {
  const slug = chapterSlug(ctx.chapterId);
  const picks = readPicks(ctx.via, ctx.mediaId);
  const entry = pickFromStreamPick(groupId, pick);
  /* Only that this pick worked is known here — not that the bytes are all on disk.
     Promotion to a served file happens where the transfer actually completes. */
  if (entry.ih) finalizeRacePoolsForStore(torrentStore(ctx.via, ctx.mediaId), entry.ih);
  if (!picks[slug]) picks[slug] = {};
  picks[slug][groupId] = entry;
  writePicks(ctx.via, ctx.mediaId, picks);
  return entry;
}

function parseGroupId(id: string): { quality: Quality; lang: Lang } {
  const i = id.lastIndexOf("-");
  if (i < 0) return { quality: "1080p", lang: "ja" };
  return { quality: id.slice(0, i) as Quality, lang: id.slice(i + 1) as Lang };
}

export function pickToStreamPick(entry: CachedPick): StreamPick {
  return { url: relayUrl(entry), provider: entry.provider, hint: entry.hint, subtitles: entry.subtitles };
}

/** Reorder picks so a previously confirmed stream is tried first. */
export function boostPlaylist(pl: Playlist, cached: CachedPick | null): Playlist {
  if (!cached) return pl;
  let touched = false;
  const groups = pl.groups.map((g): StreamGroup => {
    if (g.id !== cached.groupId) return g;
    const idx = g.picks.findIndex((p) => p.url === cached.url);
    if (idx <= 0) return g;
    const picks = [...g.picks];
    const [winner] = picks.splice(idx, 1);
    picks.unshift(winner);
    touched = true;
    return { ...g, picks };
  });
  return {
    groups,
    preferred: touched || pl.preferred === cached.groupId ? cached.groupId : pl.preferred,
  };
}

/** Last resort: a confirmed pick with no stored playlist behind it. */
export function fastPlaylist(entry: CachedPick): Playlist {
  const { quality, lang } = parseGroupId(entry.groupId);
  const labels: Record<string, string> = {
    ja: "Japanese",
    en: "English",
    hi: "Hindi",
    it: "Italian",
  };
  return {
    groups: [
      {
        id: entry.groupId,
        quality,
        lang,
        label: `${quality} · ${labels[lang] ?? lang}`,
        picks: [pickToStreamPick(entry)],
      },
    ],
    preferred: entry.groupId,
  };
}

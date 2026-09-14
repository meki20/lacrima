import type { Anchor } from "./db.ts";
import type { MediaKind, ProviderSlug } from "./media.ts";

/** Serializable progress payload passed from a server page into client readers. */
export type ProgressWrite = {
  via: ProviderSlug;
  mediaId: number;
  kind: MediaKind;
  title: string;
  cover: string | null;
  unit: number;
  chapterId: string | number;
  chapterName: string;
  season?: number | null;
  durationSeconds?: number | null;
  pages?: number | null;
  /** Display episode number. `unit` is the 1-based list index, same as manga. */
  episode?: number;
  /** Seconds of actual playback/reading since the last write. Capped server-side. */
  watchedDelta?: number;
  /** Title-list jump: credit full runtime for every episode before this one. */
  skipAhead?: boolean;
  /** Set unit exactly, even if lower. Used by "mark as watched/read up to here". */
  exact?: boolean;
  seriesParts?: SeriesPartMark[];
  partIndex?: number;
};

export type SeriesPartMark = {
  mediaId: number;
  title: string;
  cover: string | null;
  units: number;
};

/** Heartbeat writes stay on the current title. Tree walks only on jump/mark. */
export function usesSeriesTree(p: {
  skipAhead?: boolean;
  exact?: boolean;
  partIndex?: number;
  seriesParts?: { mediaId: number }[];
}): boolean {
  if (!p.skipAhead && !p.exact) return false;
  const parts = p.seriesParts?.filter((x) => x.mediaId > 0) ?? [];
  const idx = p.partIndex;
  return parts.length > 0 && idx != null && idx >= 0 && idx < parts.length;
}

export type AwardedSticker = {
  id: string;
  name: string;
  src: string | null;
  secret: boolean;
};

/** Farthest unit reached. Going back to reread/rewatch must not un-earn stickers. */
export function heldUnit(_kind: MediaKind, prev: number, next: number): number {
  return Math.max(prev, next);
}

/** Assumed episode length when the title has no runtime — skip-ahead still counts. */
export const ANIME_EPISODE_SECONDS = 24 * 60;

/** Episodes completed by jumping from `prev` to `next` (1-based list index). */
export function skipWatchSeconds(prevUnit: number, nextUnit: number, episodeSeconds: number): number {
  const prev = Math.max(0, Math.floor(prevUnit));
  const next = Math.max(0, Math.floor(nextUnit));
  const n = Math.max(0, Math.min(2000, next - Math.max(prev, 1)));
  const ep = Math.max(0, Math.min(3 * 3600, Math.floor(episodeSeconds)));
  if (!n || !ep) return 0;
  return n * ep;
}

/** Inclusive span |b - a| episodes, for "up to here" including the marked one. */
export function spanWatchSeconds(a: number, b: number, episodeSeconds: number): number {
  const lo = Math.max(0, Math.floor(Math.min(a, b)));
  const hi = Math.max(0, Math.floor(Math.max(a, b)));
  const n = Math.max(0, Math.min(2000, hi - lo));
  const ep = Math.max(0, Math.min(3 * 3600, Math.floor(episodeSeconds)));
  if (!n || !ep) return 0;
  return n * ep;
}

/** Current chapter stays bright; everything at or before `unit` is dim. */
export function isChapterRead(index: number, currentIndex: number, unit: number): boolean {
  if (index === currentIndex) return false;
  return index + 1 <= unit;
}

export function holdStickerToasts(pathname: string): boolean {
  return /\/read\/[^/]+\/anime(?:\/|$)/.test(pathname);
}

const TOAST_KEY = "lacrima.stickerToasts";
const TOAST_EVENT = "lacrima:stickers";

export function queueStickers(items: AwardedSticker[]) {
  if (typeof window === "undefined" || !items.length) return;
  const q = [...readToasts(), ...items];
  sessionStorage.setItem(TOAST_KEY, JSON.stringify(q));
  window.dispatchEvent(new Event(TOAST_EVENT));
}

export function takeStickers(): AwardedSticker[] {
  if (typeof window === "undefined") return [];
  const q = readToasts();
  sessionStorage.removeItem(TOAST_KEY);
  return q;
}

export function onStickerQueue(fn: () => void): () => void {
  window.addEventListener(TOAST_EVENT, fn);
  return () => window.removeEventListener(TOAST_EVENT, fn);
}

function readToasts(): AwardedSticker[] {
  try {
    const raw = sessionStorage.getItem(TOAST_KEY);
    return raw ? (JSON.parse(raw) as AwardedSticker[]) : [];
  } catch {
    return [];
  }
}

function chapterAnchor(p: ProgressWrite): Anchor {
  if (p.kind === "novel") {
    return {
      kind: "paragraph",
      cfi: "0",
      chapterId: p.chapterId,
      chapterName: p.chapterName,
    };
  }
  if (p.kind === "anime") {
    return {
      kind: "seconds",
      at: 0,
      chapterId: String(p.chapterId),
      chapterName: p.chapterName,
      ...(p.durationSeconds && p.durationSeconds > 1 ? { duration: p.durationSeconds } : {}),
      ...(p.season != null && p.season > 0 ? { season: p.season } : {}),
      ...(p.episode != null && p.episode > 0 ? { episode: p.episode } : {}),
    };
  }
  return {
    kind: "page",
    index: 0,
    chapterId: p.chapterId,
    chapterName: p.chapterName,
    ...(p.pages && p.pages > 0 ? { pages: p.pages } : {}),
  };
}

/** Fire-and-forget: must never block a page turn unless the caller awaits. */
export function pushProgress(p: ProgressWrite & { anchor?: Anchor }) {
  const body = { ...p, anchor: p.anchor ?? chapterAnchor(p) };
  return fetch("/api/progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  })
    .then((r) => r.json() as Promise<{ stickers?: AwardedSticker[] }>)
    .then((j) => {
      if (j.stickers?.length) queueStickers(j.stickers);
    })
    .catch(() => {});
}

export function peekStickers(): AwardedSticker[] {
  return readToasts();
}

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseLangToken } from "./audio.ts";
import {
  cachedFileStat,
  getCachedPick,
  torrentStore,
  type CacheCtx,
} from "./play-cache.ts";
import { FFMPEG, probeSubtitleTracks } from "./remux.ts";
import { subBodyPath } from "./sub-cache.ts";
import { cueLabel, fileHref, type SubCue } from "./subs.ts";
import {
  peekTorrentMedia,
  torrentRoot,
  type LiveTorrentMedia,
  type Slot,
} from "./torrent.ts";

const TEXT_SUBS = new Set(["ass", "ssa", "subrip", "webvtt", "mov_text", "text"]);
/** Headers land early; waiting for more than a thin slice just delays first cues. */
const MIN_PROGRESS = 0.002;
const inflight = new Map<string, Promise<EmbeddedResult>>();

export type EmbeddedHint = {
  ih?: string;
  fileIdx?: number | null;
  season?: number;
  episode?: number;
};

export type EmbeddedResult = { cues: SubCue[]; pending: boolean };

export type EmbeddedSource = {
  path: string;
  /** 0..1 of the selected file verified on disk. */
  progress: number;
  complete: boolean;
};

/** 5% steps so a growing extract refreshes the player without thrashing ffmpeg. */
export function progressBucket(progress: number, complete: boolean): string {
  if (complete || progress >= 1) return "full";
  return String(Math.min(19, Math.floor(Math.max(0, progress) * 20)));
}

export function embeddedCueUrl(trackIndex: number, bucket: string): string {
  return `embedded:${bucket}:${trackIndex}.srt`;
}

function slotOf(hint?: EmbeddedHint): Slot | undefined {
  if (hint?.episode != null && hint.episode > 0) {
    return { season: Math.max(hint.season ?? 1, 1), episode: hint.episode };
  }
  return undefined;
}

function fromLive(live: LiveTorrentMedia): EmbeddedSource | null {
  if (!live.done && live.progress < MIN_PROGRESS) return null;
  return { path: live.path, progress: live.progress, complete: live.done };
}

function peekStores(
  ih: string,
  fileIdx: number | null,
  want: Slot | undefined,
  ctx: CacheCtx,
): LiveTorrentMedia | null {
  const stores = [torrentStore(ctx.via, ctx.mediaId), torrentRoot()];
  for (const store of stores) {
    const hit = peekTorrentMedia(ih, fileIdx, want, store);
    if (hit) return hit;
  }
  return null;
}

/** Completed chapter cache, else the live torrent file playback is already using. */
export function embeddedSource(ctx: CacheCtx, hint?: EmbeddedHint): EmbeddedSource | null {
  const hit = cachedFileStat(ctx);
  if (hit) return { path: hit.path, progress: 1, complete: true };

  const want = slotOf(hint);
  if (hint?.ih) {
    const live = peekStores(hint.ih, hint.fileIdx ?? null, want, ctx);
    const src = live ? fromLive(live) : null;
    if (src) return src;
  }

  const pick = getCachedPick(ctx.via, ctx.mediaId, ctx.chapterId);
  if (pick?.kind === "torrent" && pick.ih) {
    const pickedWant =
      pick.s != null && pick.e != null ? { season: pick.s, episode: pick.e } : want;
    const live = peekStores(pick.ih, pick.fileIdx ?? null, pickedWant, ctx);
    const src = live ? fromLive(live) : null;
    if (src) return src;
  }
  return null;
}

function extractArgs(src: string, index: number, dest: string): string[] {
  return [
    "-y",
    "-v", "error",
    /* Partial torrent files are full-length with holes; keep whatever packets we can. */
    "-err_detect", "ignore_err",
    "-fflags", "+discardcorrupt",
    "-i", src,
    "-map", `0:${index}`,
    "-c:s", "srt",
    "-f", "srt",
    dest,
  ];
}

function extract(src: string, index: number, dest: string, force: boolean): Promise<boolean> {
  if (!force && existsSync(dest) && statSync(dest).size > 0) return Promise.resolve(true);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  rmSync(tmp, { force: true });
  const child = spawn(FFMPEG, extractArgs(src, index, tmp), { windowsHide: true });
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ok && existsSync(tmp) && statSync(tmp).size > 0) renameSync(tmp, dest);
      else rmSync(tmp, { force: true });
      resolve(ok && existsSync(dest));
    };
    const timer = setTimeout(() => {
      child.kill();
      /* A killed partial still often has early cues — keep them. */
      finish(existsSync(tmp) && statSync(tmp).size > 0);
    }, 30_000);
    child.on("error", () => finish(false));
    child.on("close", () => {
      /* ignore_err can exit non-zero after writing useful early packets. */
      finish(existsSync(tmp) && statSync(tmp).size > 0);
    });
  });
}

/**
 * Softsubs from the episode file — including a still-downloading torrent.
 *
 * Early Matroska clusters carry the track header and the first dialogue packets,
 * so a partial extract is enough to caption the minutes already on disk. Later
 * polls refresh with a higher progress bucket until the file is complete.
 */
export async function embeddedSubtitles(
  ctx: CacheCtx,
  hint?: EmbeddedHint,
): Promise<SubCue[]> {
  return (await embeddedSubtitlesDetailed(ctx, hint)).cues;
}

export async function embeddedSubtitlesDetailed(
  ctx: CacheCtx,
  hint?: EmbeddedHint,
): Promise<EmbeddedResult> {
  const src = embeddedSource(ctx, hint);
  if (!src) return { cues: [], pending: Boolean(hint?.ih) };
  const bucket = progressBucket(src.progress, src.complete);
  const key = `${src.path}:${bucket}`;
  const running = inflight.get(key);
  if (running) return running;
  const run = (async (): Promise<EmbeddedResult> => {
    const tracks = await probeSubtitleTracks(src.path);
    const cues: SubCue[] = [];
    const force = !src.complete;
    for (const track of tracks) {
      if (!TEXT_SUBS.has(track.codec)) continue;
      const lang = parseLangToken(track.language) ?? parseLangToken(track.title);
      if (!lang) continue;
      const url = embeddedCueUrl(track.index, bucket);
      const dest = subBodyPath(ctx, url);
      if (!(await extract(src.path, track.index, dest, force))) continue;
      const extra = track.title
        ? `Embedded · ${track.title}`
        : src.complete
          ? "Embedded"
          : "Embedded · downloading";
      cues.push({
        id: `embedded:${track.index}:${lang}`,
        lang,
        label: cueLabel(lang, extra),
        url,
        src: fileHref(url, ctx),
        type: "srt",
      });
    }
    return { cues, pending: !src.complete };
  })().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

/** Test helper — keep extract flags in one place. */
export function embeddedExtractArgsForTest(src: string, index: number): string[] {
  return extractArgs(src, index, join(".", "out.srt"));
}

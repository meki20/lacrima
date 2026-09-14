import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { parseLangToken } from "./audio.ts";
import { cachedFileStat, type CacheCtx } from "./play-cache.ts";
import { FFMPEG, probeSubtitleTracks } from "./remux.ts";
import { subBodyPath } from "./sub-cache.ts";
import { cueLabel, fileHref, type SubCue } from "./subs.ts";

const TEXT_SUBS = new Set(["ass", "ssa", "subrip", "webvtt", "mov_text", "text"]);
const inflight = new Map<string, Promise<SubCue[]>>();

function extract(src: string, index: number, dest: string): Promise<boolean> {
  if (existsSync(dest) && statSync(dest).size > 0) return Promise.resolve(true);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  rmSync(tmp, { force: true });
  const child = spawn(
    FFMPEG,
    ["-y", "-v", "error", "-i", src, "-map", `0:${index}`, "-c:s", "srt", "-f", "srt", tmp],
    { windowsHide: true },
  );
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
      finish(false);
    }, 30_000);
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

/** Extract browser-readable text subtitles from the completed episode cache. */
export async function embeddedSubtitles(ctx: CacheCtx): Promise<SubCue[]> {
  const hit = cachedFileStat(ctx);
  if (!hit) return [];
  const stat = statSync(hit.path);
  const key = `${hit.path}:${stat.size}:${stat.mtimeMs}`;
  const running = inflight.get(key);
  if (running) return running;
  const run = (async () => {
    const tracks = await probeSubtitleTracks(hit.path);
    const cues: SubCue[] = [];
    for (const track of tracks) {
      if (!TEXT_SUBS.has(track.codec)) continue;
      const lang = parseLangToken(track.language) ?? parseLangToken(track.title);
      if (!lang) continue;
      const url = `embedded:${stat.size}:${Math.round(stat.mtimeMs)}:${track.index}.srt`;
      const dest = subBodyPath(ctx, url);
      if (!(await extract(hit.path, track.index, dest))) continue;
      const extra = track.title ? `Embedded · ${track.title}` : "Embedded";
      cues.push({
        id: `embedded:${track.index}:${lang}`,
        lang,
        label: cueLabel(lang, extra),
        url,
        src: fileHref(url, ctx),
        type: "srt",
      });
    }
    return cues;
  })().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

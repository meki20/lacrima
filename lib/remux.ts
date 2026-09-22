/**
 * Choosing an audio track, because the browser cannot.
 *
 * Chrome exposes no `HTMLMediaElement.audioTracks` — measured, it is `undefined` —
 * so a file plays whichever audio track comes first and there is no API to switch.
 * Sources ship exactly that: one One-Punch Man file carries `hin`, `eng` and `jpn`,
 * Hindi first, so asking for Japanese played Hindi and asking for English played
 * Hindi too. The Japanese and English audio were always there, one `-map` away.
 *
 * Everything goes through here, not just multi-audio files, because the same pass
 * also fixes audio the browser refuses outright — DDP, AC3, DTS, TrueHD — which
 * `browserPlayable` used to reject on sight, throwing away most of the best
 * releases. Video normally stays a stream copy. Android can explicitly request a
 * baseline-compatible H.264 output after its decoder rejects a source codec or
 * profile; that keeps the broad source pool usable without taxing normal playback.
 */
import { spawn } from "node:child_process";
import type { Lang } from "./audio.ts";

export const FFMPEG = process.env.LACRIMA_FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.LACRIMA_FFPROBE ?? "ffprobe";
const H264_ENCODER = process.env.LACRIMA_H264_ENCODER === "h264_nvenc" ? "h264_nvenc" : "libx264";

/**
 * ffmpeg talks to this same process one layer down. Behind Caddy the request URL
 * is `https://0.0.0.0:3000/...` — TLS against a plain HTTP port, which surfaces
 * as `wrong version number` and a 502 the player reports as IO_BAD_HTTP_STATUS.
 */
export function selfRelayUrl(url: URL | string): string {
  const u = new URL(typeof url === "string" ? url : url.toString());
  u.protocol = "http:";
  u.hostname = "127.0.0.1";
  u.port = process.env.PORT?.trim() || "3000";
  u.username = "";
  u.password = "";
  return u.toString();
}
/**
 * `-ss` goes before `-i` so ffmpeg seeks by keyframe index instead of decoding up
 * to the point, which is the difference between a seek and a wait.
 *
 * The output is fragmented MP4 so it can start before the input is finished —
 * `empty_moov` writes a header with no duration, `frag_keyframe` flushes at every
 * keyframe, and `default_base_moof` keeps byte offsets relative so a stream that
 * began mid-file is still valid.
 */
/** ISO-639-2 codes ffmpeg matches on, for the languages we offer. */
const ISO3: Record<Lang, string> = {
  ja: "jpn",
  en: "eng",
  it: "ita",
  de: "deu",
  fr: "fra",
  es: "spa",
  pt: "por",
  hi: "hin",
  ko: "kor",
  zh: "zho",
  ru: "rus",
};

export function remuxArgs(
  url: string,
  opts: {
    lang?: Lang;
    audioIndex?: number;
    copyAudio?: boolean;
    seek?: number;
    referer?: string | null;
    pack?: "mp4" | "ts";
    transcodeVideo?: boolean;
  },
): string[] {
  const http = /^https?:\/\//i.test(url);
  const seeking = (opts.seek ?? 0) > 0;
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    ...(opts.referer && http ? ["-headers", `Referer: ${opts.referer}\r\n`] : []),
    ...(http
      ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
      : []),
  ];
  if (seeking) args.push("-ss", String(opts.seek));
  args.push("-i", url, "-map", "0:v:0");

  const iso = opts.lang ? ISO3[opts.lang] : null;
  if (opts.audioIndex != null) args.push("-map", `0:${opts.audioIndex}`);
  else if (iso) args.push("-map", `0:a:m:language:${iso}`);
  else args.push("-map", "0:a:0?");

  /* Input -ss lands on a preceding keyframe. Stream-copy keeps those video
     frames while re-encoded audio starts at the requested time, so resumed
     playback is visibly out of sync. Decode a resumed video, or one an Android
     decoder has rejected, to broadly-supported 8-bit H.264. */
  if (seeking || opts.transcodeVideo) {
    if (H264_ENCODER === "h264_nvenc") {
      args.push("-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "23", "-b:v", "0");
    } else {
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", seeking ? "18" : "20");
    }
    args.push("-pix_fmt", "yuv420p", "-profile:v", "high");
  } else args.push("-c:v", "copy");
  /* A seek must rebuild the audio timeline too. Copying AAC here preserves its
     old timestamps, leaving the new zero-based video silent after a restart. */
  if (opts.copyAudio && !seeking) {
    args.push("-c:a", "copy");
  } else {
    args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");
  }
  args.push(
    "-disposition:a:0", "default",
    /* Let ffmpeg start the new MP4 timeline at zero. Passing source timestamps
       through (`-copyts`) made some MKV video tracks retain their offset while
       the selected audio was encoded onto the new timeline. */
    "-muxdelay", "0",
    "-muxpreload", "0",
  );
  if (opts.pack === "ts") {
    /* Native players ingest a live MPEG-TS pipe. MSE on the web needs fMP4. */
    args.push("-f", "mpegts", "pipe:1");
  } else {
    args.push(
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-f", "mp4",
      "pipe:1",
    );
  }
  return args;
}

function mapAudio(opts: { lang?: Lang; audioIndex?: number }): string[] {
  const iso = opts.lang ? ISO3[opts.lang] : null;
  if (opts.audioIndex != null) return ["-map", `0:${opts.audioIndex}`];
  if (iso) return ["-map", `0:a:m:language:${iso}`];
  return ["-map", "0:a:0?"];
}

/** Write a real MP4 to disk so the browser can pause and seek in its own buffer. */
export function playFileArgs(
  src: string,
  dest: string,
  opts: { lang?: Lang; audioIndex?: number; copyAudio?: boolean },
): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-i", src,
    "-map", "0:v:0",
    ...mapAudio(opts),
    "-c:v", "copy",
    ...(opts.copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k", "-ac", "2"]),
    "-movflags", "+faststart",
    dest,
  ];
}

export type SubtitleTrack = {
  index: number;
  codec: string;
  language?: string;
  title?: string;
};

export function subtitleTracksFromProbe(raw: string): SubtitleTrack[] {
  try {
    const streams = (JSON.parse(raw) as {
      streams?: {
        index?: unknown;
        codec_type?: string;
        codec_name?: string;
        tags?: { language?: string; title?: string };
      }[];
    }).streams ?? [];
    return streams
      .filter((s) => s.codec_type === "subtitle" && typeof s.index === "number")
      .map((s) => ({
        index: s.index as number,
        codec: s.codec_name ?? "",
        language: s.tags?.language,
        title: s.tags?.title,
      }));
  } catch {
    return [];
  }
}

/** Text tracks inside a stable media file. Image subtitles are filtered by the caller. */
export function probeSubtitleTracks(
  url: string,
  referer?: string | null,
  signal?: AbortSignal,
): Promise<SubtitleTrack[]> {
  const http = /^https?:\/\//i.test(url);
  const child = spawn(
    /* turbopackIgnore: true */ FFPROBE,
    [
      "-v", "error",
      ...(referer && http ? ["-headers", `Referer: ${referer}\r\n`] : []),
      "-show_entries", "stream=index,codec_type,codec_name:stream_tags=language,title",
      "-of", "json",
      url,
    ],
    { windowsHide: true },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout = (stdout + chunk).slice(-64_000);
  });
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: SubtitleTrack[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const abort = () => {
      child.kill();
      finish([]);
    };
    const timer = setTimeout(abort, 10_000);
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () => finish([]));
    child.on("close", (code) => finish(code === 0 ? subtitleTracksFromProbe(stdout) : []));
  });
}

/** Select a stable source's requested track, accepting `und` only when it is alone. */
export function probeAudio(
  url: string,
  lang: Lang,
  referer?: string | null,
  signal?: AbortSignal,
): Promise<{ index: number; copyAudio: boolean } | null> {
  const http = /^https?:\/\//i.test(url);
  const child = spawn(
    /* turbopackIgnore: true */ FFPROBE,
    [
      "-v", "error",
      ...(referer && http ? ["-headers", `Referer: ${referer}\r\n`] : []),
      "-show_entries", "stream=index,codec_type,codec_name:stream_tags=language",
      "-of", "json",
      url,
    ],
    { windowsHide: true },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout = (stdout + chunk).slice(-64_000);
  });
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: { index: number; copyAudio: boolean } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const abort = () => {
      child.kill();
      finish(null);
    };
    const timer = setTimeout(abort, 10_000);
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (code !== 0) return finish(null);
      try {
        const streams = (JSON.parse(stdout) as {
          streams?: {
            index: number;
            codec_type?: string;
            codec_name?: string;
            tags?: { language?: string };
          }[];
        }).streams ?? [];
        const audio = streams.filter((s) => s.codec_type === "audio");
        const iso = ISO3[lang];
        const exact = audio.find((s) => s.tags?.language?.toLowerCase() === iso);
        const only = audio.length === 1 ? audio[0] : null;
        const tag = only?.tags?.language?.toLowerCase();
        const chosen = exact ?? (only && (!tag || tag === "und") ? only : null);
        if (!chosen) return finish(null);
        finish({
          index: chosen.index,
          copyAudio: chosen.codec_name === "aac",
        });
      } catch {
        finish(null);
      }
    });
  });
}

/**
 * A remuxed body, plus the process behind it.
 *
 * ffmpeg is killed when the client goes away — a player that seeks leaves the
 * previous position's process with nobody reading it, and those would otherwise
 * accumulate one per seek for as long as the episode lasts.
 */
export function remuxStream(
  url: string,
  opts: {
    lang?: Lang;
    audioIndex?: number;
    copyAudio?: boolean;
    seek?: number;
    referer?: string | null;
    pack?: "mp4" | "ts";
    transcodeVideo?: boolean;
  },
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const child = spawn(/* turbopackIgnore: true */ FFMPEG, remuxArgs(url, opts), { windowsHide: true });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4_096);
  });
  const stop = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  };
  signal?.addEventListener("abort", stop, { once: true });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let sent = false;
      let ended = false;
      const finish = (err?: Error) => {
        if (ended) return;
        ended = true;
        try {
          if (err) controller.error(err);
          else controller.close();
        } catch {
          /* consumer already gone */
        }
      };
      child.stdout.on("data", (c: Buffer) => {
        sent = true;
        try {
          controller.enqueue(new Uint8Array(c));
          /* ffmpeg happily outruns the player. Without pausing, a 1 GB episode is
             a 1 GB queue in the server's memory. */
          if ((controller.desiredSize ?? 0) <= 0) child.stdout.pause();
        } catch {
          stop();
        }
      });
      child.stdout.on("end", () => {
        if (sent) finish();
      });
      child.on("error", (err) => finish(new Error(`ffmpeg failed to start: ${err.message}`)));
      child.on("close", (code) => {
        if (sent) {
          finish();
          return;
        }
        const detail = stderr.trim() || `exit code ${code ?? "unknown"}`;
        console.warn(`[remux] ffmpeg produced no video: ${detail}`);
        finish(new Error(`ffmpeg produced no video: ${detail}`));
      });
    },
    pull() {
      child.stdout.resume();
    },
    cancel() {
      stop();
    },
  });
}

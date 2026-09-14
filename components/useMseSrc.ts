import { useEffect, useState } from "react";
import { scanRemuxClock, type RemuxClock } from "@/lib/fmp4";

const MIMES = [
  'video/mp4; codecs="avc1.640028,mp4a.40.2"',
  'video/mp4; codecs="avc1.64001F,mp4a.40.2"',
  'video/mp4; codecs="avc1.4D401F,mp4a.40.2"',
  'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4; codecs="hvc1.1.6.L123.B0,mp4a.40.2"',
];

/** Hold this much each side of the playhead so ±2 min seeks stay in-buffer. */
const AHEAD = 120;
const KEEP_BEHIND = 120;

export function mseSupported(): boolean {
  return pickMime() != null;
}

function pickMime(): string | null {
  if (typeof MediaSource === "undefined") return null;
  return MIMES.find((m) => MediaSource.isTypeSupported(m)) ?? null;
}

function updateEnd(sb: SourceBuffer) {
  return new Promise<void>((resolve, reject) => {
    const ok = () => {
      sb.removeEventListener("updateend", ok);
      sb.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      sb.removeEventListener("updateend", ok);
      sb.removeEventListener("error", fail);
      reject(new Error("source buffer error"));
    };
    sb.addEventListener("updateend", ok);
    sb.addEventListener("error", fail);
  });
}

function playhead(): number {
  return document.querySelector<HTMLVideoElement>(".player-root video")?.currentTime ?? 0;
}

function bufEnd(sb: SourceBuffer): number {
  return sb.buffered.length ? sb.buffered.end(sb.buffered.length - 1) : 0;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a);
  out.set(b, a.byteLength);
  return out;
}

/** SourceBuffer wants whole ISO-BMFF boxes, not fetch-sized slices. */
function takeBoxes(buf: Uint8Array): { ready: Uint8Array; rest: Uint8Array } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 0;
  while (offset + 8 <= buf.byteLength) {
    let size = view.getUint32(offset);
    if (size === 1) {
      if (offset + 16 > buf.byteLength) break;
      const big = view.getBigUint64(offset + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(big);
    } else if (size < 8) {
      break;
    }
    if (offset + size > buf.byteLength) break;
    offset += size;
  }
  return { ready: buf.subarray(0, offset), rest: buf.subarray(offset) };
}

async function append(sb: SourceBuffer, data: Uint8Array) {
  if (!data.byteLength) return;
  if (sb.updating) await updateEnd(sb);
  try {
    sb.appendBuffer(data.slice());
    await updateEnd(sb);
  } catch (e) {
    if (!(e instanceof DOMException) || e.name !== "QuotaExceededError") throw e;
    const t = playhead();
    if (!sb.buffered.length) throw e;
    sb.remove(0, Math.max(0, t - 5));
    await updateEnd(sb);
    sb.appendBuffer(data.slice());
    await updateEnd(sb);
  }
}

/**
 * Own the remux bytes so pause does not abort ffmpeg and a seek inside
 * what we already have is just `currentTime`.
 */
export function useMseSrc(remote: string | null): {
  url: string | null;
  failed: boolean;
  httpError: number | null;
  origin: number | null;
} {
  const [local, setLocal] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [httpError, setHttpError] = useState<{ remote: string; status: number } | null>(null);
  const [clock, setClock] = useState<{ remote: string; origin: number } | null>(null);

  useEffect(() => {
    if (!remote || !remote.includes("remux=1")) {
      setLocal(null);
      setFailed(false);
      setHttpError(null);
      return;
    }
    const mime = pickMime();
    if (!mime) {
      setLocal(null);
      setFailed(true);
      setHttpError(null);
      return;
    }

    const media = new MediaSource();
    const url = URL.createObjectURL(media);
    const ac = new AbortController();
    let sb: SourceBuffer | null = null;

    const open = async () => {
      try {
        sb = media.addSourceBuffer(mime);
        /* Sequence so playback still starts at 0. Cues use the first tfdt. */
        sb.mode = "sequence";
        const res = await fetch(remote, { signal: ac.signal });
        if (!res.ok || !res.body) {
          if (!res.ok) setHttpError({ remote, status: res.status });
          throw new Error(`remux ${res.status}`);
        }
        const reader = res.body.getReader();
        let pending: Uint8Array = new Uint8Array(0);
        let clock: RemuxClock = { timescale: null, origin: null };
        for (;;) {
          while (bufEnd(sb) - playhead() > AHEAD) {
            const t = playhead();
            if (t > KEEP_BEHIND && sb.buffered.length && sb.buffered.start(0) < t - KEEP_BEHIND) {
              sb.remove(0, t - KEEP_BEHIND + 5);
              await updateEnd(sb);
            }
            await new Promise((r) => setTimeout(r, 250));
            if (ac.signal.aborted) return;
          }
          const { done, value } = await reader.read();
          if (done) {
            await append(sb, takeBoxes(pending).ready);
            if (media.readyState === "open") media.endOfStream();
            return;
          }
          pending = concat(pending, value);
          const { ready, rest } = takeBoxes(pending);
          pending = rest.slice();
          if (clock.origin == null && ready.byteLength) {
            clock = scanRemuxClock(ready, clock);
            if (clock.origin != null) setClock({ remote, origin: clock.origin });
          }
          await append(sb, ready);
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        console.warn("[mse]", e);
        setFailed(true);
        setLocal(null);
      }
    };

    media.addEventListener("sourceopen", () => void open(), { once: true });
    setFailed(false);
    setHttpError(null);
    setLocal(url);
    return () => {
      ac.abort();
      try {
        if (sb && media.readyState === "open") media.removeSourceBuffer(sb);
      } catch {
        /* already torn down */
      }
      URL.revokeObjectURL(url);
    };
  }, [remote]);

  return {
    url: local,
    failed,
    httpError: httpError?.remote === remote ? httpError.status : null,
    origin: clock && remote && clock.remote === remote ? clock.origin : null,
  };
}

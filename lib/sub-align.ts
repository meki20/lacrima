/**
 * Checking subtitle files against the audio that is playing.
 *
 * An addon is asked for subtitles by episode, never by release, so it returns files
 * timed for whichever cut they were made against. Measured on one Death Note episode
 * the eight English files sat at -0.1, +1.0, +4.95 and (four of them) nowhere near
 * the audio; One Punch Man had one file 5 s off and four that matched nothing; the
 * only Love Game file was 21 s early. The player used to take the first by name.
 *
 * So each file is scored against the speech in the audio and the best one is used,
 * moved by the offset the audio says. The method is cross-correlation of "a cue is
 * on screen" with "something is being said", both with their slow trend removed:
 * without that, scene-level correlation made a 5 s error cost only 0.08 of r; with
 * it the peak stands out of the noise floor by ~14 sigma.
 *
 * Validated against a subtitle track embedded in the same file as the audio: it
 * measured +0.05 s.
 *
 * ponytail: one constant offset per file. Two halves of the same One Punch Man episode
 * agreed to 0.1 s for every file that matched, so frame-rate drift (a 25 fps file on
 * 23.976 video) has not shown up; if it does, scale cue times by 25/23.976 and search
 * that ratio too. Only web remuxes are tapped; Android's TS pipe is not.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TAP_RATE } from "./remux.ts";
import type { SubFit, TimedCue } from "./subs.ts";

const FRAME = 0.05;
const DETREND = 3;
/** Search +-90 s: the largest offset seen in the wild here was 21 s. */
const RANGE = 90;
/** Coarse lag step in frames (0.2 s); the winner is then refined at one frame. */
const COARSE = 4;
/** Seconds of audio before a verdict is worth giving. Three minutes agreed with nine in every title tried. */
export const MIN_AUDIO = 180;

/* Fewer cues than this in the window and a chance alignment can look like a match. A three-minute
   window held 50-90 in every title tried. */
const MIN_CUES = 20;

/* A file that is this episode's timeline measured r .25-.39 (peak 9-19 sigma above the noise);
   one that is not measured r <= .17. */
const MATCH_R = 0.2;
const MATCH_Z = 6;

export function tapPath(src: string): string {
  const u = new URL(src, "http://lacrima.local");
  const key = createHash("sha1").update(u.pathname + u.search).digest("hex").slice(0, 20);
  return join(tmpdir(), "lacrima-align", `${key}.s16`);
}

/** Fresh file for a new remux, or undefined if scratch space is unusable: a tap must never fail a play. */
export function prepareTap(src: string): string | undefined {
  const path = tapPath(src);
  const dir = join(path, "..");
  try {
    mkdirSync(dir, { recursive: true });
    /* One file per distinct URL, and every seek is a new URL. */
    for (const name of readdirSync(dir)) {
      const old = join(dir, name);
      if (Date.now() - statSync(old).mtimeMs > 2 * 3_600_000) rmSync(old, { force: true });
    }
    rmSync(path, { force: true });
    return path;
  } catch {
    return undefined;
  }
}

export function tapSeconds(path: string): number {
  try {
    return statSync(path).size / (TAP_RATE * 2);
  } catch {
    return 0;
  }
}

export function readTap(path: string): Buffer {
  return readFileSync(path);
}

function movingAverage(x: Float64Array, seconds: number): Float64Array {
  const half = Math.max(1, Math.round(seconds / FRAME / 2));
  const sum = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) sum[i + 1] = sum[i] + x[i];
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(x.length, i + half + 1);
    out[i] = (sum[hi] - sum[lo]) / (hi - lo);
  }
  return out;
}

function detrend(x: Float64Array): Float64Array {
  const trend = movingAverage(x, DETREND);
  return x.map((v, i) => v - trend[i]);
}

/** 50 ms speech-energy frames from s16le PCM: log energy, clipped so one explosion cannot dominate. */
export function envelope(pcm: Uint8Array): Float64Array {
  const per = Math.round(TAP_RATE * FRAME);
  const n = Math.floor(pcm.byteLength / 2 / per);
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const db = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < per; k++) {
      const v = view.getInt16((i * per + k) * 2, true) / 32768;
      s += v * v;
    }
    db[i] = Math.log10(Math.sqrt(s / per) + 1e-5);
  }
  const sorted = Float64Array.from(db).sort();
  const median = sorted[sorted.length >> 1];
  const spread = sorted[Math.floor(n * 0.9)] - sorted[Math.floor(n * 0.1)] || 1;
  return detrend(db.map((v) => Math.max(-1.5, Math.min(2, (v - median) / spread))));
}

function presence(cues: TimedCue[], n: number, origin: number): Float64Array {
  const s = new Float64Array(n);
  for (const c of cues) {
    const a = Math.max(0, Math.floor((c.start - origin) / FRAME));
    const b = Math.min(n, Math.ceil((c.end - origin) / FRAME));
    for (let i = a; i < b; i++) s[i] = 1;
  }
  return detrend(s);
}

/**
 * Where `cues` sit against the audio in `env`, which starts at episode time `origin`.
 * `shift` is what to add to cue times; `r` the correlation there; `z` how far that
 * peak stands above the correlation everywhere else.
 */
export function fitCues(
  env: Float64Array,
  cues: TimedCue[],
  origin = 0,
): { shift: number; r: number; z: number; matched: boolean } {
  const n = env.length;
  const inWindow = cues.filter((c) => c.end > origin && c.start < origin + n * FRAME).length;
  const s = presence(cues, n, origin);
  let vz = 0;
  let vs = 0;
  for (let i = 0; i < n; i++) {
    vz += env[i] * env[i];
    vs += s[i] * s[i];
  }
  const norm = Math.sqrt(vz * vs);
  if (!norm) return { shift: 0, r: 0, z: 0, matched: false };

  const corr = (lag: number) => {
    let acc = 0;
    for (let i = Math.max(0, lag); i < Math.min(n, n + lag); i++) acc += env[i] * s[i - lag];
    return acc / norm;
  };

  const max = Math.round(RANGE / FRAME);
  const coarse: [number, number][] = [];
  for (let lag = -max; lag <= max; lag += COARSE) coarse.push([lag, corr(lag)]);
  let [bestLag, best] = coarse.reduce((a, b) => (b[1] > a[1] ? b : a));
  for (let lag = bestLag - COARSE + 1; lag < bestLag + COARSE; lag++) {
    const v = corr(lag);
    if (v > best) [bestLag, best] = [lag, v];
  }

  const far = coarse.filter(([lag]) => Math.abs(lag - bestLag) * FRAME > 3).map(([, v]) => v);
  const mean = far.reduce((a, b) => a + b, 0) / far.length;
  const sd = Math.sqrt(far.reduce((a, b) => a + (b - mean) ** 2, 0) / far.length) || 1e-9;
  const z = (best - mean) / sd;
  return {
    shift: Math.round(bestLag * FRAME * 100) / 100,
    r: Math.round(best * 1000) / 1000,
    z: Math.round(z * 10) / 10,
    matched: inWindow >= MIN_CUES && best >= MATCH_R && z >= MATCH_Z,
  };
}

export function fitFile(id: string, env: Float64Array, cues: TimedCue[], origin: number): SubFit {
  const { shift, r, matched } = fitCues(env, cues, origin);
  return { id, shift, r, matched };
}

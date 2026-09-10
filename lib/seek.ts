/** Minimal TimeRanges so seek math is testable without a video element. */
export type TimeRangesLike = {
  length: number;
  start(index: number): number;
  end(index: number): number;
};

/** Seek inside a range, staying a hair before the end so we do not stall. */
export function clampBuffered(ranges: TimeRangesLike, time: number): number | null {
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (time >= start && time <= end) return Math.min(time, Math.max(start, end - 0.05));
  }
  return null;
}

export type SeekPlan =
  | { kind: "currentTime"; time: number }
  | { kind: "restart"; startAt: number };

/**
 * In-buffer remux seek is currentTime only. A restart (new ffmpeg / MediaSource)
 * is allowed only when the target is outside the buffer. Never clock this off a
 * measured keyframe — that misses the range and drops the buffer.
 */
export function planSeek(opts: {
  next: number;
  startAt: number;
  native: boolean;
  ranges: TimeRangesLike | null;
}): SeekPlan {
  const next = Math.max(0, opts.next);
  if (opts.native) return { kind: "currentTime", time: next };
  const rel = next - opts.startAt;
  const hit = opts.ranges && rel >= 0 ? clampBuffered(opts.ranges, rel) : null;
  if (hit != null) return { kind: "currentTime", time: hit };
  return { kind: "restart", startAt: next };
}

export function bufferedEnd(ranges: TimeRangesLike | null): number | null {
  if (!ranges || ranges.length === 0) return null;
  return ranges.end(ranges.length - 1);
}

export function scrubPercents(opts: {
  position: number;
  duration: number;
  startAt: number;
  native: boolean;
  bufferedEnd: number | null;
}): { played: number; buffered: number } {
  if (!(opts.duration > 0)) return { played: 0, buffered: 0 };
  const played = clamp01(opts.position / opts.duration);
  if (opts.bufferedEnd == null) return { played, buffered: played };
  const abs = opts.native ? opts.bufferedEnd : opts.startAt + opts.bufferedEnd;
  return { played, buffered: Math.max(played, clamp01(abs / opts.duration)) };
}

export function fmtClock(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtRemaining(duration: number, position: number): string {
  return `−${fmtClock(Math.max(0, duration - position))}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

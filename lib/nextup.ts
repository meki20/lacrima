/** Credits window before autoplay. Short enough to feel like TV, long enough to cancel. */
export const NEXT_UP_SECONDS = 15;

/**
 * Seconds left on the next-episode countdown, or null when the overlay stays hidden.
 * Failed remuxes end the media element too — `watchedSeconds` and a real duration
 * are what keep those from looking like "episode finished".
 */
export function nextUpCountdown(opts: {
  position: number;
  duration: number | null;
  ended: boolean;
  watchedSeconds: number;
  cancelled: boolean;
  hasNext: boolean;
}): number | null {
  if (!opts.hasNext || opts.cancelled || opts.watchedSeconds < 30) return null;
  if (opts.ended) return 0;
  if (opts.duration == null || opts.duration < 90) return null;
  const left = opts.duration - opts.position;
  if (left > NEXT_UP_SECONDS || left < 0) return null;
  return Math.max(1, Math.ceil(left));
}

/** `"off"` ↔ last chosen cue. Same key Netflix binds to C. */
export function toggleSubChoice(current: string, lastCueId: string | null): string {
  if (current !== "off") return "off";
  return lastCueId || "off";
}

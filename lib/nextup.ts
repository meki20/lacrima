/** Keep this window for validating a real media end; never use catalog runtime as a trigger. */
export const NEXT_UP_SECONDS = 15;

/**
 * Zero after a credible media end, or null when the overlay stays hidden.
 * Catalog runtimes are estimates, so using one to open this during playback can
 * interrupt a longer episode. A failed remux must also not look finished.
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
  if (opts.duration == null || opts.duration < 90) return null;
  if (!opts.ended || opts.position < opts.duration - NEXT_UP_SECONDS) return null;
  return 0;
}

/** `"off"` ↔ last chosen cue. Same key Netflix binds to C. */
export function toggleSubChoice(current: string, lastCueId: string | null): string {
  if (current !== "off") return "off";
  return lastCueId || "off";
}

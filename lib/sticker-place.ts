/** Page stickers. Safe for client import — no sqlite. */

export const SCALE_MIN = 0.35;
export const SCALE_MAX = 2.5;
export const STICKER_SIZE = 96;
export const HOLD_MS = 400;

export function clampScale(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, n));
}

export function clampCoord(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function clampRot(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = n % 360;
  return r < 0 ? r + 360 : r;
}

/** Pathname only: drop query/hash, strip a trailing slash, reject junk. */
export function pagePath(raw: string): string {
  const p = raw.trim().split(/[?#]/)[0] || "/";
  if (!p.startsWith("/") || p.includes("..") || p.length > 400) return "";
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

export function placeBlocked(path: string): boolean {
  const p = pagePath(path);
  return !p || /^\/(stickers|sources|settings)(\/|$)/.test(p);
}

/** Stickers on the chrome follow the rail, not the route. */
export const CHROME = {
  sidebar: "/__chrome/sidebar",
  topbar: "/__chrome/topbar",
} as const;

export function chromeKind(path: string): "sidebar" | "topbar" | null {
  if (path === CHROME.sidebar) return "sidebar";
  if (path === CHROME.topbar) return "topbar";
  return null;
}

export type Surface = "desktop" | "mobile";

export function parseSurface(raw: string | null | undefined): Surface {
  return raw === "mobile" ? "mobile" : "desktop";
}

/** Matches the CSS rail breakpoint (`max-width: 900px`). */
export function surfaceForWidth(width: number): Surface {
  return width <= 900 ? "mobile" : "desktop";
}

/** Click position as a fraction of a chrome box, not the viewport. */
export function rectFrac(
  clientX: number,
  clientY: number,
  r: { left: number; top: number; width: number; height: number },
) {
  return {
    x: clampCoord((clientX - r.left) / (r.width || 1)),
    y: clampCoord((clientY - r.top) / (r.height || 1)),
  };
}

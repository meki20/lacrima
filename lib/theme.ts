export const ACCENTS = ["#630E19", "#e8c56b", "#8f151c", "#e5484d", "#46a758"] as const;

export function parseHex(raw: string | null | undefined): string | null {
  const s = raw?.trim() ?? "";
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
}

export function parseWallpaper(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s) return null;
  if (parseHex(s)) return s;
  if (/^https?:\/\//i.test(s)) return s.slice(0, 500);
  return null;
}

export function parseName(raw: string | null | undefined): string | null {
  const s = raw?.trim() ?? "";
  return s && s.length <= 24 ? s : null;
}

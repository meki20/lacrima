export type ReaderPrefs = {
  mode: "paged" | "webtoon";
  rtl: boolean;
  fit: "height" | "width" | "contain";
  spread: "single" | "double";
};

export const DEFAULT_READER: ReaderPrefs = {
  mode: "paged",
  rtl: true,
  fit: "height",
  spread: "single",
};

export type TapZone = "top" | "left" | "mid" | "right";

/** Coordinates are relative to the stage, not the viewport. */
export function tapZone(x: number, y: number, w: number, h: number): TapZone {
  if (h > 0 && y / h < 0.18) return "top";
  if (w <= 0) return "mid";
  const nx = x / w;
  if (nx < 0.33) return "left";
  if (nx > 0.67) return "right";
  return "mid";
}

export function parseReaderPrefs(raw: string | null | undefined): ReaderPrefs {
  try {
    const s = JSON.parse(raw || "{}") as Partial<ReaderPrefs>;
    return {
      mode: s.mode === "webtoon" ? "webtoon" : "paged",
      rtl: typeof s.rtl === "boolean" ? s.rtl : true,
      fit: s.fit === "width" || s.fit === "contain" ? s.fit : "height",
      spread: s.spread === "double" ? "double" : "single",
    };
  } catch {
    return { ...DEFAULT_READER };
  }
}

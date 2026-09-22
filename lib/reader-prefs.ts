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

export type NovelReaderPrefs = {
  mode: "paged" | "continuous";
  rtl: boolean;
  /** px, clamped 14–28 */
  fontSize: number;
};

export const DEFAULT_NOVEL_READER: NovelReaderPrefs = {
  mode: "continuous",
  rtl: false,
  fontSize: 18,
};

export type TapZone = "top" | "left" | "mid" | "right";

export function wheelZoom(current: number, deltaY: number): number {
  return Math.min(4, Math.max(1, current + (deltaY < 0 ? 0.25 : -0.25)));
}

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

export function clampNovelFontSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_NOVEL_READER.fontSize;
  return Math.min(28, Math.max(14, Math.round(n)));
}

export function parseNovelReaderPrefs(raw: string | null | undefined): NovelReaderPrefs {
  try {
    const s = JSON.parse(raw || "{}") as Partial<NovelReaderPrefs> & { mode?: string };
    return {
      mode: s.mode === "paged" ? "paged" : "continuous",
      rtl: typeof s.rtl === "boolean" ? s.rtl : false,
      fontSize: clampNovelFontSize(typeof s.fontSize === "number" ? s.fontSize : DEFAULT_NOVEL_READER.fontSize),
    };
  } catch {
    return { ...DEFAULT_NOVEL_READER };
  }
}

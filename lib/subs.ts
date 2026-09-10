import { LANGS, parseLangToken, type Lang } from "./audio.ts";

export type CueType = "vtt" | "srt" | "ass" | "ssa";

export type SubCue = {
  id: string;
  lang: Lang;
  label: string;
  url: string;
  src: string;
  type: CueType;
};

/** `"off"`, a cue `id`, or a legacy language id from an older save. */
export type SubChoice = string;

export function cueType(url: string): CueType {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".ass")) return "ass";
  if (path.endsWith(".ssa")) return "ssa";
  if (path.endsWith(".srt")) return "srt";
  return "vtt";
}

export function cueLabel(lang: Lang, extra?: string): string {
  const name = LANGS.find((l) => l.id === lang)?.label ?? lang;
  const note = extra?.trim();
  return note && note.toLowerCase() !== name.toLowerCase() ? `${name} · ${note}` : name;
}

export function fileHref(
  url: string,
  ctx?: { via: string; mediaId: number; chapterId: string },
): string {
  const q = new URLSearchParams({ url });
  if (ctx) {
    q.set("cv", ctx.via);
    q.set("cm", String(ctx.mediaId));
    q.set("cc", ctx.chapterId);
  }
  return `/api/subs/file?${q}`;
}

export type TimedCue = { start: number; end: number; text: string };

const CLOCK = /(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{2,3}/;
const PAIR = new RegExp(`(${CLOCK.source})\\s*-->\\s*(${CLOCK.source})`);

function clockToSec(raw: string): number {
  const norm = raw.replace(",", ".");
  const parts = norm.split(":");
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}

function cleanCueText(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .trim();
}

function parseBlocks(src: string): TimedCue[] {
  const out: TimedCue[] = [];
  for (const block of src.split(/\n\n+/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const m = PAIR.exec(lines[i]);
    if (!m) continue;
    const start = clockToSec(m[1]);
    const end = clockToSec(m[2]);
    const text = cleanCueText(lines.slice(i + 1).join("\n"));
    if (text && end > start) out.push({ start, end, text });
  }
  return out;
}

function parseAss(src: string): TimedCue[] {
  const out: TimedCue[] = [];
  for (const line of src.split("\n")) {
    if (!line.startsWith("Dialogue:")) continue;
    const parts = line.slice("Dialogue:".length).split(",");
    if (parts.length < 10) continue;
    const start = clockToSec(parts[1].trim());
    const end = clockToSec(parts[2].trim());
    const text = cleanCueText(parts.slice(9).join(","));
    if (text && end > start) out.push({ start, end, text });
  }
  return out;
}

/** Episode-time cues. The remux clock is not used — `cueAt` takes absolute time. */
export function parseCues(text: string): TimedCue[] {
  const src = text.replace(/^\uFEFF/, "").replace(/\r/g, "");
  return /^Dialogue:/m.test(src) ? parseAss(src) : parseBlocks(src);
}

/** A measured keyframe more than this far from `t` is a different clock. */
const ORIGIN_GOP = 20;

/**
 * Cue time for the frame on screen.
 *
 * Native files already clock in episode time. A remux pipe clocks from 0; use
 * the measured keyframe when we have one, otherwise `startAt + currentTime` so
 * a line still shows. Never feed this into seek — in-buffer seeks use `startAt`.
 */
export function remuxEpisodeTime(
  startAt: number,
  currentTime: number,
  native: boolean,
  origin?: number | null,
): number {
  if (native) return currentTime;
  const base =
    origin != null && origin >= 1 && Math.abs(origin - startAt) < ORIGIN_GOP ? origin : startAt;
  return Math.max(0, base + currentTime);
}

export function cueAt(cues: TimedCue[], at: number): TimedCue | null {
  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (at >= c.start && at < c.end) return c;
  }
  return null;
}

export function toCue(
  raw: {
    url?: string;
    lang?: string;
    language?: string;
    id?: string;
    label?: string;
    name?: string;
    filename?: string;
  },
  via?: string,
): SubCue | null {
  const lang = parseLangToken(raw.lang ?? raw.language);
  if (!lang || !raw.url?.startsWith("http")) return null;
  const rawId = raw.id?.trim() || raw.url;
  const id = via ? `${via}:${rawId}` : rawId;
  const bits = [via, raw.filename, raw.name, raw.label]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  const extra = bits
    .filter((s) => !/^(english|eng|en)$/i.test(s))
    .filter((s, i, all) => all.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
    .join(" · ");
  return {
    id,
    lang,
    label: cueLabel(lang, extra || undefined),
    url: raw.url,
    src: fileHref(raw.url),
    type: cueType(raw.url),
  };
}

/** Same URL once. Same language keeps several files so a bad clock can be swapped. */
export const CUES_PER_LANG = 8;

export function dedupeCues(cues: SubCue[]): SubCue[] {
  const seenUrl = new Set<string>();
  const perLang = new Map<Lang, number>();
  const out: SubCue[] = [];
  for (const c of cues) {
    if (seenUrl.has(c.url)) continue;
    const n = perLang.get(c.lang) ?? 0;
    if (n >= CUES_PER_LANG) continue;
    seenUrl.add(c.url);
    perLang.set(c.lang, n + 1);
    out.push(c);
  }
  out.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return out;
}

export const CAPTION_SCALES = [1, 1.2, 1.45] as const;

export function parseCaptionScale(raw: string | null | undefined): number {
  const n = Number(raw);
  if (n === 1.2 || n === 1.45) return n;
  return 1;
}

export function captionScaleLabel(scale: number): string {
  if (scale === 1.45) return "Large";
  if (scale === 1.2) return "Medium";
  return "Small";
}

export const SUB_SYNC_RANGE = 10;
export const SUB_SYNC_STEP = 0.25;

export function subSyncKey(via: string, mediaId: number | string, chapterId: string): string {
  return `lacrima-sub-sync:${via}:${mediaId}:${chapterId}`;
}

/** Extra delay in seconds. Positive shows cues later. Clamped to ±10. */
export function parseSubSync(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(
    -SUB_SYNC_RANGE,
    Math.min(SUB_SYNC_RANGE, Math.round(n / SUB_SYNC_STEP) * SUB_SYNC_STEP),
  );
}

export function parseSubChoice(raw: string | null | undefined): SubChoice | undefined {
  if (raw == null || raw === "") return undefined;
  return raw;
}

export function cueByChoice(cues: SubCue[], choice: SubChoice): SubCue | null {
  if (choice === "off") return null;
  return cues.find((c) => c.id === choice) ?? cues.find((c) => c.lang === choice) ?? null;
}

/**
 * Which subtitle file to turn on.
 * A saved file (or legacy language) wins. Otherwise English on non-English audio.
 */
export function pickSubLang(
  cues: SubCue[],
  audio: Lang,
  saved?: SubChoice,
): SubChoice {
  if (saved === "off") return "off";
  const hit = saved ? cueByChoice(cues, saved) : null;
  if (hit) return hit.id;
  if (audio === "en") return "off";
  return cues.find((c) => c.lang === "en")?.id ?? "off";
}

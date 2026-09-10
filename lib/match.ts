import { db, plain } from "./db.ts";
import type { MediaKind, ProviderSlug } from "./media.ts";
import type { SourceManga } from "./sources/types.ts";

/** Above this, bind silently. Below WEAK, refuse to bind at all. */
export const CONFIDENT = 0.75;
export const WEAK = 0.45;

const NOISE =
  /\b(the|a|an|manga|manhwa|manhua|comic|official|colored|full|complete|vol|volume)\b/g;

export function normalize(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

/** Sørensen–Dice over word sets, with exact and containment shortcuts. */
export function titleScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const dice = (2 * shared) / (ta.size + tb.size);

  // One title fully containing the other is a strong signal Dice underrates
  // when lengths differ a lot ("Frieren" vs "Frieren: Beyond Journey's End").
  const contained = na.includes(nb) || nb.includes(na);
  return contained ? Math.max(dice, 0.85) : dice;
}

/**
 * null when we can't compare. Counts are the stronger signal: an exact title
 * with 200 vs 12 chapters is a bad match, a fuzzy title with matching counts
 * is a good one.
 */
export function countScore(expected: number | null, actual: number | null): number | null {
  if (!expected || !actual || expected <= 0 || actual <= 0) return null;
  const ratio = Math.min(expected, actual) / Math.max(expected, actual);
  if (ratio >= 0.95) return 1;
  if (ratio >= 0.8) return 0.8;
  if (ratio >= 0.5) return 0.4;
  return 0;
}

export function confidence(
  candidateTitle: string,
  candidateCount: number | null,
  expectedTitle: string,
  expectedCount: number | null,
): number {
  const t = titleScore(candidateTitle, expectedTitle);
  const c = countScore(expectedCount, candidateCount);

  // Counts dominate when we have them; otherwise title alone is capped, because
  // an uncorroborated string match should never read as certain.
  const score = c === null ? t * 0.8 : t * 0.45 + c * 0.55;
  return Math.round(score * 1000) / 1000;
}

export type Scored = { manga: SourceManga; confidence: number };

/** One-shot films: prefer explicit movie titles over shorter homonyms ("Silent Voice"). */
function movieRankBoost(title: string, expectedCount: number | null): number {
  if (expectedCount !== 1) return 0;
  if (/\bmovie\b/i.test(title) || /:\s*the movie\b/i.test(title)) return 0.1;
  return 0;
}

/** Display title plus distinct aliases, for source search and ranking. */
export function searchTitles(title: string, aliases: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [title, ...aliases]) {
    const k = normalize(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t.trim());
  }
  return out;
}

export function rank(
  candidates: SourceManga[],
  expectedTitle: string | string[],
  expectedCount: number | null,
): Scored[] {
  const expected = (Array.isArray(expectedTitle) ? expectedTitle : [expectedTitle]).filter(
    Boolean,
  );
  const titles = expected.length > 0 ? expected : [""];
  return candidates
    .map((manga) => ({
      manga,
      confidence: Math.max(
        ...titles.map((t) => confidence(manga.title, manga.chapterCount, t, expectedCount)),
      ),
    }))
    // Ties are the normal case, not the exception: "One Piece" and "One Piece
    // (Official Colored)" normalise to the same string, and providers often
    // report no chapter count at all for an ongoing series, which removes the
    // corroborating signal. Falling back to source order would then bind to
    // whichever the source happened to list first — for One Piece, the entry
    // holding 2 chapters instead of the one holding 764. More chapters wins.
    .sort((a, b) => {
      const ca = a.confidence + movieRankBoost(a.manga.title, expectedCount);
      const cb = b.confidence + movieRankBoost(b.manga.title, expectedCount);
      return (
        cb - ca ||
        (b.manga.chapterCount ?? 0) - (a.manga.chapterCount ?? 0)
      );
    });
}

export type Binding = {
  via: ProviderSlug;
  media_id: number;
  source_id: string;
  source_title: string;
  source_manga_id: string;
  confidence: number;
  bound_at: number;
  pinned: number;
  backend: string;
  kind: MediaKind;
};

export function getBinding(
  via: ProviderSlug,
  mediaId: number,
  kind?: MediaKind,
): Binding | undefined {
  const row = db()
    .prepare("select * from source_bindings where via = ? and media_id = ?")
    .get(via, mediaId) as Binding | undefined;
  if (!row) return;
  const b = plain(row);
  const boundKind = (b.kind || "manga") as MediaKind;
  if (kind && boundKind !== kind) return;
  return {
    ...b,
    source_manga_id: String(b.source_manga_id),
    kind: boundKind,
    backend: b.backend || "suwayomi",
  };
}

/** `pinned` marks a binding the user chose by hand; auto-matching must not overwrite it. */
export function setBinding(b: Omit<Binding, "bound_at" | "pinned">, pinned = false) {
  db()
    .prepare(
      `insert into source_bindings
         (via, media_id, source_id, source_title, source_manga_id, confidence, bound_at, pinned, backend, kind)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(via, media_id) do update set
         source_id = excluded.source_id,
         source_title = excluded.source_title,
         source_manga_id = excluded.source_manga_id,
         confidence = excluded.confidence,
         bound_at = excluded.bound_at,
         pinned = excluded.pinned,
         backend = excluded.backend,
         kind = excluded.kind`,
    )
    .run(
      b.via,
      b.media_id,
      b.source_id,
      b.source_title,
      b.source_manga_id,
      b.confidence,
      Date.now(),
      pinned ? 1 : 0,
      b.backend,
      b.kind,
    );
}

export function weakDismissKey(via: string, kind: string, id: number): string {
  return `${via}:${kind}:${id}`;
}

export function weakDismissed(stored: string | null, key: string): boolean {
  if (!stored) return false;
  try {
    const rows = JSON.parse(stored) as unknown;
    return Array.isArray(rows) && rows.includes(key);
  } catch {
    return false;
  }
}

export function dismissWeak(stored: string | null, key: string): string {
  const rows = new Set<string>();
  try {
    const parsed = JSON.parse(stored ?? "[]") as unknown;
    if (Array.isArray(parsed)) {
      for (const r of parsed) if (typeof r === "string") rows.add(r);
    }
  } catch {
    /* ignore junk */
  }
  rows.add(key);
  return JSON.stringify([...rows]);
}

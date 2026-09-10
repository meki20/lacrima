import { db, plain, type Anchor } from "./db.ts";
import type { Media, MediaKind, ProviderSlug } from "./media.ts";
import { seriesTitle } from "./series.ts";

export type ProgressRow = {
  profile_id: number;
  via: ProviderSlug;
  media_id: number;
  media_type: MediaKind;
  /** Chapter/episode number. `anchor` carries the position *inside* it. */
  unit: number;
  anchor: string | null;
  title: string | null;
  cover: string | null;
  updated_at: number;
};

export const parseAnchor = (raw: string | null): Anchor | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Anchor;
  } catch {
    return null;
  }
};

export function getProgress(
  profileId: number,
  via: ProviderSlug,
  mediaId: number,
): ProgressRow | undefined {
  const row = db()
    .prepare("select * from progress where profile_id = ? and via = ? and media_id = ?")
    .get(profileId, via, mediaId) as ProgressRow | undefined;
  return row && plain(row);
}

export function setProgress(p: {
  profileId: number;
  media: Pick<Media, "via" | "id" | "kind" | "title" | "cover">;
  unit: number;
  anchor: Anchor;
}) {
  db()
    .prepare(
      `insert into progress
         (profile_id, via, media_id, media_type, unit, anchor, title, cover, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(profile_id, via, media_id) do update set
         unit = excluded.unit,
         anchor = excluded.anchor,
         title = excluded.title,
         cover = excluded.cover,
         updated_at = excluded.updated_at`,
    )
    .run(
      p.profileId,
      p.media.via,
      p.media.id,
      p.media.kind,
      p.unit,
      JSON.stringify(p.anchor),
      p.media.title,
      p.media.cover,
      Date.now(),
    );
}

export type ContinueItem = Media & {
  pip: string;
  href: string;
  detail: string;
  ratio: number | null;
};

export function unitPip(kind: MediaKind, unit: number, season?: number | null): string {
  if (kind === "anime") {
    return season != null && season > 0 ? `S${season}·E${unit}` : `Ep. ${unit}`;
  }
  return `Ch. ${unit}`;
}

export function continueDetail(kind: MediaKind, anchor: Anchor | null): string {
  if (!anchor) return "";
  if (anchor.kind === "seconds") {
    const duration = anchor.duration;
    if (duration && duration > anchor.at) {
      const min = Math.max(1, Math.round((duration - anchor.at) / 60));
      return `${min} min left`;
    }
    return "";
  }
  if (anchor.kind === "page") {
    if (anchor.pages && anchor.pages > 0) return `page ${anchor.index + 1} of ${anchor.pages}`;
    return `page ${anchor.index + 1}`;
  }
  return "";
}

export function continueRatio(anchor: Anchor | null): number | null {
  if (!anchor) return null;
  if (anchor.kind === "seconds") {
    if (!anchor.duration || anchor.duration <= 0) return null;
    return Math.min(1, Math.max(0, anchor.at / anchor.duration));
  }
  if (anchor.kind === "page") {
    if (!anchor.pages || anchor.pages <= 0) return null;
    return Math.min(1, Math.max(0, (anchor.index + 1) / anchor.pages));
  }
  return null;
}

export function toContinueItem(r: ProgressRow): ContinueItem {
  const anchor = parseAnchor(r.anchor);
  const name = seriesTitle(r.title ?? "Untitled");
  const base = `/${r.via}/${r.media_type}/${r.media_id}`;
  const season = anchor?.kind === "seconds" ? anchor.season : undefined;
  return {
    id: r.media_id,
    via: r.via,
    kind: r.media_type,
    title: name,
    cover: r.cover,
    banner: null,
    color: null,
    description: null,
    genres: [],
    units: null,
    unitLabel: r.media_type === "anime" ? "episodes" : "chapters",
    score: null,
    pip: unitPip(r.media_type, r.unit, season),
    detail: continueDetail(r.media_type, anchor),
    ratio: continueRatio(anchor),
    href:
      anchor?.kind === "page" || anchor?.kind === "seconds"
        ? `/read${base}/${encodeURIComponent(String(anchor.chapterId))}`
        : `/title${base}`,
  };
}

/**
 * Collapse franchise duplicates (Season 2 progress vs the root) to one tile,
 * keeping the most recently updated row.
 */
export function pickContinue(rows: ProgressRow[], limit: number): ContinueItem[] {
  const seen = new Set<string>();
  const out: ContinueItem[] = [];
  for (const r of rows) {
    const name = seriesTitle(r.title ?? "Untitled");
    const k = `${r.via}|${r.media_type}|${name.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(toContinueItem(r));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Home's Continue rail. Reads only local rows — a metadata outage must never
 * empty it (CLAUDE.md, data rule 2 in spirit).
 */
export function continueReading(profileId: number, limit = 14): ContinueItem[] {
  const rows = db()
    .prepare(
      "select * from progress where profile_id = ? order by updated_at desc limit ?",
    )
    .all(profileId, limit * 3) as ProgressRow[];
  return pickContinue(rows, limit);
}

export function heroAction(
  hero: Pick<Media, "via" | "kind" | "id" | "title">,
  items: ContinueItem[],
): { primary: { href: string; label: string }; secondary?: { href: string; label: string } } {
  const details = `/title/${hero.via}/${hero.kind}/${hero.id}`;
  const name = seriesTitle(hero.title).toLowerCase();
  const hit = items.find(
    (i) => i.via === hero.via && i.kind === hero.kind && (i.id === hero.id || i.title.toLowerCase() === name),
  );
  if (hit) return { primary: { href: hit.href, label: "Continue" }, secondary: { href: details, label: "Details" } };
  return { primary: { href: details, label: "Details" } };
}

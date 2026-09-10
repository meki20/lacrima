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

export type ContinueItem = Media & { pip: string; href: string };

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

  const seen = new Set<string>();
  const out: ContinueItem[] = [];
  for (const r of rows) {
    const name = seriesTitle(r.title ?? "Untitled");
    const k = `${r.via}|${r.media_type}|${name.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const anchor = parseAnchor(r.anchor);
    const base = `/${r.via}/${r.media_type}/${r.media_id}`;
    out.push({
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
      pip: r.media_type === "anime" ? `Ep. ${r.unit}` : `Ch. ${r.unit}`,
      href:
        anchor?.kind === "page" || anchor?.kind === "seconds"
          ? `/read${base}/${encodeURIComponent(String(anchor.chapterId))}`
          : `/title${base}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

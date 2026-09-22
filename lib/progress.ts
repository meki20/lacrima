import { db, plain, type Anchor } from "./db.ts";
import type { Media, MediaKind, ProviderSlug } from "./media.ts";
import { ensureLibrary, getLibrary, removeLibrary } from "./library.ts";
import { awardForTitle } from "./stickers.ts";
import { isNightHour, markActivity } from "./yours.ts";
import { franchiseKey, franchiseLabel, seriesTitle } from "./series.ts";
import { ANIME_EPISODE_SECONDS, heldUnit, keepsResumeAnchor, skipWatchSeconds, spanWatchSeconds, usesSeriesTree, type SeriesPartMark } from "./progress-write.ts";

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
  watched_seconds: number;
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

/** Forget a title's resume state; a manually chosen non-reading library state survives. */
export function removeHistory(profileId: number, via: ProviderSlug, mediaId: number) {
  db().prepare("delete from progress where profile_id = ? and via = ? and media_id = ?").run(profileId, via, mediaId);
  if (getLibrary(profileId, via, mediaId)?.status === "reading") removeLibrary(profileId, via, mediaId);
}

export async function setProgress(p: {
  profileId: number;
  media: Pick<Media, "via" | "id" | "kind" | "title" | "cover"> &
    Partial<Pick<Media, "color" | "units" | "genres">>;
  unit: number;
  anchor: Anchor;
  watchedDelta?: number;
  skipAhead?: boolean;
  exact?: boolean;
  durationSeconds?: number;
}) {
  const prev = getProgress(p.profileId, p.media.via, p.media.id);
  const prevUnit = prev?.unit ?? 0;
  const unit = p.exact ? Math.max(0, Math.floor(p.unit)) : heldUnit(p.media.kind, prevUnit, p.unit);
  if (p.exact && unit === 0) {
    removeHistory(p.profileId, p.media.via, p.media.id);
    return [];
  }
  const tick = Math.max(0, Math.min(30, Math.floor(p.watchedDelta ?? 0)));
  const ep =
    p.durationSeconds && p.durationSeconds > 1
      ? p.durationSeconds
      : p.media.kind === "anime" && (p.skipAhead || p.exact)
        ? ANIME_EPISODE_SECONDS
        : 0;
  let credit = 0;
  if (p.media.kind === "anime") {
    if (p.exact) {
      const sign = unit >= prevUnit ? 1 : -1;
      credit = sign * spanWatchSeconds(prevUnit, unit, ep);
    } else if (p.skipAhead) {
      credit = skipWatchSeconds(prevUnit, unit, ep);
    }
  }
  const delta = tick + credit;
  const prevAnchor = parseAnchor(prev?.anchor ?? null);
  const anchor = keepsResumeAnchor(
    prevUnit,
    p.unit,
    prevAnchor && "chapterId" in prevAnchor ? prevAnchor.chapterId : undefined,
    p.exact,
  ) ? prev!.anchor : JSON.stringify(p.anchor);
  db()
    .prepare(
      `insert into progress
         (profile_id, via, media_id, media_type, unit, anchor, title, cover, updated_at, watched_seconds)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(profile_id, via, media_id) do update set
         unit = excluded.unit,
         anchor = excluded.anchor,
         title = excluded.title,
         cover = excluded.cover,
         updated_at = excluded.updated_at,
         watched_seconds = max(0, progress.watched_seconds + excluded.watched_seconds)`,
    )
    .run(
      p.profileId,
      p.media.via,
      p.media.id,
      p.media.kind,
      unit,
      anchor,
      p.media.title,
      p.media.cover,
      Date.now(),
      delta,
    );
  const bumped = !prev || prev.unit !== unit;
  markActivity(p.profileId, p.media.kind, { unit: bumped, night: bumped && isNightHour() });
  ensureLibrary(p.profileId, {
    via: p.media.via,
    id: p.media.id,
    kind: p.media.kind,
    title: p.media.title,
    cover: p.media.cover,
    color: p.media.color ?? null,
    units: p.media.units ?? null,
    genres: p.media.genres ?? [],
  });
  const seconds = Math.max(0, (prev?.watched_seconds ?? 0) + delta);
  const granted = await awardForTitle(p.profileId, p.media.via, p.media.id, p.media.kind, {
    seconds,
    unit,
  });
  return granted;
}

function quietAnchor(kind: Media["kind"]): Anchor {
  if (kind === "anime") return { kind: "seconds", at: 0, chapterId: "-", chapterName: "" };
  if (kind === "novel") return { kind: "paragraph", cfi: "0" };
  return { kind: "page", index: 0, chapterId: "-", chapterName: "" };
}

export async function setProgressTree(
  p: Parameters<typeof setProgress>[0] & {
    seriesParts?: SeriesPartMark[];
    partIndex?: number;
  },
) {
  const parts = p.seriesParts?.filter((x) => x.mediaId > 0) ?? [];
  const idx = p.partIndex;
  if (!usesSeriesTree(p) || idx == null) return setProgress(p);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === idx) {
      out.push(...(await setProgress(p)));
      continue;
    }
    if (i < idx && part.units > 0) {
      out.push(
        ...(await setProgress({
          ...p,
          media: { ...p.media, id: part.mediaId, title: part.title, cover: part.cover },
          unit: part.units,
          skipAhead: true,
          exact: false,
          watchedDelta: 0,
          anchor: quietAnchor(p.media.kind),
        })),
      );
    } else if (i > idx && p.exact) {
      out.push(
        ...(await setProgress({
          ...p,
          media: { ...p.media, id: part.mediaId, title: part.title, cover: part.cover },
          unit: 0,
          skipAhead: false,
          exact: true,
          watchedDelta: 0,
          anchor: quietAnchor(p.media.kind),
        })),
      );
    }
  }
  return out;
}

export type ContinueItem = Media & {
  pip: string;
  href: string;
  detail: string;
  ratio: number | null;
};

export function unitPip(
  kind: MediaKind,
  unit: number,
  season?: number | null,
  episode?: number | null,
): string {
  if (kind === "anime") {
    const n = episode && episode > 0 ? episode : unit;
    return season != null && season > 0 ? `S${season}·E${n}` : `Ep. ${n}`;
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
  const episode = anchor?.kind === "seconds" ? anchor.episode : undefined;
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
    pip: unitPip(r.media_type, r.unit, season, episode),
    detail: continueDetail(r.media_type, anchor),
    ratio: continueRatio(anchor),
    href:
      anchor && "chapterId" in anchor && anchor.chapterId != null
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
    const peers = rows
      .filter((x) => x.via === r.via && x.media_type === r.media_type)
      .map((x) => x.title ?? "");
    const k = `${r.via}|${r.media_type}|${franchiseKey(r.title ?? "", peers)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const item = toContinueItem(r);
    item.title = franchiseLabel(r.title ?? "Untitled", peers);
    out.push(item);
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
  const peers = [
    hero.title,
    ...items.filter((i) => i.via === hero.via && i.kind === hero.kind).map((i) => i.title),
  ];
  const fold = franchiseKey(hero.title, peers);
  const hit = items.find(
    (i) =>
      i.via === hero.via &&
      i.kind === hero.kind &&
      (i.id === hero.id || franchiseKey(i.title, peers) === fold),
  );
  if (hit) return { primary: { href: hit.href, label: "Continue" }, secondary: { href: details, label: "Details" } };
  return { primary: { href: details, label: "Details" } };
}

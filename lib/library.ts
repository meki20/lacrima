import { db, plain, plainAll } from "./db.ts";
import type { Media, MediaKind, ProviderSlug } from "./media.ts";
import { franchiseKey, franchiseLabel, seriesTitle } from "./series.ts";

export const STATUSES = ["reading", "planned", "completed", "hold", "dropped"] as const;
export type LibraryStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<LibraryStatus, string> = {
  reading: "In progress",
  planned: "Planned",
  completed: "Completed",
  hold: "On hold",
  dropped: "Dropped",
};

export const SORTS = ["added", "title", "score", "progress"] as const;
export type LibrarySort = (typeof SORTS)[number];
export const PIN_LIMIT = 10;

export type LibraryRow = {
  profile_id: number;
  via: ProviderSlug;
  media_id: number;
  media_type: MediaKind;
  status: LibraryStatus;
  score: number | null;
  added_at: number;
  title: string | null;
  cover: string | null;
  color: string | null;
  units: number | null;
  genres: string;
  pin: number;
  progress_unit: number | null;
};

export type LibraryItem = {
  via: ProviderSlug;
  id: number;
  kind: MediaKind;
  status: LibraryStatus;
  score: number | null;
  added_at: number;
  title: string;
  cover: string | null;
  color: string | null;
  units: number | null;
  genres: string[];
  pin: number;
  unit: number | null;
  href: string;
};

export type LibraryFilter = {
  kind?: MediaKind | null;
  status?: LibraryStatus | null;
  genre?: string | null;
  q?: string | null;
  sort?: LibrarySort;
};

export function parseStatus(raw: string | null | undefined): LibraryStatus | null {
  return STATUSES.includes(raw as LibraryStatus) ? (raw as LibraryStatus) : null;
}

export function parseSort(raw: string | null | undefined): LibrarySort {
  return SORTS.includes(raw as LibrarySort) ? (raw as LibrarySort) : "added";
}

export function parseGenres(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

export function toItem(row: LibraryRow): LibraryItem {
  return {
    via: row.via,
    id: row.media_id,
    kind: row.media_type,
    status: parseStatus(row.status) ?? "reading",
    score: row.score,
    added_at: row.added_at,
    title: seriesTitle(row.title ?? "Untitled"),
    cover: row.cover,
    color: row.color,
    units: row.units,
    genres: parseGenres(row.genres),
    pin: row.pin ?? 0,
    unit: row.progress_unit,
    href: `/title/${row.via}/${row.media_type}/${row.media_id}`,
  };
}

export function getLibrary(
  profileId: number,
  via: ProviderSlug,
  mediaId: number,
): LibraryItem | undefined {
  const row = db()
    .prepare(
      `select l.*, p.unit as progress_unit
         from library l
         left join progress p
           on p.profile_id = l.profile_id and p.via = l.via and p.media_id = l.media_id
        where l.profile_id = ? and l.via = ? and l.media_id = ?`,
    )
    .get(profileId, via, mediaId) as LibraryRow | undefined;
  return row && toItem(plain(row));
}

export function listLibrary(profileId: number): LibraryItem[] {
  const rows = db()
    .prepare(
      `select l.*, p.unit as progress_unit
         from library l
         left join progress p
           on p.profile_id = l.profile_id and p.via = l.via and p.media_id = l.media_id
        where l.profile_id = ?
        order by l.added_at desc`,
    )
    .all(profileId) as LibraryRow[];
  return collapseLibrary(plainAll(rows).map(toItem));
}

const STATUS_RANK: Record<LibraryStatus, number> = {
  reading: 0,
  hold: 1,
  planned: 2,
  completed: 3,
  dropped: 4,
};

/** One card per franchise. Catalog rails stay on collapseSeries. */
export function collapseLibrary(items: LibraryItem[]): LibraryItem[] {
  const seen = new Set<string>();
  const out: LibraryItem[] = [];
  for (const m of items) {
    const peers = items.filter((x) => x.via === m.via && x.kind === m.kind);
    const titles = peers.map((x) => x.title);
    const k = `${m.via}|${m.kind}|${franchiseKey(m.title, titles)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const group = peers.filter((x) => franchiseKey(x.title, titles) === franchiseKey(m.title, titles));
    const rep = [...group].sort(
      (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.added_at - a.added_at,
    )[0]!;
    const pinned = group.map((x) => x.pin).filter((n) => n > 0);
    const score = group.reduce<number | null>((best, x) => {
      if (x.score == null) return best;
      return best == null ? x.score : Math.max(best, x.score);
    }, null);
    out.push({
      ...rep,
      title: franchiseLabel(rep.title, titles),
      pin: pinned.length ? Math.min(...pinned) : 0,
      score,
      genres: [...new Set(group.flatMap((x) => x.genres))],
    });
  }
  return out;
}

export function filterLibrary(items: LibraryItem[], f: LibraryFilter): LibraryItem[] {
  const q = f.q?.trim().toLowerCase() ?? "";
  return items.filter((m) => {
    if (f.kind && m.kind !== f.kind) return false;
    if (f.status && m.status !== f.status) return false;
    if (f.genre && !m.genres.includes(f.genre)) return false;
    if (q && !m.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function sortLibrary(items: LibraryItem[], sort: LibrarySort = "added"): LibraryItem[] {
  const copy = [...items];
  if (sort === "title") copy.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "score") copy.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.added_at - a.added_at);
  else if (sort === "progress") {
    copy.sort((a, b) => progressRatio(b) - progressRatio(a) || b.added_at - a.added_at);
  } else copy.sort((a, b) => b.added_at - a.added_at);
  return copy;
}

export function progressRatio(m: Pick<LibraryItem, "unit" | "units">): number {
  if (m.unit == null || !m.units || m.units <= 0) return 0;
  return Math.min(1, Math.max(0, m.unit / m.units));
}

export function progressLabel(m: Pick<LibraryItem, "kind" | "unit" | "units">): string {
  const have = m.unit ?? 0;
  const total = m.units;
  if (m.kind === "novel") return total ? `vol ${have} / ${total}` : `vol ${have}`;
  return total ? `${have} / ${total}` : String(have);
}

export function shelfItems(items: LibraryItem[]): LibraryItem[] {
  return items.filter((m) => m.pin > 0).sort((a, b) => a.pin - b.pin).slice(0, PIN_LIMIT);
}

export function libraryGenres(items: LibraryItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of items) {
    for (const g of m.genres) {
      if (seen.has(g)) continue;
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

type Snapshot = Pick<Media, "via" | "id" | "kind" | "title" | "cover" | "color" | "units" | "genres">;

export function upsertLibrary(
  profileId: number,
  media: Snapshot,
  patch: { status?: LibraryStatus; score?: number | null } = {},
): LibraryItem {
  const existing = getLibrary(profileId, media.via, media.id);
  const status = patch.status ?? existing?.status ?? "reading";
  const score =
    patch.score !== undefined ? clampScore(patch.score) : (existing?.score ?? null);
  db()
    .prepare(
      `insert into library
         (profile_id, via, media_id, media_type, status, score, added_at, title, cover, color, units, genres, pin)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       on conflict(profile_id, via, media_id) do update set
         media_type = excluded.media_type,
         status = excluded.status,
         score = excluded.score,
         title = excluded.title,
         cover = excluded.cover,
         color = excluded.color,
         units = excluded.units,
         genres = excluded.genres`,
    )
    .run(
      profileId,
      media.via,
      media.id,
      media.kind,
      status,
      score,
      existing?.added_at ?? Date.now(),
      media.title,
      media.cover,
      media.color,
      media.units,
      JSON.stringify(media.genres ?? []),
    );
  return getLibrary(profileId, media.via, media.id)!;
}

/** First progress on a title puts it on the list; never clobbers a chosen status. */
export function ensureLibrary(profileId: number, media: Snapshot) {
  if (getLibrary(profileId, media.via, media.id)) return;
  upsertLibrary(profileId, media, { status: "reading" });
}

/** Progress written before Yours existed never created a library row. */
export function backfillLibrary(profileId: number) {
  const rows = db()
    .prepare(
      "select via, media_id, media_type, title, cover from progress where profile_id = ?",
    )
    .all(profileId) as {
    via: ProviderSlug;
    media_id: number;
    media_type: MediaKind;
    title: string | null;
    cover: string | null;
  }[];
  for (const r of rows) {
    ensureLibrary(profileId, {
      via: r.via,
      id: r.media_id,
      kind: r.media_type,
      title: r.title ?? "Untitled",
      cover: r.cover,
      color: null,
      units: null,
      genres: [],
    });
  }
}

export function removeLibrary(profileId: number, via: ProviderSlug, mediaId: number) {
  db().prepare("delete from library where profile_id = ? and via = ? and media_id = ?").run(
    profileId,
    via,
    mediaId,
  );
}

export function setPinned(
  profileId: number,
  via: ProviderSlug,
  mediaId: number,
  pinned: boolean,
): LibraryItem | undefined {
  const row = getLibrary(profileId, via, mediaId);
  if (!row) return;
  if (!pinned) {
    db()
      .prepare("update library set pin = 0 where profile_id = ? and via = ? and media_id = ?")
      .run(profileId, via, mediaId);
    return getLibrary(profileId, via, mediaId);
  }
  if (row.pin > 0) return row;
  const { n, top } = db()
    .prepare("select count(*) as n, coalesce(max(pin), 0) as top from library where profile_id = ? and pin > 0")
    .get(profileId) as { n: number; top: number };
  if (n >= PIN_LIMIT) return row;
  db()
    .prepare("update library set pin = ? where profile_id = ? and via = ? and media_id = ?")
    .run(top + 1, profileId, via, mediaId);
  return getLibrary(profileId, via, mediaId);
}

export function reorderPins(profileId: number, keys: { via: ProviderSlug; id: number }[]) {
  const wanted = keys.slice(0, PIN_LIMIT);
  db().prepare("update library set pin = 0 where profile_id = ?").run(profileId);
  const upd = db().prepare(
    "update library set pin = ? where profile_id = ? and via = ? and media_id = ?",
  );
  wanted.forEach((k, i) => upd.run(i + 1, profileId, k.via, k.id));
}

function clampScore(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.max(1, Math.min(10, Math.round(n)));
}

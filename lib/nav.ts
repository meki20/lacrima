import { KIND_INFO, parseKind } from "./kinds.ts";
import { windowEpisodes, type Series } from "./series.ts";

/** The top-bar tab a title belongs to: its kind's label, or Home for anything else. */
export function navTabForKind(kind: string): string {
  const k = parseKind(kind);
  return k ? KIND_INFO[k].label : "Home";
}

/**
 * Player/reader back link. Watching a season uses that season's metadata id, so
 * bounce straight to the franchise root with `?part=` instead of making the
 * title page redirect.
 */
export function titleBackHref(
  via: string,
  kind: string,
  mediaId: number,
  series: Pick<Series, "rootId"> | null,
): string {
  if (series && series.rootId !== mediaId) {
    return `/title/${via}/${kind}/${series.rootId}?part=${mediaId}`;
  }
  return `/title/${via}/${kind}/${mediaId}`;
}

export type Playable = { id: string; number: number; season?: number | null };

/** First item of the list the title page is actually showing — this season, not E1 of the franchise. */
export function firstPlay(
  kind: string,
  chapters: Playable[],
  window?: { offset: number; count: number | null; seasonHint: number | null },
): Playable | null {
  const list =
    kind === "anime" && window
      ? windowEpisodes(chapters, window.offset, window.count, window.seasonHint)
      : chapters;
  return list[0] ?? null;
}

export function playHref(via: string, kind: string, id: number, chapterId: string): string {
  return `/read/${via}/${kind}/${id}/${encodeURIComponent(chapterId)}`;
}

export function playLabel(kind: string, number: number, season?: number | null): string {
  if (kind === "movie") return "Watch movie";
  if (kind === "series") return season != null && season > 0 ? `Play S${season}·E${number}` : `Play E${number}`;
  return kind === "anime" ? `Play episode ${number}` : `Read chapter ${number}`;
}

/**
 * The entry after `currentId`, or null at the end of the list. A series list runs
 * season by season, so S1's last episode is followed by S2E1. Specials sit after the
 * last regular episode and auto-advance must not roll into them. A movie's list is
 * one entry long, so it has no next.
 */
export function nextPlayable<T extends { id: string; season?: number | null }>(
  kind: string,
  chapters: T[],
  currentId: string,
): T | null {
  const at = chapters.findIndex((c) => c.id === currentId);
  const next = at >= 0 ? chapters[at + 1] : undefined;
  if (!next) return null;
  if (kind === "series" && chapters[at].season !== 0 && next.season === 0) return null;
  return next;
}

export type DockEpisode = {
  id: string;
  number: number;
  name: string;
  season: number | null;
  href: string;
};

export function dockSeasons(episodes: DockEpisode[]): { season: number; label: string; items: DockEpisode[] }[] {
  const map = new Map<number, DockEpisode[]>();
  for (const e of episodes) {
    const season = e.season == null ? 1 : e.season > 0 ? e.season : 0;
    const list = map.get(season) ?? [];
    list.push(e);
    map.set(season, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] || 1000) - (b[0] || 1000))
    .map(([season, items]) => ({
      season,
      label: season > 0 ? `Season ${season}` : "Specials",
      items,
    }));
}

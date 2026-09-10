import { windowEpisodes, type Series } from "./series.ts";

export function navTabForKind(kind: string): string {
  if (kind === "anime") return "Anime";
  if (kind === "manga") return "Manga";
  if (kind === "novel") return "Novels";
  return "Home";
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

export function playLabel(kind: string, number: number): string {
  return kind === "anime" ? `Play episode ${number}` : `Read chapter ${number}`;
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

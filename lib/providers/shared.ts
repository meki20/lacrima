import { Ok, type Result } from "../result.ts";
import type { BrowseData, Media } from "../media.ts";

export type Page = { items: Media[]; hasMore: boolean };
export type Order = "popular" | "recent";

const RAIL = 14;

/**
 * Browse for providers with no batch endpoint (TMDB, Cinemeta): one page loader,
 * assembled into the same shape Kitsu's browse produces. The popular rail is also
 * page 1 of the grid, and "recommended" is popular again when nothing is liked yet,
 * so identical loads inside one call run once.
 *
 * `supported` says which genres this provider can filter by. An explicit genre it
 * can't serve is an empty page (the UI says "nothing here"), not an unfiltered
 * list posing as that genre; unsupported taste genres just don't get a rail.
 */
export async function browseWith(
  load: (order: Order, genre: string | null, page: number) => Promise<Result<Page>>,
  genre: string | null,
  page: number,
  taste: string[],
  supported: (genre: string) => boolean,
): Promise<Result<BrowseData>> {
  if (genre && !supported(genre)) {
    return Ok({ popular: [], recommended: [], recent: [], rails: [], grid: [], hasMore: false });
  }

  const runs = new Map<string, Promise<Result<Page>>>();
  const get = (order: Order, g: string | null, p: number) => {
    const key = `${order}|${g ?? ""}|${p}`;
    let run = runs.get(key);
    if (!run) runs.set(key, (run = load(order, g, p)));
    return run;
  };

  const liked = taste.filter(supported);
  const rec = genre ?? liked[0] ?? null;
  const rails = genre ? [] : liked.filter((g) => g !== rec).slice(0, 2);

  const [popular, recommended, recent, grid, ...railRes] = await Promise.all([
    get("popular", genre, 1),
    get("popular", rec, 1),
    get("recent", genre, 1),
    get("popular", genre, page),
    ...rails.map((g) => get("popular", g, 1)),
  ]);

  // The page needs its first rail and its grid; the other rows degrade to empty.
  if (!popular.ok) return popular;
  if (!grid.ok) return grid;
  const items = (r: Result<Page>) => (r.ok ? r.value.items.slice(0, RAIL) : []);

  return Ok({
    popular: items(popular),
    recommended: items(recommended),
    recent: items(recent),
    rails: rails.map((g, i) => ({ genre: g, items: items(railRes[i]) })),
    grid: grid.value.items,
    hasMore: grid.value.hasMore,
  });
}

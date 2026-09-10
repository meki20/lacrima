import { Err, Ok, type Result } from "../result.ts";
import {
  clean,
  otherTitles,
  type BrowseData,
  type HomeData,
  type Media,
  type MediaKind,
  type Provider,
  type SearchData,
} from "../media.ts";

const BASE = "https://api.jikan.moe/v4";

/** MAL genre ids. Only what profiles can currently hold; extend as needed. */
const GENRE_ID: Record<string, number> = {
  Action: 1,
  Adventure: 2,
  Comedy: 4,
  Drama: 8,
  Fantasy: 10,
  Horror: 14,
  Mystery: 7,
  Romance: 22,
  "Sci-Fi": 24,
  "Slice of Life": 36,
  Sports: 30,
  Supernatural: 37,
};

type RawJikan = {
  mal_id: number;
  title: string;
  title_english?: string | null;
  images?: { jpg?: { large_image_url?: string | null; image_url?: string | null } };
  synopsis?: string | null;
  genres?: { name: string }[];
  episodes?: number | null;
  chapters?: number | null;
  duration?: string | null;
  score?: number | null;
  type?: string | null;
};

function shape(m: RawJikan, kind: MediaKind): Media {
  const hours = Number(/\b(\d+)\s*hr/i.exec(m.duration ?? "")?.[1] ?? 0);
  const minutes = Number(/\b(\d+)\s*min/i.exec(m.duration ?? "")?.[1] ?? 0);
  const title = m.title_english ?? m.title;
  return {
    id: m.mal_id,
    via: "jikan",
    kind,
    title,
    aliases: otherTitles(title, m.title_english, m.title),
    cover: m.images?.jpg?.large_image_url ?? m.images?.jpg?.image_url ?? null,
    // MAL has no wide banner art; the hero falls back to the cover.
    banner: null,
    color: null,
    description: clean(m.synopsis),
    genres: (m.genres ?? []).map((g) => g.name),
    units: kind === "anime" ? (m.episodes ?? null) : (m.chapters ?? null),
    unitLabel: kind === "anime" ? "episodes" : "chapters",
    unitMinutes: kind === "anime" && hours + minutes > 0 ? hours * 60 + minutes : null,
    score: m.score ? Math.round(m.score * 10) : null,
  };
}

function kindQs(kind: MediaKind): string {
  if (kind === "novel") return "&type=lightnovel";
  if (kind === "manga") return "&type=manga";
  return "";
}

function listPath(
  kind: MediaKind,
  extra: string,
  gq: string,
  order: string,
  limit: number,
  page: number,
): string {
  const type = kind === "anime" ? "anime" : "manga";
  const sort = order === "start_date" ? "desc" : "asc";
  return `/${type}?order_by=${order}&sort=${sort}&limit=${limit}&page=${page}${extra}${gq}`;
}

async function get(path: string): Promise<Result<RawJikan[]>> {
  const r = await getPage(path);
  return r.ok ? Ok(r.value.items) : r;
}

async function getPage(
  path: string,
): Promise<Result<{ items: RawJikan[]; hasMore: boolean }>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(4_000),
    });
    if (res.status === 429) return Err("MyAnimeList is rate-limiting us. Try again shortly.");
    if (!res.ok) return Err(`MyAnimeList returned ${res.status}.`);
    const json = (await res.json()) as {
      data?: RawJikan[];
      pagination?: { has_next_page?: boolean };
    };
    return Ok({ items: json.data ?? [], hasMore: Boolean(json.pagination?.has_next_page) });
  } catch (e) {
    return Err(e instanceof Error ? e.message : "Could not reach MyAnimeList.");
  }
}

export const jikan: Provider = {
  slug: "jikan",
  name: "MyAnimeList",

  async fetchTitle(kind, id) {
    try {
      const type = kind === "anime" ? "anime" : "manga";
      const res = await fetch(`${BASE}/${type}/${id}`, {
        headers: { accept: "application/json" },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(4_000),
      });
      if (res.status === 404) return Err("MyAnimeList has no title with that id.");
      if (!res.ok) return Err(`MyAnimeList returned ${res.status}.`);
      const json = (await res.json()) as { data?: RawJikan };
      if (!json.data) return Err("MyAnimeList returned no title.");
      return Ok(shape(json.data, kind));
    } catch (e) {
      return Err(e instanceof Error ? e.message : "Could not reach MyAnimeList.");
    }
  },

  async fetchHome(genre: string): Promise<Result<HomeData>> {
    try {
      const gid = GENRE_ID[genre] ?? GENRE_ID.Adventure;

      const calls: [keyof HomeData | "hero", string, MediaKind][] = [
        ["popularAnime", "/top/anime?limit=14", "anime"],
        ["popularManga", "/top/manga?type=manga&limit=14", "manga"],
        ["novels", "/top/manga?type=lightnovel&limit=14", "novel"],
        ["forYou", `/anime?genres=${gid}&order_by=popularity&sort=asc&limit=14`, "anime"],
      ];

      const results = await Promise.all(calls.map(([, path]) => get(path)));
      const out: Record<string, Media[]> = {};
      for (let i = 0; i < calls.length; i++) {
        const [key, , kind] = calls[i];
        const r = results[i];
        if (!r.ok) return r;
        out[key] = r.value.map((m) => shape(m, kind));
      }

      return Ok({
        hero: out.popularAnime[0] ?? null,
        popularAnime: out.popularAnime,
        popularManga: out.popularManga,
        novels: out.novels,
        forYou: out.forYou,
      });
    } catch (e) {
      return Err(e instanceof Error ? e.message : "Could not reach MyAnimeList.");
    }
  },

  async search(query: string): Promise<Result<SearchData>> {
    try {
      const q = encodeURIComponent(query);
      const anime = await get(`/anime?q=${q}&limit=8`);
      if (!anime.ok) return anime;
      const manga = await get(`/manga?q=${q}&limit=8&type=manga`);
      if (!manga.ok) return manga;
      const novels = await get(`/manga?q=${q}&limit=8&type=lightnovel`);
      if (!novels.ok) return novels;
      return Ok({
        anime: anime.value.map((m) => shape(m, "anime")),
        manga: manga.value.map((m) => shape(m, "manga")),
        novels: novels.value.map((m) => shape(m, "novel")),
      });
    } catch (e) {
      return Err(e instanceof Error ? e.message : "Could not reach MyAnimeList.");
    }
  },

  async browse(kind, genre, page, taste): Promise<Result<BrowseData>> {
    try {
      const extra = kindQs(kind);
      const gid = genre ? GENRE_ID[genre] : undefined;
      const gq = gid ? `&genres=${gid}` : "";
      const rec = genre ?? taste[0];
      const recId = rec ? GENRE_ID[rec] : undefined;
      const rails = genre ? [] : taste.filter((g) => g !== rec && GENRE_ID[g]).slice(0, 2);
      const type = kind === "anime" ? "anime" : "manga";

      const [popular, recommended, recent, grid, railRes] = await Promise.all([
        get(listPath(kind, extra, gq, "popularity", 14, 1)),
        get(
          `/${type}?order_by=popularity&sort=asc&limit=14${extra}${recId ? `&genres=${recId}` : ""}`,
        ),
        get(listPath(kind, extra, gq, "start_date", 14, 1)),
        getPage(listPath(kind, extra, gq, "popularity", 24, page)),
        Promise.all(
          rails.map((g) =>
            get(`/${type}?order_by=popularity&sort=asc&limit=14${extra}&genres=${GENRE_ID[g]}`),
          ),
        ),
      ]);

      if (!popular.ok) return popular;
      if (!recommended.ok) return recommended;
      if (!recent.ok) return recent;
      if (!grid.ok) return grid;
      for (const r of railRes) if (!r.ok) return r;

      return Ok({
        popular: popular.value.map((m) => shape(m, kind)),
        recommended: recommended.value.map((m) => shape(m, kind)),
        recent: recent.value.map((m) => shape(m, kind)),
        rails: rails.map((g, i) => {
          const row = railRes[i];
          return { genre: g, items: row?.ok ? row.value.map((m) => shape(m, kind)) : [] };
        }),
        grid: grid.value.items.map((m) => shape(m, kind)),
        hasMore: grid.value.hasMore,
      });
    } catch (e) {
      return Err(e instanceof Error ? e.message : "Could not reach MyAnimeList.");
    }
  },
};

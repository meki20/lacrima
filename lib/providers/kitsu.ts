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

const BASE = "https://kitsu.app/api/edge";

type RawKitsu = {
  id: string;
  attributes: {
    canonicalTitle?: string | null;
    titles?: Record<string, string | undefined>;
    posterImage?: { large?: string; original?: string } | null;
    coverImage?: { large?: string; original?: string } | null;
    synopsis?: string | null;
    episodeCount?: number | null;
    episodeLength?: number | null;
    chapterCount?: number | null;
    averageRating?: string | null;
    subtype?: string | null;
  };
  relationships?: { categories?: { data?: { id: string }[] } };
};

type Included = {
  id: string;
  type: string;
  attributes: { title?: string; slug?: string };
};

function genresOf(m: RawKitsu, included: Included[]): string[] {
  const cats = new Map(
    included
      .filter((x) => x.type === "categories")
      .map((x) => [x.id, x.attributes.title ?? x.attributes.slug ?? ""]),
  );
  return (m.relationships?.categories?.data ?? [])
    .map((d) => cats.get(d.id))
    .filter((s): s is string => Boolean(s));
}

function shape(m: RawKitsu, fallbackKind: MediaKind, genres: string[]): Media {
  const a = m.attributes;
  const kind: MediaKind = a.subtype === "novel" ? "novel" : fallbackKind;
  const rating = a.averageRating ? Math.round(Number(a.averageRating)) : null;
  const title = a.titles?.en || a.canonicalTitle || a.titles?.en_jp || "Untitled";
  return {
    id: Number(m.id),
    via: "kitsu",
    kind,
    title,
    aliases: otherTitles(title, a.titles?.en, a.canonicalTitle, a.titles?.en_jp),
    cover: a.posterImage?.large ?? a.posterImage?.original ?? null,
    banner: a.coverImage?.large ?? a.coverImage?.original ?? null,
    color: null,
    description: clean(a.synopsis),
    genres,
    units: kind === "anime" ? (a.episodeCount ?? null) : (a.chapterCount ?? null),
    unitLabel: kind === "anime" ? "episodes" : "chapters",
    unitMinutes: kind === "anime" ? (a.episodeLength ?? null) : null,
    score: rating,
  };
}

function catSlug(genre: string): string {
  return genre.toLowerCase().replace(/\s+/g, "-");
}

function kindPath(kind: MediaKind): string {
  return kind === "anime" ? "anime" : "manga";
}

function subtypeQs(kind: MediaKind): string {
  if (kind === "novel") return "&filter[subtype]=novel";
  if (kind === "manga") return "&filter[subtype]=manga";
  return "";
}

async function get(
  path: string,
  kind: MediaKind,
): Promise<Result<{ items: Media[]; hasMore: boolean }>> {
  try {
    const url = path.startsWith("/trending")
      ? path
      : `${path}${path.includes("?") ? "&" : "?"}include=categories`;
    const res = await fetch(`${BASE}${url}`, {
      headers: { accept: "application/vnd.api+json" },
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return Err(`Kitsu returned ${res.status}.`);
    const json = (await res.json()) as {
      data?: RawKitsu[];
      included?: Included[];
      links?: { next?: string };
    };
    const included = json.included ?? [];
    return Ok({
      items: (json.data ?? []).map((m) => shape(m, kind, genresOf(m, included))),
      hasMore: Boolean(json.links?.next),
    });
  } catch (e) {
    return Err(e instanceof Error ? e.message : "Could not reach Kitsu.");
  }
}

export const kitsu: Provider = {
  slug: "kitsu",
  name: "Kitsu",

  async fetchTitle(kind, id) {
    try {
      const type = kindPath(kind);
      const res = await fetch(`${BASE}/${type}/${id}?include=categories`, {
        headers: { accept: "application/vnd.api+json" },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(4_000),
      });
      if (res.status === 404) return Err("Kitsu has no title with that id.");
      if (!res.ok) return Err(`Kitsu returned ${res.status}.`);
      const json = (await res.json()) as { data?: RawKitsu; included?: Included[] };
      if (!json.data) return Err("Kitsu returned no title.");
      return Ok(shape(json.data, kind, genresOf(json.data, json.included ?? [])));
    } catch (e) {
      return Err(e instanceof Error ? e.message : "Could not reach Kitsu.");
    }
  },

  async fetchHome(genre: string): Promise<Result<HomeData>> {
    try {
      const slug = catSlug(genre);
      const calls: [string, string, MediaKind][] = [
        ["popularAnime", "/trending/anime?limit=14", "anime"],
        ["popularManga", "/trending/manga?limit=14", "manga"],
        ["novels", "/manga?filter[subtype]=novel&sort=-userCount&page[limit]=14", "novel"],
        ["forYou", `/anime?filter[categories]=${slug}&sort=-userCount&page[limit]=14`, "anime"],
      ];

      const results = await Promise.all(calls.map(([, path, kind]) => get(path, kind)));
      const out: Record<string, Media[]> = {};

      results.forEach((r, i) => {
        const [key] = calls[i];
        // A single dead row degrades that row, not the page.
        out[key] = r.ok ? r.value.items : [];
      });

      if (out.popularAnime.length === 0 && out.popularManga.length === 0) {
        return Err("Kitsu returned nothing usable.");
      }

      const hero = out.popularAnime.find((m) => m.banner) ?? out.popularAnime[0] ?? null;

      return Ok({
        hero,
        popularAnime: out.popularAnime,
        popularManga: out.popularManga,
        novels: out.novels,
        forYou: out.forYou,
      });
    } catch (e) {
      return Err(e instanceof Error ? e.message : "Could not reach Kitsu.");
    }
  },

  async search(query: string): Promise<Result<SearchData>> {
    try {
      const q = encodeURIComponent(query);
      const [anime, manga, novels] = await Promise.all([
        get(`/anime?filter[text]=${q}&page[limit]=8`, "anime"),
        get(`/manga?filter[text]=${q}&filter[subtype]=manga&page[limit]=8`, "manga"),
        get(`/manga?filter[text]=${q}&filter[subtype]=novel&page[limit]=8`, "novel"),
      ]);
      if (!anime.ok) return anime;
      if (!manga.ok) return manga;
      if (!novels.ok) return novels;
      return Ok({
        anime: anime.value.items,
        manga: manga.value.items,
        novels: novels.value.items,
      });
    } catch (e) {
      return Err(e instanceof Error ? e.message : "Could not reach Kitsu.");
    }
  },

  async browse(kind, genre, page, taste): Promise<Result<BrowseData>> {
    try {
      const type = kindPath(kind);
      const extra = subtypeQs(kind);
      const gq = genre ? `&filter[categories]=${catSlug(genre)}` : "";
      const rec = genre ?? taste[0] ?? null;
      const recQs = rec ? `&filter[categories]=${catSlug(rec)}` : "";
      const rails = genre ? [] : taste.filter((g) => g !== rec).slice(0, 2);
      const offset = (page - 1) * 20;

      const [popular, recommended, recent, grid, ...railRes] = await Promise.all([
        get(`/${type}?sort=-userCount&page[limit]=14${extra}${gq}`, kind),
        get(`/${type}?sort=-userCount&page[limit]=14${extra}${recQs}`, kind),
        get(`/${type}?sort=-startDate&page[limit]=14${extra}${gq}`, kind),
        get(`/${type}?sort=-userCount&page[limit]=20&page[offset]=${offset}${extra}${gq}`, kind),
        ...rails.map((g) =>
          get(
            `/${type}?sort=-userCount&page[limit]=14${extra}&filter[categories]=${catSlug(g)}`,
            kind,
          ),
        ),
      ]);

      if (!popular.ok) return popular;
      if (!recommended.ok) return recommended;
      if (!recent.ok) return recent;
      if (!grid.ok) return grid;

      return Ok({
        popular: popular.value.items,
        recommended: recommended.value.items,
        recent: recent.value.items,
        rails: rails.map((g, i) => ({
          genre: g,
          items: railRes[i]?.ok ? railRes[i].value.items : [],
        })),
        grid: grid.value.items,
        hasMore: grid.value.hasMore,
      });
    } catch (e) {
      return Err(e instanceof Error ? e.message : "Could not reach Kitsu.");
    }
  },
};

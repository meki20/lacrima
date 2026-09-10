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

const ENDPOINT = "https://graphql.anilist.co";

const CARD = `
  id
  type
  format
  title { romaji english }
  coverImage { large color }
  bannerImage
  description(asHtml: false)
  genres
  episodes
  duration
  chapters
  averageScore
`;

type RawMedia = {
  id: number;
  type: "ANIME" | "MANGA";
  format: string | null;
  title: { romaji: string | null; english: string | null };
  coverImage: { large: string | null; color: string | null } | null;
  bannerImage: string | null;
  description: string | null;
  genres: string[] | null;
  episodes: number | null;
  duration: number | null;
  chapters: number | null;
  averageScore: number | null;
};

function shape(m: RawMedia): Media {
  const kind: MediaKind =
    m.type === "ANIME" ? "anime" : m.format === "NOVEL" ? "novel" : "manga";
  const title = m.title.english ?? m.title.romaji ?? "Untitled";
  return {
    id: m.id,
    via: "anilist",
    kind,
    title,
    aliases: otherTitles(title, m.title.english, m.title.romaji),
    cover: m.coverImage?.large ?? null,
    banner: m.bannerImage,
    color: m.coverImage?.color ?? null,
    description: clean(m.description),
    genres: m.genres ?? [],
    units: kind === "anime" ? m.episodes : m.chapters,
    unitLabel: kind === "anime" ? "episodes" : "chapters",
    unitMinutes: kind === "anime" ? m.duration : null,
    score: m.averageScore,
  };
}

/** One aliased request fetches every Home row — AniList rate-limits hard. */
const HOME_QUERY = `
  query Home($genre: String) {
    heroRow: Page(perPage: 6) {
      media(sort: TRENDING_DESC, type: ANIME, isAdult: false, status: RELEASING) { ${CARD} }
    }
    popularAnime: Page(perPage: 14) {
      media(sort: TRENDING_DESC, type: ANIME, isAdult: false) { ${CARD} }
    }
    popularManga: Page(perPage: 14) {
      media(sort: TRENDING_DESC, type: MANGA, format_not: NOVEL, isAdult: false) { ${CARD} }
    }
    novels: Page(perPage: 14) {
      media(sort: POPULARITY_DESC, type: MANGA, format: NOVEL, isAdult: false) { ${CARD} }
    }
    forYou: Page(perPage: 14) {
      media(sort: POPULARITY_DESC, genre: $genre, isAdult: false) { ${CARD} }
    }
  }
`;

async function request<T>(query: string, variables?: object): Promise<Result<T>> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "Lacrima/0.1 (self-hosted)",
      },
      body: JSON.stringify({ query, variables }),
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(4_000),
    });

    if (!res.ok) {
      return Err(
        res.status === 429 ? "AniList is rate-limiting us." : `AniList returned ${res.status}.`,
      );
    }

    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) return Err(json.errors[0].message);
    if (!json.data) return Err("AniList returned no data.");
    return Ok(json.data);
  } catch (e) {
    return Err(e instanceof Error ? e.message : "Could not reach AniList.");
  }
}

function kindArgs(kind: MediaKind): string {
  if (kind === "anime") return "type: ANIME, isAdult: false";
  if (kind === "novel") return "type: MANGA, format: NOVEL, isAdult: false";
  return "type: MANGA, format_not: NOVEL, isAdult: false";
}

function pickMedia(block: { media?: RawMedia[] } | undefined): Media[] {
  return (block?.media ?? []).map(shape);
}

export const anilist: Provider = {
  slug: "anilist",
  name: "AniList",

  async fetchTitle(kind, id) {
    const r = await request<{ Media: RawMedia | null }>(
      `query Title($id: Int!) { Media(id: $id) { ${CARD} } }`,
      { id },
    );
    if (!r.ok) return r;
    if (!r.value.Media) return Err("AniList has no title with that id.");
    return Ok(shape(r.value.Media));
  },

  async fetchHome(genre: string): Promise<Result<HomeData>> {
    const r = await request<Record<string, { media: RawMedia[] }>>(HOME_QUERY, { genre });
    if (!r.ok) return r;

    const pick = (k: string) => (r.value[k]?.media ?? []).map(shape);
    const heroes = pick("heroRow").filter((m) => m.banner);

    return Ok({
      hero: heroes[0] ?? null,
      popularAnime: pick("popularAnime"),
      popularManga: pick("popularManga"),
      novels: pick("novels"),
      forYou: pick("forYou"),
    });
  },

  async search(query: string): Promise<Result<SearchData>> {
    const r = await request<Record<string, { media: RawMedia[] }>>(
      `query Search($q: String) {
        anime: Page(perPage: 8) {
          media(search: $q, type: ANIME, isAdult: false) { ${CARD} }
        }
        manga: Page(perPage: 8) {
          media(search: $q, type: MANGA, format_not: NOVEL, isAdult: false) { ${CARD} }
        }
        novels: Page(perPage: 8) {
          media(search: $q, type: MANGA, format: NOVEL, isAdult: false) { ${CARD} }
        }
      }`,
      { q: query },
    );
    if (!r.ok) return r;
    return Ok({
      anime: pickMedia(r.value.anime),
      manga: pickMedia(r.value.manga),
      novels: pickMedia(r.value.novels),
    });
  },

  async browse(kind, genre, page, taste): Promise<Result<BrowseData>> {
    const args = kindArgs(kind);
    const rec = genre ?? taste[0] ?? null;
    const rails = genre ? [] : taste.filter((g) => g !== rec).slice(0, 2);
    const railVars = rails.map((_, i) => `$g${i}: String`).join(", ");
    const railGql = rails
      .map(
        (_, i) => `
        rail${i}: Page(perPage: 14) {
          media(sort: TRENDING_DESC, genre: $g${i}, ${args}) { ${CARD} }
        }`,
      )
      .join("");

    const r = await request<
      Record<string, { media?: RawMedia[]; pageInfo?: { hasNextPage?: boolean } }>
    >(
      `query Browse($genre: String, $rec: String, $page: Int${railVars ? `, ${railVars}` : ""}) {
        popular: Page(perPage: 14) {
          media(sort: TRENDING_DESC, genre: $genre, ${args}) { ${CARD} }
        }
        recommended: Page(perPage: 14) {
          media(sort: POPULARITY_DESC, genre: $rec, ${args}) { ${CARD} }
        }
        recent: Page(perPage: 14) {
          media(sort: START_DATE_DESC, status_not: NOT_YET_RELEASED, genre: $genre, ${args}) { ${CARD} }
        }
        grid: Page(page: $page, perPage: 24) {
          pageInfo { hasNextPage }
          media(sort: POPULARITY_DESC, genre: $genre, ${args}) { ${CARD} }
        }
        ${railGql}
      }`,
      Object.fromEntries([
        ["genre", genre],
        ["rec", rec],
        ["page", page],
        ...rails.map((g, i) => [`g${i}`, g]),
      ]),
    );
    if (!r.ok) return r;

    return Ok({
      popular: pickMedia(r.value.popular),
      recommended: pickMedia(r.value.recommended),
      recent: pickMedia(r.value.recent),
      rails: rails.map((g, i) => ({ genre: g, items: pickMedia(r.value[`rail${i}`]) })),
      grid: pickMedia(r.value.grid),
      hasMore: Boolean(r.value.grid?.pageInfo?.hasNextPage),
    });
  },
};

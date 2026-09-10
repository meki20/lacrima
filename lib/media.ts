export type MediaKind = "anime" | "manga" | "novel";

export type ProviderSlug = "anilist" | "jikan" | "kitsu";

export type Media = {
  id: number;
  /**
   * Which provider minted `id`. IDs are NOT portable between providers — a Kitsu
   * id is meaningless to AniList — so every link and lookup must carry this.
   */
  via: ProviderSlug;
  kind: MediaKind;
  title: string;
  /**
   * Other names the provider knows (romaji vs English). Source search tries
   * these too — scanlation sites often index only one of them.
   */
  aliases?: string[];
  cover: string | null;
  banner: string | null;
  color: string | null;
  description: string | null;
  genres: string[];
  units: number | null;
  unitLabel: string;
  /** Typical anime episode/movie runtime. Used by the live remux timeline. */
  unitMinutes?: number | null;
  score: number | null;
};

export type HomeData = {
  hero: Media | null;
  popularAnime: Media[];
  popularManga: Media[];
  novels: Media[];
  forYou: Media[];
};

export type SearchData = {
  anime: Media[];
  manga: Media[];
  novels: Media[];
};

export type BrowseData = {
  popular: Media[];
  recommended: Media[];
  recent: Media[];
  rails: { genre: string; items: Media[] }[];
  grid: Media[];
  hasMore: boolean;
};

/** Shared by chips, Jikan ids, and Kitsu slugs. Unknown values are ignored. */
export const GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
] as const;

/**
 * Every metadata provider implements this. Providers are interchangeable for
 * *browsing*, but not for lookups by id — see Media.via.
 */
export type Provider = {
  slug: ProviderSlug;
  name: string;
  fetchHome(genre: string): Promise<import("./result.ts").Result<HomeData>>;
  fetchTitle(kind: MediaKind, id: number): Promise<import("./result.ts").Result<Media>>;
  search(query: string): Promise<import("./result.ts").Result<SearchData>>;
  browse(
    kind: MediaKind,
    genre: string | null,
    page: number,
    taste: string[],
  ): Promise<import("./result.ts").Result<BrowseData>>;
};

export const clean = (s: string | null | undefined): string | null =>
  s ? s.replace(/<[^>]+>/g, "").trim() : null;

/** Names that aren't the display title, de-duplicated. */
export function otherTitles(
  display: string,
  ...names: (string | null | undefined)[]
): string[] {
  const skip = display.trim().toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>(skip ? [skip] : []);
  for (const n of names) {
    const t = n?.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

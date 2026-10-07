export const MEDIA_KINDS = ["anime", "manga", "novel", "movie", "series"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Two TMDB slugs because TMDB movie and tv ids collide, and every repo key is
 * `(via, media_id)` with no kind in it.
 */
export const PROVIDER_SLUGS = ["anilist", "jikan", "kitsu", "tmdb-movie", "tmdb-tv", "cinemeta"] as const;
export type ProviderSlug = (typeof PROVIDER_SLUGS)[number];

export const isProviderSlug = (v: unknown): v is ProviderSlug =>
  typeof v === "string" && (PROVIDER_SLUGS as readonly string[]).includes(v);

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
  /** Full IMDb id (`tt0111161`) when the provider knows it; how video sources are addressed. */
  imdb?: string | null;
  /** Release year, for disambiguating same-named films and shows. */
  year?: number | null;
  /** Original spoken language as the provider names it ("Korean", "ko"); read with `nativeLang`. */
  language?: string | null;
};

/** An anime-family provider's home feed. */
export type HomeData = {
  hero: Media | null;
  popularAnime: Media[];
  popularManga: Media[];
  novels: Media[];
  forYou: Media[];
};

/**
 * What `fetchHome` serves: the feed plus the movie and series rails, which come from
 * their own provider chains. An empty rail beside a `failed` kind means that chain died.
 */
export type HomePage = HomeData & {
  popularMovies: Media[];
  popularSeries: Media[];
};

export type SearchData = {
  anime: Media[];
  manga: Media[];
  novels: Media[];
  movies: Media[];
  series: Media[];
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
  /** Kinds this provider can serve; each kind gets its own fallback chain. */
  kinds: MediaKind[];
  /** Absent means always on. A keyed provider returns false while its key is unset. */
  enabled?(): boolean;
  /** Optional: only the anime-family providers have a combined home feed. */
  fetchHome?(genre: string): Promise<import("./result.ts").Result<HomeData>>;
  fetchTitle(kind: MediaKind, id: number): Promise<import("./result.ts").Result<Media>>;
  /** `kinds` is a hint: a provider whose one call fans out per kind (Cinemeta) skips the ones nobody asked for. */
  search(query: string, kinds?: readonly MediaKind[]): Promise<import("./result.ts").Result<SearchData>>;
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

import { Err, Ok, type Result } from "../result.ts";
import {
  clean,
  otherTitles,
  type Media,
  type MediaKind,
  type Provider,
  type SearchData,
} from "../media.ts";
import { ASIAN_DRAMA } from "../kinds.ts";
import { browseWith, type Page } from "./shared.ts";

const BASE = "https://api.themoviedb.org/3";
const POSTER = "https://image.tmdb.org/t/p/w500";
const BACKDROP = "https://image.tmdb.org/t/p/w1280";
const ANIMATION = 16;

/** Env only, never stored: a TMDB key is a credential. A v4 read token is a JWT; a v3 key is not. */
const apiKey = () => process.env.LACRIMA_TMDB_KEY?.trim() ?? "";

/** The "Asian drama" chip: scripted live-action TV from these countries (animation is anime's). */
const DEFAULT_COUNTRIES = ["KR", "JP", "CN", "TW", "TH"];

export function dramaCountries(raw = process.env.LACRIMA_DRAMA_COUNTRIES): string[] {
  const list = (raw ?? "")
    .split(/[\s,|]+/)
    .map((c) => c.toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return list.length ? list : DEFAULT_COUNTRIES;
}

/** TMDB's English genre names by id, for the list endpoints that only send ids. */
const GENRE_NAME: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary",
  18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Science Fiction", 10770: "TV Movie", 53: "Thriller",
  10752: "War", 37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News",
  10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};

/** TMDB's combined TV genres ("Sci-Fi & Fantasy") split into the app's single-word genres. */
const genreNames = (names: string[]) => [
  ...new Set(names.flatMap((n) => (n === "Science Fiction" ? ["Sci-Fi"] : n.split(" & ")))),
];

type Side = "movie" | "tv";

/** Browse genre -> TMDB genre id. TV merges Action/Adventure and Sci-Fi/Fantasy into one id each. */
const GENRE_ID: Record<Side, Record<string, number>> = {
  movie: { Action: 28, Adventure: 12, Comedy: 35, Drama: 18, Fantasy: 14, Horror: 27, Mystery: 9648, Romance: 10749, "Sci-Fi": 878 },
  tv: { Action: 10759, Adventure: 10759, Comedy: 35, Drama: 18, Fantasy: 10765, Mystery: 9648, "Sci-Fi": 10765 },
};

/** No TMDB genre exists for these; they're resolved to a keyword id once, by name. */
const GENRE_KEYWORD: Record<Side, Record<string, string>> = {
  movie: { Sports: "sport" },
  tv: { Horror: "horror", Romance: "romance", Sports: "sport" },
};

type Raw = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  runtime?: number | null;
  episode_run_time?: number[];
  number_of_episodes?: number | null;
  imdb_id?: string | null;
  external_ids?: { imdb_id?: string | null };
  origin_country?: string[];
  original_language?: string;
};

type Slug = "tmdb-movie" | "tmdb-tv";

function shape(m: Raw, slug: Slug): Media {
  const movie = slug === "tmdb-movie";
  const title = (movie ? m.title || m.original_title : m.name || m.original_name) || "Untitled";
  const imdb = movie ? m.imdb_id : m.external_ids?.imdb_id;
  const names = m.genres?.map((g) => g.name) ?? (m.genre_ids ?? []).map((id) => GENRE_NAME[id]).filter(Boolean);
  return {
    id: m.id,
    via: slug,
    kind: movie ? "movie" : "series",
    title,
    aliases: otherTitles(title, movie ? m.original_title : m.original_name),
    cover: m.poster_path ? `${POSTER}${m.poster_path}` : null,
    banner: m.backdrop_path ? `${BACKDROP}${m.backdrop_path}` : null,
    color: null,
    description: clean(m.overview),
    genres: genreNames(names),
    units: movie ? 1 : m.number_of_episodes || null,
    unitLabel: movie ? "movie" : "episodes",
    unitMinutes: (movie ? m.runtime : m.episode_run_time?.[0]) || null,
    score: m.vote_average ? Math.round(m.vote_average * 10) : null,
    imdb: imdb && /^tt\d+$/.test(imdb) ? imdb : null,
    year: Number((movie ? m.release_date : m.first_air_date)?.slice(0, 4)) || null,
    language: m.original_language || null,
  };
}

type Query = Record<string, string | number | boolean | undefined>;

async function get<T>(path: string, query: Query = {}): Promise<Result<T>> {
  const key = apiKey();
  if (!key) return Err("TMDB needs LACRIMA_TMDB_KEY.");
  const jwt = key.startsWith("eyJ");
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries({ language: "en-US", ...query })) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  if (!jwt) url.searchParams.set("api_key", key);
  try {
    const res = await fetch(url.toString(), {
      headers: { accept: "application/json", ...(jwt ? { authorization: `Bearer ${key}` } : {}) },
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(4_000),
    });
    if (res.status === 401) return Err("TMDB rejected LACRIMA_TMDB_KEY. Check the key, or unset it to use Cinemeta only.");
    if (res.status === 404) return Err("TMDB has no title with that id.");
    if (res.status === 429) return Err("TMDB is rate-limiting us. Try again shortly.");
    if (!res.ok) return Err(`TMDB returned ${res.status}.`);
    return Ok((await res.json()) as T);
  } catch (e) {
    return Err(e instanceof Error ? e.message : "Could not reach TMDB.");
  }
}

type List = { results?: Raw[]; total_pages?: number };

// The promise is what's kept, so a browse's parallel rails share one lookup. Only a hit stays cached.
const keywordIds = new Map<string, Promise<Result<number | null>>>();

function keywordId(name: string): Promise<Result<number | null>> {
  const known = keywordIds.get(name);
  if (known) return known;
  const lookup = get<{ results?: { id: number; name: string }[] }>("/search/keyword", { query: name }).then(
    (r): Result<number | null> => (r.ok ? Ok(r.value.results?.find((k) => k.name.toLowerCase() === name)?.id ?? null) : r),
  );
  keywordIds.set(name, lookup);
  void lookup.then((r) => {
    if (!r.ok || r.value == null) keywordIds.delete(name);
  });
  return lookup;
}

const today = () => new Date().toISOString().slice(0, 10);

function provider(slug: Slug): Provider {
  const side: Side = slug === "tmdb-movie" ? "movie" : "tv";
  const kind: MediaKind = side === "movie" ? "movie" : "series";
  const supported = (g: string) => g in GENRE_ID[side] || g in GENRE_KEYWORD[side] || (side === "tv" && g === ASIAN_DRAMA);

  async function discover(order: "popular" | "recent", genre: string | null, page: number): Promise<Result<Page>> {
    const filter: Query = {};
    // A country filter, not a genre: plain Series is every show, from anywhere.
    if (side === "tv" && genre === ASIAN_DRAMA) {
      filter.with_origin_country = dramaCountries().join("|");
      filter.without_genres = ANIMATION;
    } else if (genre && genre in GENRE_ID[side]) filter.with_genres = GENRE_ID[side][genre];
    else if (genre) {
      const k = await keywordId(GENRE_KEYWORD[side][genre]);
      if (!k.ok) return k;
      // The keyword search found nothing by that name: an honest empty page.
      if (!k.value) return Ok({ items: [], hasMore: false });
      filter.with_keywords = k.value;
    }
    const movie = side === "movie";
    const r = await get<List>(`/discover/${side}`, {
      page,
      sort_by: order === "popular" ? "popularity.desc" : movie ? "primary_release_date.desc" : "first_air_date.desc",
      ...(order === "recent" && {
        [movie ? "primary_release_date.lte" : "first_air_date.lte"]: today(),
        "vote_count.gte": movie ? 20 : 5,
      }),
      ...(movie && { include_adult: false }),
      ...filter,
    });
    if (!r.ok) return r;
    // TMDB stops serving past page 500.
    return Ok({ items: (r.value.results ?? []).map((m) => shape(m, slug)), hasMore: page < Math.min(r.value.total_pages ?? 0, 500) });
  }

  return {
    slug,
    name: "TMDB",
    kinds: [kind],
    enabled: () => Boolean(apiKey()),

    async fetchTitle(k, id) {
      if (k !== kind) return Err(`TMDB (${side}) does not serve ${k}.`);
      const r = await get<Raw>(`/${side}/${id}`, side === "tv" ? { append_to_response: "external_ids" } : {});
      return r.ok ? Ok(shape(r.value, slug)) : r;
    },

    async search(query: string): Promise<Result<SearchData>> {
      const r = await get<List>(`/search/${side}`, { query, include_adult: false });
      if (!r.ok) return r;
      const found = (r.value.results ?? []).slice(0, 8).map((m) => shape(m, slug));
      return Ok({ anime: [], manga: [], novels: [], movies: side === "movie" ? found : [], series: side === "tv" ? found : [] });
    },

    browse: (_k, genre, page, taste) => browseWith(discover, genre, page, taste, supported),
  };
}

export const tmdbMovie = provider("tmdb-movie");
export const tmdbTv = provider("tmdb-tv");

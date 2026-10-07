import { Err, Ok, type Result } from "../result.ts";
import {
  clean,
  type Media,
  type MediaKind,
  type Provider,
  type SearchData,
} from "../media.ts";
import { browseWith, type Page } from "./shared.ts";

/**
 * Stremio's Cinemeta: keyless IMDb-backed catalogs. This is *metadata only*; the
 * streams come from whatever addons the user installed, never from here.
 */
const BASE = "https://v3-cinemeta.strem.io";
const PAGE = 50;

/** `tt0111161` -> 111161. IMDb ids are always at least 7 digits, so this is lossless. */
export function imdbToId(imdb: string): number | null {
  const n = Number(/^tt(\d{1,10})$/.exec(imdb.trim())?.[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 111161 -> `tt0111161`; 8-digit ids (`tt10838180`) pass through unpadded. */
export const idToImdb = (id: number) => `tt${String(id).padStart(7, "0")}`;

/** One episode of a series. Season 0 is specials. */
export type SeriesEpisode = {
  season: number;
  episode: number;
  title: string | null;
  /** ISO timestamp; absent for unaired episodes with no date. */
  released: string | null;
  thumbnail: string | null;
  overview: string | null;
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Cinemeta's `videos[]` -> episodes, sorted by (season, episode) with duplicate
 * pairs dropped. Unaired entries are kept: the caller decides what "available" means.
 */
export function parseSeriesVideos(raw: unknown): SeriesEpisode[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SeriesEpisode[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const season = Number(r.season);
    const episode = Number(r.episode ?? r.number);
    if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 0 || episode < 0) continue;
    const key = `${season}:${episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      season,
      episode,
      title: text(r.name ?? r.title),
      released: text(r.released ?? r.firstAired),
      thumbnail: text(r.thumbnail),
      overview: text(r.overview ?? r.description),
    });
  }
  return out.sort((a, b) => a.season - b.season || a.episode - b.episode);
}

type RawMeta = {
  id?: string;
  imdb_id?: string;
  name?: string;
  description?: string;
  genres?: string[];
  genre?: string[];
  imdbRating?: string;
  poster?: string;
  background?: string;
  runtime?: string;
  year?: string;
  releaseInfo?: string;
  language?: string;
  country?: string;
  videos?: unknown;
};

/** "142 min", "2h 22min", "40-50 min" -> minutes (first figure of a range). */
function minutesOf(raw: string | undefined): number | null {
  const h = Number(/(\d+)\s*h/i.exec(raw ?? "")?.[1] ?? 0);
  const m = Number(/(\d+)\s*(?:min|m\b)/i.exec(raw ?? "")?.[1] ?? 0);
  const total = h * 60 + m;
  return total > 0 ? total : null;
}

const genreName = (g: string) => (g === "Sport" ? "Sports" : g);

function shape(m: RawMeta, kind: MediaKind): Media | null {
  const imdb = [m.imdb_id, m.id].find((x): x is string => typeof x === "string" && /^tt\d+$/.test(x));
  const id = imdb ? imdbToId(imdb) : null;
  if (!imdb || !id || !m.name) return null;
  const rating = Number(m.imdbRating);
  const aired = kind === "series" ? parseSeriesVideos(m.videos).filter((e) => e.season > 0).length : 0;
  return {
    id,
    via: "cinemeta",
    kind,
    title: m.name,
    // Lists carry the small poster; the medium one is still ~70 KB.
    cover: m.poster?.replace("/poster/small/", "/poster/medium/") ?? null,
    banner: m.background ?? null,
    color: null,
    description: clean(m.description),
    genres: (m.genres ?? m.genre ?? []).map(genreName),
    units: kind === "movie" ? 1 : aired || null,
    unitLabel: kind === "movie" ? "movie" : "episodes",
    unitMinutes: minutesOf(m.runtime),
    score: rating > 0 ? Math.round(rating * 10) : null,
    imdb,
    year: Number(/\d{4}/.exec(m.year ?? m.releaseInfo ?? "")?.[0]) || null,
    // Cinemeta usually sends only the country of origin; `nativeLang` reads either.
    language: text(m.language) ?? text(m.country),
  };
}

async function getJson<T>(path: string): Promise<Result<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return Err(`Cinemeta returned ${res.status}.`);
    return Ok((await res.json()) as T);
  } catch (e) {
    return Err(e instanceof Error ? e.message : "Could not reach Cinemeta.");
  }
}

const typeOf = (kind: MediaKind) => (kind === "movie" ? "movie" : "series");

function catalog(type: string, id: string, extra: Record<string, string | number> = {}): string {
  const e = Object.entries(extra)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `/catalog/${type}/${id}${e ? `/${e}` : ""}.json`;
}

/** Shapes a catalog. Series are every show, animation included: it is not kept for anime alone. */
function items(metas: RawMeta[] | undefined, kind: MediaKind): Media[] {
  return (metas ?? []).map((m) => shape(m, kind)).filter((m): m is Media => m != null);
}

/** What the browse genre chips mean in Cinemeta's catalog. */
const GENRES = new Set(["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Sports"]);

async function page(kind: MediaKind, order: "popular" | "recent", genre: string | null, n: number): Promise<Result<Page>> {
  const type = typeOf(kind);
  // Recently added is the "New" catalog for this year; it takes a year in place of a genre.
  const path =
    order === "recent"
      ? catalog(type, "year", { genre: new Date().getFullYear() })
      : catalog(type, "top", {
          ...(genre ? { genre: genre === "Sports" ? "Sport" : genre } : {}),
          ...(n > 1 ? { skip: (n - 1) * PAGE } : {}),
        });
  const r = await getJson<{ metas?: RawMeta[]; hasMore?: boolean }>(path);
  if (!r.ok) return r;
  let list = items(r.value.metas, kind);
  if (order === "recent" && genre) list = list.filter((m) => m.genres.includes(genre));
  return Ok({ items: list, hasMore: Boolean(r.value.hasMore) });
}

export const cinemeta: Provider = {
  slug: "cinemeta",
  name: "Cinemeta",
  kinds: ["movie", "series"],

  async fetchTitle(kind, id) {
    if (kind !== "movie" && kind !== "series") return Err(`Cinemeta does not serve ${kind}.`);
    const r = await getJson<{ meta?: RawMeta }>(`/meta/${typeOf(kind)}/${idToImdb(id)}.json`);
    if (!r.ok) return r;
    // An unknown id (or one of the other type) comes back 200 with a meta that has no name.
    const media = r.value.meta ? shape(r.value.meta, kind) : null;
    return media ? Ok(media) : Err("Cinemeta has no title with that id.");
  },

  async search(query: string, kinds?: readonly MediaKind[]): Promise<Result<SearchData>> {
    // A hidden category costs no request: its catalog is simply not asked.
    const ask = (type: "movie" | "series", kind: MediaKind) =>
      !kinds || kinds.includes(kind)
        ? getJson<{ metas?: RawMeta[] }>(catalog(type, "top", { search: query }))
        : Promise.resolve(Ok<{ metas?: RawMeta[] }>({}));
    const [movies, series] = await Promise.all([ask("movie", "movie"), ask("series", "series")]);
    if (!movies.ok) return movies;
    if (!series.ok) return series;
    return Ok({
      anime: [],
      manga: [],
      novels: [],
      movies: items(movies.value.metas, "movie").slice(0, 8),
      series: items(series.value.metas, "series").slice(0, 8),
    });
  },

  browse: (kind, genre, n, taste) =>
    browseWith((order, g, p) => page(kind, order, g, p), genre, n, taste, (g) => GENRES.has(g)),
};

/** Episodes of a series by its full IMDb id: the series chapter list's source. */
export async function fetchSeriesEpisodes(imdb: string): Promise<Result<SeriesEpisode[]>> {
  if (!/^tt\d+$/.test(imdb)) return Err("That is not an IMDb id.");
  const r = await getJson<{ meta?: RawMeta }>(`/meta/series/${imdb}.json`);
  return r.ok ? Ok(parseSeriesVideos(r.value.meta?.videos)) : r;
}

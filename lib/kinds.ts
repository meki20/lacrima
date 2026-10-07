import { GENRES, MEDIA_KINDS, type MediaKind } from "./media.ts";

export type VideoKind = "anime" | "movie" | "series";

export type KindInfo = {
  /** Sentence-case plural, as shown in nav, chips and settings. */
  label: string;
  /** One quiet line under the label in settings. */
  blurb: string;
  /** Browse page. Not the title or reader route, which stay `/title/{via}/{kind}/{id}`. */
  route: string;
  /** Watched rather than read: plays through the stream pipeline, anchored in seconds. */
  video: boolean;
  /** Singular unit noun. */
  unitWord: string;
  /** Has a metadata franchise graph (seasons/parts as separate entries) to collapse. */
  franchise: boolean;
  /** Genre chips for the browse page. */
  genres: readonly string[];
};

// Live-action has no Slice of Life or Supernatural shelf worth browsing.
const VIDEO_GENRES = GENRES.filter((g) => g !== "Slice of Life" && g !== "Supernatural");

/** Drama is a subcategory of Series, so it leads the chips instead of sitting alphabetically. */
const SERIES_GENRES = ["Drama", ...VIDEO_GENRES.filter((g) => g !== "Drama")];

/**
 * A Series chip that is a country filter rather than a genre: scripted live action
 * from `LACRIMA_DRAMA_COUNTRIES`. Only TMDB has origin-country data, so `browseGenres`
 * offers it only while TMDB is on.
 */
export const ASIAN_DRAMA = "Asian drama";

export const KIND_INFO: Record<MediaKind, KindInfo> = {
  anime: { label: "Anime", blurb: "Series and films, watched from your video sources", route: "/anime", video: true, unitWord: "episode", franchise: true, genres: GENRES },
  manga: { label: "Manga", blurb: "Chapters read from your manga sources", route: "/manga", video: false, unitWord: "chapter", franchise: true, genres: GENRES },
  novel: { label: "Novels", blurb: "Light and web novels, read in the app", route: "/novels", video: false, unitWord: "chapter", franchise: true, genres: GENRES },
  movie: { label: "Movies", blurb: "Feature films from your video sources", route: "/movies", video: true, unitWord: "movie", franchise: false, genres: VIDEO_GENRES },
  series: { label: "Series", blurb: "Shows and dramas from your video sources", route: "/series", video: true, unitWord: "episode", franchise: false, genres: SERIES_GENRES },
};

export const isVideoKind = (kind: string): kind is VideoKind => {
  const k = parseKind(kind);
  return k != null && KIND_INFO[k].video;
};

/**
 * No franchise graph (movies, series): titles never fold into one another, and
 * "Part 2" or "(2021)" is part of the name. Tolerates a stray value read from the db.
 */
export const isStandalone = (kind: MediaKind): boolean => KIND_INFO[kind]?.franchise === false;

/**
 * Trust-boundary check: the kind, or null when `raw` isn't one of the five. Series
 * began life as "drama"; old rows, bookmarks, backups and settings still say so,
 * and read as "series".
 */
export function parseKind(raw: unknown): MediaKind | null {
  if (raw === "drama") return "series";
  return typeof raw === "string" && (MEDIA_KINDS as readonly string[]).includes(raw)
    ? (raw as MediaKind)
    : null;
}

/**
 * Hidden categories from a comma list (the column) or an array (the API).
 * Strict: null when anything isn't a known kind, so a write can reject typos
 * while a read decides for itself what to do with a bad value.
 */
export function parseHidden(raw: unknown): MediaKind[] | null {
  const parts = typeof raw === "string" ? raw.split(",").filter(Boolean) : raw;
  if (!Array.isArray(parts)) return null;
  const kinds: MediaKind[] = [];
  for (const p of parts) {
    const k = parseKind(typeof p === "string" ? p.trim() : p);
    if (!k) return null;
    kinds.push(k);
  }
  return normalizeHidden(kinds);
}

/**
 * Deduped, in nav order. Hiding everything is meaningless (an app with no
 * categories), so all-hidden becomes "nothing hidden".
 */
export function normalizeHidden(kinds: readonly MediaKind[]): MediaKind[] {
  const hidden = MEDIA_KINDS.filter((k) => kinds.includes(k));
  return hidden.length === MEDIA_KINDS.length ? [] : hidden;
}

/**
 * The hidden list after flipping `kind`. Refuses to hide the last visible
 * category (returns the list unchanged) rather than normalising to "show all",
 * which would silently turn everything else back on.
 */
export function toggleKind(hidden: readonly MediaKind[], kind: MediaKind): MediaKind[] {
  const next = hidden.includes(kind) ? hidden.filter((k) => k !== kind) : [...hidden, kind];
  return normalizeHidden(MEDIA_KINDS.every((k) => next.includes(k)) ? hidden : next);
}

/** What the profile sees. Falls back to everything if a stored value hides it all. */
export function visibleKinds(hidden: readonly MediaKind[]): MediaKind[] {
  const shown = MEDIA_KINDS.filter((k) => !hidden.includes(k));
  return shown.length ? shown : [...MEDIA_KINDS];
}

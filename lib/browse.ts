import { KIND_INFO } from "./kinds.ts";
import { MEDIA_KINDS, type HomePage, type Media, type MediaKind, type SearchData } from "./media.ts";

/**
 * Pure logic behind the browse surfaces (nav, search groups, home hero, source chip).
 * Each takes the list of kinds to show, so hiding a category is a single
 * `visibleKinds()` filter at the call site.
 */

export type NavEntry = { label: string; href: string; kind: MediaKind | null };

/** Home, one entry per category in `kinds` (in `MEDIA_KINDS` order), Yours. */
export function navEntries(kinds: readonly MediaKind[] = MEDIA_KINDS): NavEntry[] {
  return [
    { label: "Home", href: "/", kind: null },
    ...MEDIA_KINDS.filter((k) => kinds.includes(k)).map((k) => ({
      label: KIND_INFO[k].label,
      href: KIND_INFO[k].route,
      kind: k,
    })),
    { label: "Yours", href: "/yours", kind: null },
  ];
}

/** Which `SearchData` list each kind fills. */
const FIELD = {
  anime: "anime",
  manga: "manga",
  novel: "novels",
  movie: "movies",
  series: "series",
} as const satisfies Record<MediaKind, keyof SearchData>;

export type SearchGroup = { kind: MediaKind; title: string; items: Media[] };

export function searchGroups(data: SearchData, kinds: readonly MediaKind[] = MEDIA_KINDS): SearchGroup[] {
  return MEDIA_KINDS.filter((k) => kinds.includes(k)).map((kind) => ({
    kind,
    title: KIND_INFO[kind].label,
    items: data[FIELD[kind]],
  }));
}

/** "Movies", "Movies and series", "Anime, manga and novels": sentence case, no Oxford comma. */
export function kindList(kinds: readonly MediaKind[]): string {
  const names = kinds.map((k, i) => (i === 0 ? KIND_INFO[k].label : KIND_INFO[k].label.toLowerCase()));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/**
 * The billboard: the feed's own hero, else the first title with art from the first
 * rail that has one. Only the anime-family feed supplies a hero, so a profile that
 * hides anime, or a feed that came back thin, still opens on something.
 */
export function pickHero(data: HomePage, kinds: readonly MediaKind[] = MEDIA_KINDS): Media | null {
  if (data.hero && kinds.includes(data.hero.kind)) return data.hero;
  const rails: [MediaKind, Media[]][] = [
    ["anime", data.popularAnime],
    ["movie", data.popularMovies],
    ["series", data.popularSeries],
    ["manga", data.popularManga],
    ["novel", data.novels],
  ];
  for (const [kind, items] of rails) {
    if (!kinds.includes(kind)) continue;
    const hit = items.find((m) => m.banner ?? m.cover);
    if (hit) return hit;
  }
  return null;
}

/** Anime, manga and novels (and the anime-only "for you" rail) all come from one provider feed. */
const FEED_KINDS: readonly MediaKind[] = ["anime", "manga", "novel"];

/**
 * What Home has to ask for given the visible kinds: the shared feed only while one of
 * its three kinds is visible, plus a rail per visible video kind. Hidden means not fetched.
 */
export function homeNeeds(kinds: readonly MediaKind[]): { feed: boolean; rails: ("movie" | "series")[] } {
  return {
    feed: FEED_KINDS.some((k) => kinds.includes(k)),
    rails: (["movie", "series"] as const).filter((k) => kinds.includes(k)),
  };
}

/** The feed with hidden kinds' rails emptied (a `Rail` renders nothing when empty) and no hero from a hidden kind. */
export function gateHome(d: HomePage, kinds: readonly MediaKind[]): HomePage {
  const on = (k: MediaKind) => kinds.includes(k);
  return {
    hero: d.hero && on(d.hero.kind) ? d.hero : null,
    popularAnime: on("anime") ? d.popularAnime : [],
    forYou: on("anime") ? d.forYou : [],
    popularManga: on("manga") ? d.popularManga : [],
    novels: on("novel") ? d.novels : [],
    popularMovies: on("movie") ? d.popularMovies : [],
    popularSeries: on("series") ? d.popularSeries : [],
  };
}

/** Rows (library items, continue items) of the visible kinds. Stored data is untouched; this only decides what shows. */
export const keepKinds = <T extends { kind: MediaKind }>(rows: readonly T[], kinds: readonly MediaKind[]): T[] =>
  rows.filter((r) => kinds.includes(r.kind));

/** "3 manga · 2 video · 1 novels" for the source chip: movie and series sources are video sources. */
export function sourceSummary(kinds: readonly MediaKind[]): string {
  const n = (...of: MediaKind[]) => kinds.filter((k) => of.includes(k)).length;
  return (
    [
      [n("manga"), "manga"],
      [n("anime", "movie", "series"), "video"],
      [n("novel"), "novels"],
    ] as const
  )
    .filter(([c]) => c > 0)
    .map(([c, label]) => `${c} ${label}`)
    .join(" · ");
}

/** Same titles in the same order: a "recommended" rail a provider filled from its popular list. */
export const sameTitles = (a: readonly Media[], b: readonly Media[]): boolean =>
  a.length > 0 && a.length === b.length && a.every((m, i) => m.id === b[i].id && m.via === b[i].via);

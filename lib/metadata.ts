import { Err, Ok, type Result } from "./result.ts";
import {
  MEDIA_KINDS,
  type BrowseData,
  type HomeData,
  type HomePage,
  type Media,
  type MediaKind,
  type Provider,
  type ProviderSlug,
  type SearchData,
} from "./media.ts";
import { ASIAN_DRAMA, KIND_INFO, parseKind } from "./kinds.ts";
import { anilist } from "./providers/anilist.ts";
import { cinemeta } from "./providers/cinemeta.ts";
import { jikan } from "./providers/jikan.ts";
import { kitsu } from "./providers/kitsu.ts";
import { tmdbMovie, tmdbTv } from "./providers/tmdb.ts";
import { collapseBrowse, collapseHome, collapseSearch } from "./series.ts";

/**
 * Every provider, in fallback order *within each kind* (see `providersFor`).
 * AniList is richer (tags, relations) so it leads the anime family, but it
 * was fully disabled upstream during development — "temporarily disabled due to
 * severe stability issues" — and Jikan started returning 504s in the same hour,
 * which is exactly why discovery must not depend on any single provider.
 * TMDB leads movies and series when keyed; keyless Cinemeta is the floor.
 * Add providers here; nothing else changes.
 */
export const PROVIDERS: Provider[] = [anilist, jikan, kitsu, tmdbMovie, tmdbTv, cinemeta];

/**
 * The chain for one kind: providers that serve it, in `PROVIDERS` order, minus any
 * that are switched off (TMDB without a key). Leaving a disabled provider out, rather
 * than letting it fail, is what keeps the first remaining one from reading as degraded.
 */
export const providersFor = (kind: MediaKind, providers: Provider[] = PROVIDERS): Provider[] =>
  providers.filter((p) => p.kinds.includes(kind) && p.enabled?.() !== false);

/**
 * `failed` lists kinds whose chain died while others were served, so a page can say
 * so instead of rendering a quietly empty rail. Total failure is an `Err`, not this.
 */
export type Served<T> = { data: T; via: string; degraded: boolean; failed?: MediaKind[] };

/** Tries each provider in order; the first success wins. Exported for testing. */
export async function walk<T>(
  providers: Provider[],
  run: (p: Provider) => Promise<Result<T>>,
): Promise<Result<Served<T>>> {
  if (!providers.length) return Err("No metadata providers configured.");

  const results: (Result<T> | undefined)[] = providers.map(() => undefined);
  const failures: string[] = [];

  return await new Promise((resolve) => {
    let closed = false;
    const finish = (r: Result<Served<T>>) => {
      if (closed) return;
      closed = true;
      resolve(r);
    };
    const consider = () => {
      for (let i = 0; i < providers.length; i++) {
        const r = results[i];
        if (!r) return;
        if (r.ok) {
          finish({ ok: true, value: { data: r.value, via: providers[i].name, degraded: i > 0 } });
          return;
        }
        failures[i] = `${providers[i].name}: ${r.reason}`;
      }
      finish(Err(`Every metadata provider failed. ${failures.filter(Boolean).join(" ")}`));
    };

    for (const [i, p] of providers.entries()) {
      run(p)
        .catch((e): Result<T> => Err(e instanceof Error ? e.message : "failed"))
        .then((r) => {
          results[i] = r;
          consider();
        });
    }
  });
}

export const chain = (providers: Provider[], genre: string) =>
  walk<HomeData>(providers, (p) => p.fetchHome?.(genre) ?? Promise.resolve(Err<HomeData>(`${p.name} has no home feed.`)));

const META_TTL = 10 * 60_000;
const TITLE_TTL = 30 * 60_000;
const MEMO_MAX = 300;
const memo = new Map<string, { at: number; v: unknown }>();
const running = new Map<string, Promise<unknown>>();

/** Test seam: forget everything served so far. */
export function resetMetadataCache() {
  memo.clear();
  running.clear();
}

function succeeded(v: unknown) {
  return Boolean(v && typeof v === "object" && "ok" in v && (v as { ok: boolean }).ok);
}

/** One request per key at a time, so a burst of navigations is still one fetch. */
function refresh<T>(key: string, run: () => Promise<T>): Promise<T> {
  const live = running.get(key) as Promise<T> | undefined;
  if (live) return live;
  const p = run().then((v) => {
    if (succeeded(v)) {
      if (!memo.has(key) && memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value!);
      memo.set(key, { at: Date.now(), v });
    }
    return v;
  });
  running.set(key, p);
  void p.catch(() => undefined).finally(() => running.delete(key));
  return p;
}

/**
 * Serve what we have, refresh behind it.
 *
 * A browse page is four to six Kitsu calls and the slowest decides — measured at
 * 2.2s to 3.6s. Expiring the entry meant the *user* paid that latency again, with
 * a blank screen, every ten minutes. Nothing on these pages is time-critical:
 * "popular this week" being a few minutes stale is invisible, and a page that
 * still renders while the provider is down is the behaviour this app already
 * wants everywhere else.
 */
function cached<T>(key: string, ttl: number, run: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (!hit) return refresh(key, run);
  if (Date.now() - hit.at >= ttl) void refresh(key, run).catch(() => undefined);
  return Promise.resolve(hit.v as T);
}

/** Movie and series rails: their own chains, so a dead one never takes the anime feed with it. */
export type VideoRail = "movie" | "series";

/**
 * The anime-family feed plus a popular rail per `rails` entry. The feed decides success
 * (as before); a dead movie or series chain just lands in `failed` with an empty rail.
 * `feed: false` skips the feed (a profile that hides anime, manga and novels): then the
 * rails decide instead, and every one dying is an `Err`.
 */
export const fetchHome = (genre: string, rails: readonly VideoRail[] = ["movie", "series"], withFeed = true) =>
  cached(`home|${genre}|${rails.join()}|${withFeed}`, META_TTL, async (): Promise<Result<Served<HomePage>>> => {
    const [feed, ...video] = await Promise.all([
      withFeed
        ? chain(providersFor("anime"), genre)
        : Promise.resolve(Ok<Served<HomeData>>({ data: { hero: null, popularAnime: [], popularManga: [], novels: [], forYou: [] }, via: "", degraded: false })),
      ...rails.map((k) => fetchBrowse(k, null, 1, [])),
    ]);
    if (!feed.ok) return feed;
    const first = video[0];
    if (!withFeed && first && !first.ok && video.every((r) => !r.ok)) return Err(first.reason, first.lastSuccess);
    const popular = (k: VideoRail) => {
      const r = video[rails.indexOf(k)];
      return r?.ok ? r.value.data.popular : [];
    };
    const failed = rails.filter((_, i) => !video[i].ok);
    return Ok({
      ...feed.value,
      data: { ...collapseHome(feed.value.data), popularMovies: popular("movie"), popularSeries: popular("series") },
      ...(failed.length ? { failed } : {}),
    });
  });

/** Which `SearchData` list each kind fills. */
const FIELD = {
  anime: "anime",
  manga: "manga",
  novel: "novels",
  movie: "movies",
  series: "series",
} as const satisfies Record<MediaKind, keyof SearchData>;

/** Kinds that one provider call answers: AniList/Jikan/Kitsu search all three at once. */
const SEARCH_CHAINS: MediaKind[][] = [["anime", "manga", "novel"], ["movie"], ["series"]];

/**
 * Walks each requested kind's chain separately and merges. One chain dying fills
 * `failed` (its kinds); only every chain dying is an `Err`. `kinds` lets a caller
 * skip the fetch for categories a profile has hidden.
 */
export async function fetchSearch(
  query: string,
  kinds: readonly MediaKind[] = MEDIA_KINDS,
): Promise<Result<Served<SearchData>>> {
  const asked = SEARCH_CHAINS.map((g) => g.filter((k) => kinds.includes(k))).filter((g) => g.length);
  const data: SearchData = { anime: [], manga: [], novels: [], movies: [], series: [] };
  if (!asked.length) return Ok({ data, via: "", degraded: false });

  // Both video chains can end in Cinemeta, which answers movies and series in one go.
  const runs = new Map<Provider, Promise<Result<SearchData>>>();
  const search = (p: Provider) => {
    if (!runs.has(p)) runs.set(p, p.search(query, kinds));
    return runs.get(p)!;
  };
  const served = await Promise.all(asked.map((g) => walk<SearchData>(providersFor(g[0]), search)));

  const failed: MediaKind[] = [];
  const reasons: string[] = [];
  const ok: Served<SearchData>[] = [];
  served.forEach((r, i) => {
    if (!r.ok) {
      failed.push(...asked[i]);
      reasons.push(r.reason);
      return;
    }
    ok.push(r.value);
    for (const k of asked[i]) data[FIELD[k]] = r.value.data[FIELD[k]];
  });
  if (!ok.length) return Err(reasons.join(" "));

  // The banner names the provider that stood in, so lead with a degraded chain if any.
  const lead = ok.find((s) => s.degraded) ?? ok[0];
  return Ok({
    data: collapseSearch(data),
    via: lead.via,
    degraded: lead.degraded,
    ...(failed.length ? { failed } : {}),
  });
}

/**
 * The chips on a kind's browse page: its genres, plus "Asian drama" right after Drama
 * under Series while TMDB is on. Only TMDB has origin-country data, so without a key
 * there is no such chip, rather than a dead one.
 */
export function browseGenres(kind: MediaKind, providers: Provider[] = PROVIDERS): readonly string[] {
  const { genres } = KIND_INFO[kind];
  return kind === "series" && providersFor(kind, providers).some((p) => p.slug === "tmdb-tv")
    ? genres.flatMap((g) => (g === "Drama" ? [g, ASIAN_DRAMA] : [g]))
    : genres;
}

export function fetchBrowse(kind: MediaKind, genre: string | null, page: number, taste: string[]) {
  const providers = providersFor(kind);
  // The chain is part of the key: the same page served by a different set of providers is a different answer.
  const key = `browse|${kind}|${providers.map((p) => p.slug).join()}|${genre ?? ""}|${page}|${taste.join(",")}`;
  return cached(key, META_TTL, () =>
    walk<BrowseData>(providers, (p) => p.browse(kind, genre, page, taste)).then((r) =>
      r.ok ? { ...r, value: { ...r.value, data: collapseBrowse(r.value.data) } } : r,
    ),
  );
}

/**
 * No fallback chain here on purpose: `id` was minted by one specific provider,
 * so asking a different one would return a different title entirely.
 */
export async function fetchTitle(via: ProviderSlug, kind: MediaKind, id: number) {
  const p = PROVIDERS.find((x) => x.slug === via);
  if (!p) return Err<Media>(`Unknown metadata provider "${via}".`);
  if (!p.kinds.includes(kind)) return Err<Media>(`${p.name} does not serve ${kind}.`);
  return cached(`title|${via}|${kind}|${id}`, TITLE_TTL, () => p.fetchTitle(kind, id));
}

/**
 * Trust-boundary check for `/title/{via}/{kind}/{id}` and `/read/...`: a known
 * provider that serves this kind, and a positive integer id. Null means "no such
 * page" - a 404, not a provider error - so `/title/kitsu/movie/1` never reaches a fetch.
 */
export function parseTitleRoute(
  via: string,
  kind: string,
  id: string,
): { via: ProviderSlug; kind: MediaKind; id: number } | null {
  const k = parseKind(kind);
  const p = PROVIDERS.find((x) => x.slug === via);
  const n = /^\d+$/.test(id) ? Number(id) : 0;
  return k && p?.kinds.includes(k) && Number.isSafeInteger(n) && n > 0 ? { via: p.slug, kind: k, id: n } : null;
}

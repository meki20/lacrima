import { Err, type Result } from "./result.ts";
import type { BrowseData, HomeData, Media, MediaKind, Provider, ProviderSlug, SearchData } from "./media.ts";
import { anilist } from "./providers/anilist.ts";
import { jikan } from "./providers/jikan.ts";
import { kitsu } from "./providers/kitsu.ts";
import { collapseBrowse, collapseHome, collapseSearch } from "./series.ts";

/**
 * Ordered fallback chain. AniList is richer (tags, relations) so it leads, but it
 * was fully disabled upstream during development — "temporarily disabled due to
 * severe stability issues" — and Jikan started returning 504s in the same hour,
 * which is exactly why discovery must not depend on any single provider.
 * Add providers here; nothing else changes.
 */
export const PROVIDERS: Provider[] = [anilist, jikan, kitsu];

export type Served<T> = { data: T; via: string; degraded: boolean };

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
  walk<HomeData>(providers, (p) => p.fetchHome(genre));

const META_TTL = 10 * 60_000;
const TITLE_TTL = 30 * 60_000;
const MEMO_MAX = 300;
const memo = new Map<string, { at: number; v: unknown }>();
const running = new Map<string, Promise<unknown>>();

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

export const fetchHome = (genre: string) =>
  cached(`home|${genre}`, META_TTL, () =>
    chain(PROVIDERS, genre).then((r) =>
      r.ok ? { ...r, value: { ...r.value, data: collapseHome(r.value.data) } } : r,
    ),
  );

export const fetchSearch = (query: string) =>
  walk<SearchData>(PROVIDERS, (p) => p.search(query)).then((r) =>
    r.ok ? { ...r, value: { ...r.value, data: collapseSearch(r.value.data) } } : r,
  );

export const fetchBrowse = (
  kind: MediaKind,
  genre: string | null,
  page: number,
  taste: string[],
) =>
  cached(`browse|${kind}|${genre ?? ""}|${page}|${taste.join(",")}`, META_TTL, () =>
    walk<BrowseData>(PROVIDERS, (p) => p.browse(kind, genre, page, taste)).then((r) =>
      r.ok ? { ...r, value: { ...r.value, data: collapseBrowse(r.value.data) } } : r,
    ),
  );

/**
 * No fallback chain here on purpose: `id` was minted by one specific provider,
 * so asking a different one would return a different title entirely.
 */
export async function fetchTitle(via: ProviderSlug, kind: MediaKind, id: number) {
  const p = PROVIDERS.find((x) => x.slug === via);
  if (!p) return Err<Media>(`Unknown metadata provider "${via}".`);
  return cached(`title|${via}|${kind}|${id}`, TITLE_TTL, () => p.fetchTitle(kind, id));
}

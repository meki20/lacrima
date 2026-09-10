/**
 * The same anime in every id namespace a Stremio addon might speak.
 *
 * An IMDB id is a *work* id, not an anime id: `tt0388629` is One Piece the anime,
 * the 2023 live action, the specials and every spin-off, all at once. Ask a torrent
 * addon with it and live-action files come back as legitimate answers — no filename
 * heuristic can undo that, because the addon answered the question we asked.
 * `kitsu:12` cannot return live action; the namespace is the filter.
 *
 * Never guess a mapping. A wrong id does not fail — it silently returns a different
 * show (Kitsu 46270 is not Frieren, it is Noumin Kanren no Skill), which is worse
 * than no answer at all.
 */
import type { ProviderSlug } from "./media.ts";

export type AnimeIds = { anilist?: number; mal?: number; kitsu?: number };

/** The id we already hold, for free: every provider mints its own namespace. */
export function nativeIds(via?: string, mediaId?: number): AnimeIds {
  if (!mediaId || !Number.isFinite(mediaId)) return {};
  switch (via as ProviderSlug) {
    case "kitsu":
      return { kitsu: mediaId };
    case "anilist":
      return { anilist: mediaId };
    // Jikan *is* MyAnimeList: its ids are MAL ids.
    case "jikan":
      return { mal: mediaId };
    default:
      return {};
  }
}

const KEY: Record<keyof AnimeIds, string> = {
  anilist: "anilist_id",
  mal: "mal_id",
  kitsu: "kitsu_id",
};

/*
 * Mappings are immutable facts, so this never expires inside a process.
 * ponytail: in-process Map, no persistence — a restart re-fetches one small
 * JSON per title. Move it into the DB only if cold starts measurably hurt.
 */
const cache = new Map<string, AnimeIds>();
const inflight = new Map<string, Promise<AnimeIds>>();

/*
 * A failed lookup is remembered too, briefly.
 *
 * Without this, an ani.zip outage costs the timeout again on every title the user
 * opens — on the render path — while still ending in the same answer it would
 * have given instantly. Short, because the degraded answer reaches fewer addons
 * and should not outlive the outage.
 */
const RETRY_MS = 5 * 60_000;
const failed = new Map<string, number>();

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

async function fromAniZip(key: string, id: number): Promise<AnimeIds> {
  const res = await fetch(`https://api.ani.zip/mappings?${key}=${id}`, {
    signal: AbortSignal.timeout(3_000),
    cache: "no-store",
  });
  if (!res.ok) return {};
  const m = (await res.json()) as { mappings?: Record<string, unknown> };
  const raw = m.mappings ?? {};
  return {
    anilist: num(raw.anilist_id),
    mal: num(raw.mal_id),
    kitsu: num(raw.kitsu_id),
  };
}

/**
 * Every namespace for this title. The provider's own id is always present; the
 * others are filled in best-effort, because a missing mapping must degrade to
 * "ask with fewer ids", never to "fail to play".
 */
export async function animeIds(via?: string, mediaId?: number): Promise<AnimeIds> {
  const native = nativeIds(via, mediaId);
  const entries = Object.entries(native) as [keyof AnimeIds, number][];
  if (!entries.length) return native;

  const [slug, id] = entries[0];
  const key = `${slug}:${id}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const since = failed.get(key);
  if (since != null && Date.now() - since < RETRY_MS) return native;

  let run = inflight.get(key);
  if (!run) {
    run = fromAniZip(KEY[slug], id)
      .then((got) => {
        // The id we were given always wins over the one a mapping service reports.
        const all = { ...got, ...native };
        cache.set(key, all);
        failed.delete(key);
        return all;
      })
      .catch(() => {
        failed.set(key, Date.now());
        return native;
      });
    inflight.set(key, run);
    void run.catch(() => undefined).finally(() => inflight.delete(key));
  }
  return await run;
}

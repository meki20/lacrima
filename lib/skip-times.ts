import { animeIds } from "./anime-ids.ts";
import type { ProviderSlug } from "./media.ts";
import { Err, Ok, type Result } from "./result.ts";

export type SkipType = "op" | "ed" | "mixed-op" | "mixed-ed" | "recap";
export type SkipSegment = { type: SkipType; start: number; end: number };

type RemoteSegment = SkipSegment & { episodeLength: number };

const TYPES = new Set<SkipType>(["op", "ed", "mixed-op", "mixed-ed", "recap"]);
const cache = new Map<string, { at: number; segments: RemoteSegment[] }>();
const CACHE_MS = 24 * 60 * 60_000;

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Timings are advisory facts; do not guess where a cut happened from duration. */
export function adjustSkipTimes(raw: readonly RemoteSegment[]): SkipSegment[] {
  return raw.map(({ type, start, end }) => ({ type, start, end }));
}

function parse(data: unknown): RemoteSegment[] {
  const results = data && typeof data === "object" && "results" in data
    ? (data as { results?: unknown }).results
    : null;
  if (!Array.isArray(results)) return [];
  return results.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as {
      skipType?: unknown;
      interval?: { startTime?: unknown; endTime?: unknown };
      episodeLength?: unknown;
    };
    const type = typeof row.skipType === "string" && TYPES.has(row.skipType as SkipType)
      ? row.skipType as SkipType
      : null;
    const start = number(row.interval?.startTime);
    const end = number(row.interval?.endTime);
    const episodeLength = number(row.episodeLength);
    return type && start != null && end != null && end > start && episodeLength != null
      ? [{ type, start, end, episodeLength }]
      : [];
  });
}

/** Fetch the source's exact timings without inferring an offset for another cut. */
export async function skipTimes(opts: {
  via: ProviderSlug;
  mediaId: number;
  episode: number;
}): Promise<Result<SkipSegment[]>> {
  if (!(opts.episode > 0)) return Ok([]);
  const mal = (await animeIds(opts.via, opts.mediaId)).mal;
  if (!mal) return Ok([]);
  const key = `${mal}:${opts.episode}`;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    const query = new URLSearchParams({ episodeLength: "0" });
    for (const type of TYPES) query.append("types[]", type);
    try {
      const response = await fetch(
        `https://api.aniskip.com/v2/skip-times/${mal}/${opts.episode}?${query}`,
        { cache: "no-store", signal: AbortSignal.timeout(4_000) },
      );
      if (!response.ok) return Err(`AniSkip returned ${response.status}.`);
      hit = { at: Date.now(), segments: parse(await response.json()) };
      cache.set(key, hit);
    } catch {
      return Err("AniSkip is unavailable.");
    }
  }
  return Ok(adjustSkipTimes(hit.segments));
}

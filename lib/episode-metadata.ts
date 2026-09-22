type Episode = {
  number?: number | null;
  canonical_title?: string | null;
  title_en_us?: string | null;
  title_en_jp?: string | null;
  title_ja_jp?: string | null;
};

type MapRecord = { sources?: string[] };

/** Open episode metadata that Animap maps back to Kitsu's stable episode list. */
export function episodeLookup(id: string): { service: "anilist" | "mal" | "kitsu"; id: string } | null {
  const m = /^(anilist|mal|kitsu):(\d+)$/.exec(id);
  return m ? { service: m[1] as "anilist" | "mal" | "kitsu", id: m[2] } : null;
}

const named = new Map<string, Promise<Map<number, string>>>();

/**
 * Source ids stay authoritative for playback; this only supplies missing labels.
 * Animap owns the AniList/MAL/Kitsu crosswalk, so we never guess one from a title.
 */
export function episodeNames(id: string): Promise<Map<number, string>> {
  const lookup = episodeLookup(id);
  if (!lookup) return Promise.resolve(new Map());
  const key = `${lookup.service}:${lookup.id}`;
  let run = named.get(key);
  if (!run) {
    run = load(lookup).catch(() => new Map());
    named.set(key, run);
  }
  return run;
}

async function load(lookup: NonNullable<ReturnType<typeof episodeLookup>>) {
  let kitsuId = lookup.service === "kitsu" ? lookup.id : null;
  if (!kitsuId) {
    const map = (await fetch(`https://animap.id/api/v1/map/${lookup.service}/${lookup.id}`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(4_000),
    }).then((r) => (r.ok ? r.json() : null))) as MapRecord | null;
    kitsuId = map?.sources
      ?.map((source) => /^https:\/\/kitsu\.app\/anime\/(\d+)$/.exec(source)?.[1])
      .find(Boolean) ?? null;
  }
  if (!kitsuId) return new Map<number, string>();

  const json = (await fetch(`https://animap.id/api/kitsu/${kitsuId}/episodes`, {
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(4_000),
  }).then((r) => (r.ok ? r.json() : null))) as { episodes?: Episode[] } | null;

  return new Map(
    (json?.episodes ?? [])
      .map((episode) => [episode.number, episode.title_en_us ?? episode.canonical_title ?? episode.title_en_jp ?? episode.title_ja_jp] as const)
      .filter((episode): episode is readonly [number, string] => Number.isInteger(episode[0]) && Boolean(episode[1])),
  );
}

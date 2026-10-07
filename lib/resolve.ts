import { Ok, type Result } from "./result.ts";
import type { Media } from "./media.ts";
import {
  CONFIDENT,
  WEAK,
  type Binding,
  type Scored,
  getBinding,
  rank,
  searchTitles,
  setBinding,
} from "./match.ts";
import { backend, pickSearchable } from "./sources/index.ts";
import { IMDB_SOURCE, imdbMangaId, servesKind, stremio } from "./sources/stremio.ts";
import type { SourceInfo, SourceManga } from "./sources/types.ts";

export type Resolution = {
  binding: Binding | null;
  /** Ranked alternatives, always available so the user can correct a bad match. */
  candidates: Scored[];
  /** How loudly the UI should talk about the match. See CLAUDE.md, UI patterns. */
  tier: "confident" | "weak" | "none";
  /** Sources that failed during the search, so we can say so instead of showing nothing. */
  failures: string[];
};

/** What we send to sources. A typed query wins; otherwise display + one alias. */
export function sourceQueries(media: Pick<Media, "title" | "aliases">, query?: string | null): string[] {
  const typed = query?.trim();
  if (typed) return [typed];
  // ponytail: one extra name. More queries if sources stay blind after both.
  return searchTitles(media.title, media.aliases).slice(0, 2);
}

/** A movie or series with an IMDb id: addressed by that id, never matched by title. */
export const byImdb = (media: Pick<Media, "kind" | "imdb">): boolean =>
  (media.kind === "movie" || media.kind === "series") && Boolean(media.imdb);

/**
 * A movie or series the metadata chain already knows by IMDb id needs no search:
 * the id is the answer, and any installed addon that serves the kind can be asked
 * for it. So the binding is synthesised from the installed list on every view and
 * never stored — installing or removing an addon takes effect at once. Only a pinned
 * binding outranks it: an unpinned stored one is an old search result (an earlier
 * build searched and stored it), and it must not shadow the id.
 *
 * Null when there is nothing to bind to: not a movie/series, no IMDb id, or no
 * remote source that serves the kind. Null is what makes the page say "no source
 * has this yet" instead of offering a play button that cannot work.
 *
 * `source_id` is `IMDB_SOURCE`, which is not an addon; UI that shows "reading from
 * {source}" must special-case it.
 */
export function imdbBinding(
  media: Pick<Media, "via" | "id" | "kind" | "imdb" | "title">,
  sources: SourceInfo[],
): Binding | null {
  const kind = media.kind;
  if ((kind !== "movie" && kind !== "series") || !media.imdb) return null;
  // Unknown capability (`streams` unset) counts: a manifest we have not read yet is not a "no".
  const served = sources.some((s) => !s.isLocal && s.streams !== false && servesKind(s, kind));
  if (!served) return null;
  return {
    via: media.via,
    media_id: media.id,
    source_id: IMDB_SOURCE,
    source_title: media.title,
    source_manga_id: imdbMangaId(kind, media.imdb),
    confidence: 1,
    bound_at: 0,
    pinned: 0,
    backend: stremio.name.toLowerCase(),
    kind,
  };
}

/**
 * Search installed remote sources of this title's kind and pick the best match.
 * An existing pinned binding always wins — auto-matching must never overwrite a
 * choice the user made by hand.
 *
 * Movies and series with an IMDb id skip the search entirely (see `imdbBinding`).
 * Only an explicit change request searches, and it returns candidates without
 * replacing the synthesised binding: the user picks one, or keeps the default.
 */
export async function resolveSource(
  media: Media,
  research = false,
  query?: string | null,
): Promise<Result<Resolution>> {
  const stored = getBinding(media.via, media.id, media.kind);
  const src = backend(media.kind);
  const known = (b: Binding) =>
    Ok({
      binding: b,
      candidates: [],
      tier: b.pinned || b.confidence >= CONFIDENT ? ("confident" as const) : ("weak" as const),
      failures: [],
    });
  // An unpinned binding on a title the IMDb id addresses is stale: the id wins when an addon serves it.
  const stale = Boolean(stored && !stored.pinned && byImdb(media));

  if (stored && !stale && !research) return known(stored);

  const sources = await src.listSources();
  if (!sources.ok) return stored && !research ? known(stored) : sources;

  const synth = !stored || stale ? imdbBinding(media, sources.value) : null;
  const existing = synth ? undefined : stored;
  if (existing && !research) return known(existing);
  if (synth && !research) {
    return Ok({ binding: synth, candidates: [], tier: "confident", failures: [] });
  }

  const remote = pickSearchable(sources.value, media.kind);
  if (remote.length === 0) {
    return Ok({ binding: existing ?? synth, candidates: [], tier: synth ? "confident" : "none", failures: [] });
  }

  const queries = sourceQueries(media, query);
  const names = searchTitles(media.title, [...(media.aliases ?? []), query ?? ""]);
  const { found, failures } = await searchRemote(src, remote, queries, media.kind);

  const candidates = await withRealCounts(rank(found, names, media.units), media, src, names);
  const best = candidates[0];

  if (existing?.pinned) {
    return Ok({ binding: existing, candidates, tier: "confident", failures });
  }
  if (synth) return Ok({ binding: synth, candidates, tier: "confident", failures });

  if (!best || best.confidence < WEAK) {
    return Ok({ binding: existing ?? null, candidates, tier: "none", failures });
  }

  const binding: Binding = {
    via: media.via,
    media_id: media.id,
    source_id: best.manga.sourceId,
    source_title: best.manga.title,
    source_manga_id: best.manga.id,
    confidence: best.confidence,
    bound_at: Date.now(),
    pinned: 0,
    backend: src.name.toLowerCase(),
    kind: media.kind,
  };
  setBinding(binding);

  return Ok({
    binding,
    candidates,
    tier: best.confidence >= CONFIDENT ? "confident" : "weak",
    failures,
  });
}

async function searchRemote(
  src: ReturnType<typeof backend>,
  remote: SourceInfo[],
  queries: string[],
  kind: Media["kind"],
): Promise<{ found: SourceManga[]; failures: string[] }> {
  const found: SourceManga[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();

  const results = await Promise.all(
    remote.map(async (s) => {
      const rs = await Promise.all(queries.map((q) => src.search(s.id, q, kind)));
      return { s, rs };
    }),
  );

  for (const { s, rs } of results) {
    const ok = rs.filter((r) => r.ok);
    if (ok.length === 0) {
      const fail = rs.find((r) => !r.ok);
      if (fail && !fail.ok) failures.push(`${s.name}: ${fail.reason}`);
      continue;
    }
    for (const r of ok) {
      if (!r.ok) continue;
      for (const m of r.value) {
        const k = `${m.sourceId}:${m.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        found.push(m);
      }
    }
  }
  return { found, failures };
}

async function withRealCounts(
  ranked: Scored[],
  media: Media,
  src: ReturnType<typeof backend>,
  names: string[],
): Promise<Scored[]> {
  const top = ranked.slice(0, 3);
  if (top.length === 0) return ranked;

  const counted = await Promise.all(
    top.map(async (c) => {
      if (c.manga.chapterCount) return c.manga;
      const ch = await src.chapters(c.manga.id);
      return ch.ok ? { ...c.manga, chapterCount: ch.value.length } : c.manga;
    }),
  );

  const rest = ranked.slice(3).map((c) => c.manga);
  return rank([...counted, ...rest], names, media.units);
}

/**
 * What the player uses: a pinned binding, else the synthesised IMDb one for a movie or
 * series, else whatever is stored. The same order as `resolveSource`, so the page and
 * the player agree. Never searches - opening an episode must not pay for a source search.
 */
export async function bindingForPlayback(media: Media): Promise<Binding | null> {
  const stored = getBinding(media.via, media.id, media.kind) ?? null;
  if (stored?.pinned || !byImdb(media)) return stored;
  const sources = await backend(media.kind).listSources();
  return (sources.ok ? imdbBinding(media, sources.value) : null) ?? stored;
}

export async function chaptersFor(binding: Binding, refresh = false) {
  return backend(binding.kind).chapters(binding.source_manga_id, refresh);
}

export function pinBinding(b: Omit<Binding, "bound_at" | "pinned">) {
  setBinding(b, true);
}

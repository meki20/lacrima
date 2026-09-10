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

/**
 * Search installed remote sources of this title's kind and pick the best match.
 * An existing pinned binding always wins — auto-matching must never overwrite a
 * choice the user made by hand.
 */
export async function resolveSource(
  media: Media,
  research = false,
  query?: string | null,
): Promise<Result<Resolution>> {
  const existing = getBinding(media.via, media.id, media.kind);
  const src = backend(media.kind);

  if (existing && !research) {
    return Ok({
      binding: existing,
      candidates: [],
      tier: existing.pinned || existing.confidence >= CONFIDENT ? "confident" : "weak",
      failures: [],
    });
  }

  const sources = await src.listSources();
  if (!sources.ok) return sources;

  const remote = pickSearchable(sources.value);
  if (remote.length === 0) {
    return Ok({ binding: existing ?? null, candidates: [], tier: "none", failures: [] });
  }

  const queries = sourceQueries(media, query);
  const names = searchTitles(media.title, [...(media.aliases ?? []), query ?? ""]);
  const { found, failures } = await searchRemote(src, remote, queries);

  const candidates = await withRealCounts(rank(found, names, media.units), media, src, names);
  const best = candidates[0];

  if (existing?.pinned) {
    return Ok({ binding: existing, candidates, tier: "confident", failures });
  }

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
): Promise<{ found: SourceManga[]; failures: string[] }> {
  const found: SourceManga[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();

  const results = await Promise.all(
    remote.map(async (s) => {
      const rs = await Promise.all(queries.map((q) => src.search(s.id, q)));
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

export async function chaptersFor(binding: Binding, refresh = false) {
  return backend(binding.kind).chapters(binding.source_manga_id, refresh);
}

export function pinBinding(b: Omit<Binding, "bound_at" | "pinned">) {
  setBinding(b, true);
}

import { Err, Ok, type Result } from "./result.ts";
import type { BrowseData, HomeData, Media, MediaKind, ProviderSlug, SearchData } from "./media.ts";

export type SeriesPart = {
  id: number;
  title: string;
  label: string;
  kind: "part" | "special";
};

export type Series = {
  rootId: number;
  title: string;
  parts: SeriesPart[];
  specials: SeriesPart[];
};

export type RelKind = "prequel" | "sequel" | "side";

export type SeriesNode = {
  id: number;
  title: string;
  format: string | null;
  edges: { kind: RelKind; id: number; title: string; format: string | null }[];
};

/** Season / part / cour suffixes — the catalog never shows these. */
const TAIL =
  /(?:\s*[–—:.\-]?\s*)(?:(?:the\s+)?final\s+season(?:\s+part\s+\d+)?|(?:\d+(?:st|nd|rd|th)|2nd|3rd|4th)\s+season|(?:season|cour)\s+\d+(?:\s+part\s+\d+)?|part\s+\d+|specials?)\s*$/i;

export function seriesTitle(title: string): string {
  let t = title.trim().replace(/\s*\(\d{4}\)\s*$/g, "").trim();
  t = t.replace(/\s+part\s+\d+(?=\s*:)/gi, "");
  for (let i = 0; i < 4; i++) {
    const next = t.replace(TAIL, "").replace(/[–—:.\-\s]+$/, "").trim();
    if (next === t || next.length < 2) break;
    t = next;
  }
  return t || title;
}

/** Colon + space only, so `Re:Zero` stays intact. */
export function colonPrefix(title: string): string | null {
  const i = title.indexOf(": ");
  if (i < 4) return null;
  const p = title.slice(0, i).trim();
  return p.length >= 4 ? p : null;
}

function sharesPrefix(name: string, prefix: string): boolean {
  const n = name.toLowerCase();
  const p = prefix.toLowerCase();
  return n === p || n.startsWith(`${p}: `) || n.startsWith(`${p} `);
}

function seriesKey(title: string, peerTitles: string[]): string {
  const name = seriesTitle(title);
  const peers = peerTitles.map(seriesTitle);
  const candidates = [
    colonPrefix(name),
    name.replace(/\s*[:–—-]?\s*(?:ova|ona|oad|specials?|movies?|films?)\b.*$/i, "").trim(),
  ];
  for (const c of candidates) {
    if (!c || c.toLowerCase() === name.toLowerCase()) continue;
    if (peers.filter((n) => sharesPrefix(n, c)).length > 1) {
      return c.toLowerCase();
    }
  }
  return name.toLowerCase();
}

export function canonicalTitle(title: string, peerTitles: string[]): string {
  return displayName(title, seriesKey(title, peerTitles));
}

export function seriesFold(title: string, peerTitles: string[]): string {
  return seriesKey(title, peerTitles);
}

/** Progress/library titles often omit the colon (`Dr. STONE SCIENCE FUTURE`). Rails stay on seriesKey. */
export function franchiseKey(title: string, peerTitles: string[]): string {
  const name = seriesTitle(title);
  const peers = peerTitles.map((t) => seriesTitle(t));
  const named = [...new Set(peers)].sort((a, b) => a.length - b.length);
  for (const c of named) {
    if (c.length < 4) continue;
    if (peers.filter((p) => sharesPrefix(p, c)).length > 1 && sharesPrefix(name, c)) {
      return c.toLowerCase();
    }
  }
  const words = (t: string) => t.toLowerCase().split(/\s+/).filter(Boolean);
  const mine = words(name);
  let best: string | null = null;
  for (const p of peers) {
    if (p.toLowerCase() === name.toLowerCase()) continue;
    const theirs = words(p);
    let i = 0;
    while (i < mine.length && i < theirs.length && mine[i] === theirs[i]) i++;
    if (i < 2) continue;
    const prefix = mine.slice(0, i).join(" ");
    if (prefix.length < 8) continue;
    const n = peers.filter((x) => sharesPrefix(x, prefix)).length;
    if (n > 1 && (!best || prefix.length < best.length)) best = prefix;
  }
  return best ?? name.toLowerCase();
}

export function franchiseLabel(title: string, peerTitles: string[]): string {
  const key = franchiseKey(title, peerTitles);
  const name = seriesTitle(title);
  const exact = peerTitles.map((t) => seriesTitle(t)).find((t) => t.toLowerCase() === key);
  if (exact) return exact;
  const bits = name.split(/\s+/).filter(Boolean);
  const want = key.split(/\s+/).filter(Boolean);
  if (bits.length >= want.length && bits.slice(0, want.length).join(" ").toLowerCase() === key) {
    return bits.slice(0, want.length).join(" ");
  }
  return name;
}

function displayName(title: string, key: string): string {
  const name = seriesTitle(title);
  if (name.toLowerCase() === key) return name;
  const p = colonPrefix(name);
  if (p && p.toLowerCase() === key) return p;
  return name;
}

/** One tile per franchise. Keeps the shortest title in the group (usually the root). */
export function collapseSeries(items: Media[]): Media[] {
  const titles = items.map((m) => m.title);
  const groups = new Map<string, Media[]>();
  for (const m of items) {
    const k = `${m.kind}|${seriesKey(m.title, titles)}`;
    const g = groups.get(k);
    if (g) g.push(m);
    else groups.set(k, [m]);
  }
  const out: Media[] = [];
  for (const g of groups.values()) {
    const rep = [...g].sort((a, b) => a.title.length - b.title.length)[0]!;
    const key = seriesKey(rep.title, titles);
    const title = displayName(rep.title, key);
    out.push(title === rep.title ? rep : { ...rep, title });
  }
  return out;
}

export function collapseHome(d: HomeData): HomeData {
  return {
    hero: d.hero && { ...d.hero, title: seriesTitle(d.hero.title) },
    popularAnime: collapseSeries(d.popularAnime),
    popularManga: collapseSeries(d.popularManga),
    novels: collapseSeries(d.novels),
    forYou: collapseSeries(d.forYou),
  };
}

export function collapseSearch(d: SearchData): SearchData {
  return {
    anime: collapseSeries(d.anime),
    manga: collapseSeries(d.manga),
    novels: collapseSeries(d.novels),
  };
}

export function collapseBrowse(d: BrowseData): BrowseData {
  return {
    ...d,
    popular: collapseSeries(d.popular),
    recommended: collapseSeries(d.recommended),
    recent: collapseSeries(d.recent),
    rails: d.rails.map((r) => ({ ...r, items: collapseSeries(r.items) })),
    grid: collapseSeries(d.grid),
  };
}

function prettifyRest(rest: string): string {
  const finale = /^(?:the\s+)?final\s+season\b(.*)$/i.exec(rest);
  if (finale) {
    const extra = finale[1].replace(/^[\s:–—-]+/, "").trim();
    if (!extra) return "Final season";
    const p = /^part\s+(\d+)$/i.exec(extra);
    if (p) return `Final season part ${p[1]}`;
    return `Final season · ${extra}`;
  }
  const season = /^season\s+(\d+)(?:\s+part\s+(\d+))?$/i.exec(rest);
  if (season) return season[2] ? `Season ${season[1]} part ${season[2]}` : `Season ${season[1]}`;
  const nth = /^(\d+)(?:st|nd|rd|th)\s+season$/i.exec(rest) ?? /^(2nd|3rd|4th)\s+season$/i.exec(rest);
  if (nth) return `Season ${nth[1].replace(/st|nd|rd|th/i, "")}`;
  return rest;
}

export function partLabel(title: string, series: string, asSpecial = false): string {
  let rest = "";
  if (series && title.toLowerCase().startsWith(series.toLowerCase())) {
    rest = title.slice(series.length).replace(/^[\s:–—-]+/, "").trim();
  } else if (asSpecial) {
    const p = colonPrefix(title);
    rest = p ? title.slice(p.length + 2).trim() : title;
  } else {
    rest = colonPrefix(title) ?? title;
  }
  if (asSpecial) {
    const trimmed = rest
      .replace(/\bspecials?\b(?:\s+episodes?\b)?/gi, "")
      .replace(/^[–—:.\-\s]+/g, "")
      .replace(/[–—:.\-\s]+$/g, "")
      .trim();
    return trimmed || rest || title;
  }
  rest = rest.replace(/^\(\d{4}\)$/, "").replace(/[?–—:.\-\s]+$/g, "").trim();
  if (!rest) return "Season 1";
  return prettifyRest(rest);
}

const MAIN_FMT = /^(tv|ona|tv_short|manga|novel|manhwa|manhua|one_shot|one-shot|light_novel|light novel)?$/i;

function relKind(raw: string): RelKind | null {
  const s = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (s === "prequel" || s === "parentstory" || s === "parent") return "prequel";
  if (s === "sequel") return "sequel";
  if (s === "sidestory" || s === "spinoff" || s === "spin-off") return "side";
  return null;
}

function pickEdge(edges: SeriesNode["edges"], kind: RelKind): SeriesNode["edges"][number] | undefined {
  const match = edges.filter((e) => e.kind === kind);
  return match.find((e) => MAIN_FMT.test(e.format ?? "")) ?? match[0];
}

/** Walk a pre-loaded graph. Exported so the walk is testable without a network. */
export function assembleSeries(startId: number, nodes: Map<number, SeriesNode>): Series {
  const start = nodes.get(startId);
  if (!start) {
    return { rootId: startId, title: "", parts: [], specials: [] };
  }

  let rootId = startId;
  const up = new Set<number>();
  for (let i = 0; i < 16; i++) {
    const n = nodes.get(rootId);
    if (!n) break;
    const pre = pickEdge(n.edges, "prequel");
    if (!pre || up.has(pre.id) || !nodes.has(pre.id)) break;
    up.add(rootId);
    rootId = pre.id;
  }

  const parts: SeriesPart[] = [];
  const bridgeSpecials: SeriesNode[] = [];
  const main = new Set<number>();
  const chain = new Set<number>();
  let cur: number | undefined = rootId;
  for (let i = 0; i < 16 && cur != null && !chain.has(cur); i++) {
    const n = nodes.get(cur);
    if (!n) break;
    chain.add(cur);
    if (MAIN_FMT.test(n.format ?? "")) {
      main.add(cur);
      parts.push({ id: n.id, title: n.title, label: "", kind: "part" });
    } else {
      bridgeSpecials.push(n);
    }
    const seq = pickEdge(n.edges, "sequel");
    if (!seq || chain.has(seq.id)) break;
    if (!nodes.has(seq.id)) {
      if (MAIN_FMT.test(seq.format ?? "")) {
        parts.push({ id: seq.id, title: seq.title, label: "", kind: "part" });
      }
      break;
    }
    cur = seq.id;
  }

  const series = seriesTitle(parts[0]?.title ?? start.title);
  for (const [i, p] of parts.entries()) {
    const label = partLabel(p.title, series);
    p.label = i > 0 && label === "Season 1" ? `Season ${i + 1}` : label;
  }

  const specials: SeriesPart[] = bridgeSpecials.map((n) => ({
    id: n.id,
    title: n.title,
    label: partLabel(n.title, series, true),
    kind: "special",
  }));
  const seen = new Set(chain);
  for (const n of nodes.values()) {
    if (!main.has(n.id)) continue;
    for (const e of n.edges) {
      if (e.kind !== "side" || seen.has(e.id)) continue;
      seen.add(e.id);
      const dest = nodes.get(e.id);
      const title = dest?.title ?? e.title;
      specials.push({
        id: e.id,
        title,
        label: partLabel(title, series, true),
        kind: "special",
      });
    }
  }

  return { rootId: parts[0]?.id ?? rootId, title: series, parts, specials };
}

export type EpisodeLike = { season?: number | null };

/** Marks earlier franchise parts watched when you jump into a later season. */
export function progressTree(
  parts: SeriesPart[],
  mediaId: number,
  titles: Result<Pick<Media, "title" | "cover" | "units">>[],
): {
  seriesParts?: { mediaId: number; title: string; cover: string | null; units: number }[];
  partIndex?: number;
} {
  if (parts.length < 2) return {};
  const partIndex = parts.findIndex((p) => p.id === mediaId);
  return {
    seriesParts: parts.map((p, i) => {
      const t = titles[i];
      return {
        mediaId: p.id,
        title: t?.ok ? t.value.title : p.title,
        cover: t?.ok ? t.value.cover ?? null : null,
        units: t?.ok ? t.value.units ?? 0 : 0,
      };
    }),
    ...(partIndex >= 0 ? { partIndex } : {}),
  };
}

/**
 * Sum of `units` for every part before `selectedId` (series order), plus that
 * part's own unit count. Unknown counts contribute 0 to the offset rather than
 * breaking the walk — see CLAUDE.md on ongoing series reporting no count.
 */
export function episodeWindow(
  parts: { id: number; units: number | null }[],
  selectedId: number,
): { offset: number; count: number | null } {
  let offset = 0;
  for (const p of parts) {
    if (p.id === selectedId) return { offset, count: p.units };
    offset += p.units ?? 0;
  }
  return { offset: 0, count: null };
}

/**
 * Which episodes of a flat, addon-supplied list belong to this one part of a
 * multi-season franchise.
 *
 * A source's own season tag on each episode is whatever numbering scheme that
 * addon happens to use (IMDB-style, absent, or a flat "season 1" for the whole
 * list) — it has no guaranteed relationship to how the metadata provider split
 * the franchise into parts. Absolute position plus each part's own episode
 * count is the stronger signal, same reasoning CLAUDE.md already applies to
 * manga chapter counts ("count agreement beats title similarity"). The season
 * tag is kept only as a fallback so an unknown or wrong count never produces
 * zero episodes.
 *
 * `episodes` is trusted to already be in chronological order — every backend's
 * `chapters()` sorts by season then episode number before returning, and the
 * addon's own episode *numbers* often restart per season, so re-sorting by
 * number here would scramble a flat multi-season list instead of slicing it.
 */
export function windowEpisodes<T extends EpisodeLike>(
  episodes: T[],
  offset: number,
  count: number | null,
  seasonHint: number | null,
): T[] {
  if (episodes.length === 0) return episodes;

  // ponytail: flat slack for a stray movie/special mixed into an otherwise
  // single-season list; upgrade to a ratio if a real addon needs it.
  const SLACK = 3;
  if (seasonHint === 0) {
    const specials = episodes.filter((e) => e.season === 0);
    if (specials.length) {
      return count == null || Math.abs(specials.length - count) <= SLACK ? specials : [];
    }
    return count != null && episodes.length === count ? episodes : [];
  }
  if (count != null && Math.abs(episodes.length - count) <= SLACK) {
    // The list already covers just this part — nothing to slice.
    return episodes;
  }

  const bySeason = seasonHint != null ? episodes.filter((e) => (e.season ?? 1) === seasonHint) : [];
  const fallback = bySeason.length ? bySeason : episodes;

  if (count != null && offset + count <= episodes.length) {
    const slice = episodes.slice(offset, offset + count);
    if (slice.length) return slice;
  } else if (offset > 0 && offset < episodes.length) {
    // Count unknown (an ongoing final season) — take what's left after the
    // earlier parts.
    const rest = episodes.slice(offset);
    if (rest.length) return rest;
  }

  return fallback;
}

const TTL = 30 * 60_000;
const memo = new Map<string, { at: number; v: Series }>();
const inflight = new Map<string, Promise<Series>>();

function remember(via: ProviderSlug, kind: MediaKind, s: Series) {
  const at = Date.now();
  for (const id of [s.rootId, ...s.parts.map((p) => p.id), ...s.specials.map((p) => p.id)]) {
    memo.set(`${via}|${kind}|${id}`, { at, v: s });
  }
}

export async function fetchSeries(
  via: ProviderSlug,
  kind: MediaKind,
  id: number,
): Promise<Result<Series>> {
  const key = `${via}|${kind}|${id}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL) return Ok(hit.v);
  const live = inflight.get(key);
  if (live) return live.then(Ok);

  const p = loadSeries(via, kind, id).then((s) => {
    if (s.parts.length > 0) remember(via, kind, s);
    return s;
  });
  inflight.set(key, p);
  try {
    return Ok(await p);
  } catch (e) {
    return Err(e instanceof Error ? e.message : "Could not load series.");
  } finally {
    inflight.delete(key);
  }
}

async function loadSeries(via: ProviderSlug, kind: MediaKind, id: number): Promise<Series> {
  const nodes = new Map<number, SeriesNode>();
  const loading = new Map<number, Promise<SeriesNode | null>>();

  const load = (nid: number) => {
    const cached = nodes.get(nid);
    if (cached) return Promise.resolve(cached);
    const live = loading.get(nid);
    if (live) return live;
    const p = fetchNode(via, kind, nid).then((n) => {
      if (n) nodes.set(n.id, n);
      return n;
    });
    loading.set(nid, p);
    return p;
  };

  const first = await load(id);
  if (!first) return { rootId: id, title: "", parts: [], specials: [] };

  const walk = async (start: number, dir: RelKind) => {
    let cur = start;
    const seen = new Set<number>();
    for (let i = 0; i < 16; i++) {
      const n = await load(cur);
      if (!n || seen.has(n.id)) break;
      seen.add(n.id);
      const next = pickEdge(n.edges, dir);
      if (!next) break;
      cur = next.id;
    }
  };

  await Promise.all([walk(id, "prequel"), walk(id, "sequel")]);
  return assembleSeries(id, nodes);
}

async function fetchNode(
  via: ProviderSlug,
  kind: MediaKind,
  id: number,
): Promise<SeriesNode | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const n =
        via === "anilist"
          ? await anilistNode(id)
          : via === "jikan"
            ? await jikanNode(kind, id)
            : await kitsuNode(kind, id);
      if (n) return n;
    } catch {
      /* retry once — Jikan 504s mid-walk otherwise truncate the franchise */
    }
  }
  return null;
}

function mediaPath(kind: MediaKind): "anime" | "manga" {
  return kind === "anime" ? "anime" : "manga";
}

async function anilistNode(id: number): Promise<SeriesNode | null> {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "Lacrima/0.1 (self-hosted)",
    },
    body: JSON.stringify({
      query: `query Rel($id: Int!) {
        Media(id: $id) {
          id type format
          title { english romaji }
          relations {
            edges {
              relationType
              node { id type format title { english romaji } }
            }
          }
        }
      }`,
      variables: { id },
    }),
    cache: "force-cache",
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: {
      Media?: {
        id: number;
        type: string;
        format: string | null;
        title: { english: string | null; romaji: string | null };
        relations?: {
          edges?: {
            relationType: string;
            node: {
              id: number;
              type: string;
              format: string | null;
              title: { english: string | null; romaji: string | null };
            } | null;
          }[];
        };
      } | null;
    };
  };
  const m = json.data?.Media;
  if (!m) return null;
  const edges: SeriesNode["edges"] = [];
  for (const e of m.relations?.edges ?? []) {
    const kind = relKind(e.relationType);
    if (!kind || !e.node || e.node.type !== m.type) continue;
    edges.push({
      kind,
      id: e.node.id,
      title: e.node.title.english ?? e.node.title.romaji ?? "Untitled",
      format: e.node.format,
    });
  }
  return {
    id: m.id,
    title: m.title.english ?? m.title.romaji ?? "Untitled",
    format: m.format,
    edges,
  };
}

async function jikanNode(kind: MediaKind, id: number): Promise<SeriesNode | null> {
  const type = mediaPath(kind);
  const res = await fetch(`https://api.jikan.moe/v4/${type}/${id}/full`, {
    headers: { accept: "application/json" },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: {
      mal_id: number;
      title: string;
      title_english?: string | null;
      type?: string | null;
      relations?: { relation: string; entry: { mal_id: number; type: string; name: string }[] }[];
    };
  };
  const m = json.data;
  if (!m) return null;
  const edges: SeriesNode["edges"] = [];
  for (const rel of m.relations ?? []) {
    const rk = relKind(rel.relation);
    if (!rk) continue;
    for (const e of rel.entry) {
      if (e.type !== type) continue;
      edges.push({ kind: rk, id: e.mal_id, title: e.name, format: null });
    }
  }
  return {
    id: m.mal_id,
    title: m.title_english ?? m.title,
    format: m.type ?? null,
    edges,
  };
}

async function kitsuNode(kind: MediaKind, id: number): Promise<SeriesNode | null> {
  const type = mediaPath(kind);
  const res = await fetch(
    `https://kitsu.app/api/edge/${type}/${id}?include=mediaRelationships.destination`,
    {
      headers: { accept: "application/vnd.api+json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: {
      id: string;
      type: string;
      attributes?: {
        canonicalTitle?: string | null;
        titles?: Record<string, string | undefined>;
        subtype?: string | null;
      };
    };
    included?: {
      id: string;
      type: string;
      attributes?: {
        role?: string;
        canonicalTitle?: string | null;
        titles?: Record<string, string | undefined>;
        subtype?: string | null;
      };
      relationships?: { destination?: { data?: { id: string; type: string } } };
    }[];
  };
  const m = json.data;
  if (!m) return null;
  const included = json.included ?? [];
  const dests = new Map(
    included
      .filter((x) => x.type === "anime" || x.type === "manga")
      .map((x) => [x.id, x]),
  );
  const edges: SeriesNode["edges"] = [];
  for (const rel of included.filter((x) => x.type === "mediaRelationships")) {
    const rk = relKind(rel.attributes?.role ?? "");
    const destRef = rel.relationships?.destination?.data;
    if (!rk || !destRef || destRef.type !== m.type) continue;
    const dest = dests.get(destRef.id);
    const a = dest?.attributes;
    edges.push({
      kind: rk,
      id: Number(destRef.id),
      title: a?.titles?.en || a?.canonicalTitle || "Untitled",
      format: a?.subtype ?? null,
    });
  }
  const a = m.attributes;
  const en = a?.titles?.en;
  const canonical = a?.canonicalTitle;
  const title =
    en && canonical && canonical.length > en.length + 3 && !canonical.startsWith(en)
      ? canonical
      : en || canonical || "Untitled";
  return {
    id: Number(m.id),
    title,
    format: a?.subtype ?? null,
    edges,
  };
}

/**
 * The I/O half of vetting: ask a source the fixed titles and report what came back.
 * Scoring and the auto-off decision are in `vet.ts`; the queue and persistence are in
 * `vet-queue.ts`. Shared by the app and `scripts/vet-sources.mjs` so a "hit" means
 * the same thing in both.
 */
import { backend, langMatches } from "./sources/index.ts";
import { getPlugin } from "./sources/store.ts";
import {
  episodeMatches,
  idsFor,
  playableListing,
  servesKind,
  servesStreams,
  streamTypesFor,
  wantedSlot,
  wrongWork,
} from "./sources/stremio.ts";
import { CONFIDENT, titleScore } from "./match.ts";
import { seeders } from "./streams.ts";
import {
  VET_MANGA,
  VET_NOVELS,
  VET_VIDEO,
  transientNote,
  verdict,
  type Outcome,
  type Probe,
  type VetKind,
  type VetTitle,
  type Verdict,
} from "./vet.ts";

/** One request may take this long; a source slower than this is not one a viewer would wait for. */
const REQUEST_MS = 15_000;
/** Everything one source may cost for one title, like the app's own addon budget. */
const TITLE_MS = 25_000;
/** Politeness between titles: one source is one host. */
const GAP_MS = 250;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const baseOf = (u: string) => u.replace(/\/manifest\.json$/i, "").replace(/\/$/, "");

/* ---------- video ---------- */

type Stream = {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  sources?: (string | { url?: string })[];
  behaviorHints?: { filename?: string; proxyHeaders?: { request?: Record<string, string> } };
};

const text = (s: Stream) =>
  [s.name, s.title, s.description, s.behaviorHints?.filename].filter(Boolean).join(" ");

function httpLink(s: Stream): string | null {
  if (s.url?.startsWith("http")) return s.url;
  for (const x of s.sources ?? []) {
    const u = typeof x === "string" ? x : x?.url;
    if (u?.startsWith("http")) return u;
  }
  return null;
}

const isTorrent = (s: Stream) => Boolean(s.infoHash) || /btih:[a-f0-9]{40}/i.test(s.url ?? "");

/** Does this direct link answer a ranged read with something that is not an error page? */
async function linkAlive(s: Stream): Promise<boolean> {
  const headers = s.behaviorHints?.proxyHeaders?.request;
  const referer = headers?.Referer ?? headers?.referer;
  try {
    const r = await fetch(httpLink(s)!, {
      headers: { range: "bytes=0-1023", ...(referer ? { referer } : {}) },
      signal: AbortSignal.timeout(8_000),
    });
    r.body?.cancel().catch(() => {});
    const type = r.headers.get("content-type") ?? "";
    return (r.status === 200 || r.status === 206) && !/text\/html|json/i.test(type);
  } catch {
    return false;
  }
}

/** Would the best of these actually play? See `Probe.alive`. */
async function aliveOf(streams: Stream[]): Promise<number> {
  const http: Stream[] = [];
  const seen = new Set<string>();
  for (const s of streams) {
    const link = httpLink(s);
    const host = link && new URL(link).hostname;
    if (link && host && !seen.has(host)) {
      seen.add(host);
      http.push(s);
    }
  }
  // Two distinct hosts at most: one request each is polite, and one working link is enough.
  for (const s of http.slice(0, 2)) if (await linkAlive(s)) return 1;
  const swarms = streams
    .filter(isTorrent)
    .map((s) => seeders(text(s)))
    .sort((a, b) => (b ?? -1) - (a ?? -1));
  if (!swarms.length) return 0;
  const top = swarms[0];
  return top == null ? 0.5 : top >= 5 ? 1 : top >= 1 ? 0.3 : 0;
}

type Manifest = Parameters<typeof idsFor>[0];

async function probeTitle(man: Manifest, base: string, t: VetTitle): Promise<Probe & { transport: number }> {
  const live = t.kind === "movie" || t.kind === "series";
  const slot = t.season ? `:${t.season}:${t.episode}` : "";
  const ids = live ? [`${t.imdb}${slot}`] : [`kitsu:${t.kitsu}:${t.episode}`, `${t.imdb}${slot}`];
  const mine = idsFor(man, ids);
  const types = live ? [t.kind] : streamTypesFor(man, ids[0]);
  if (!mine.length || !types.length || (live && !servesKind(man, t.kind))) {
    return { label: t.label, inScope: false, hit: false, ms: 0, alive: null, transport: 0 };
  }

  const started = Date.now();
  const until = started + TITLE_MS;
  const notes: string[] = [];
  let transport = 0;
  const miss = (note?: string) => ({
    label: t.label, inScope: true, hit: false, ms: Date.now() - started, alive: null, note, transport,
  });
  for (const id of mine) {
    for (const type of types) {
      const left = until - Date.now();
      if (left <= 500) break;
      try {
        const res = await fetch(`${base}/stream/${type}/${id}.json`, {
          signal: AbortSignal.timeout(Math.min(REQUEST_MS, left)),
        });
        if (res.status === 429 || res.status === 401 || res.status === 403) {
          // The app stops asking an addon that says this, so it counts as the end of the title.
          return miss(res.status === 429 ? "rate-limited" : `refused (${res.status})`);
        }
        if (!res.ok) continue;
        const json = (await res.json()) as { streams?: Stream[] };
        const want = wantedSlot(id);
        const streams = (json.streams ?? []).filter((s) => playableListing(s as never)).filter((s) => {
          const file = s.behaviorHints?.filename;
          return episodeMatches(s as never, want) && !(file && wrongWork(file, t.work));
        });
        if (streams.length) {
          const http = streams.filter((s) => httpLink(s)).length;
          return {
            label: t.label, inScope: true, hit: true, ms: Date.now() - started,
            alive: await aliveOf(streams), note: `${http} http / ${streams.filter(isTorrent).length} torrent`, transport,
          };
        }
      } catch (e) {
        transport++;
        notes.push((e as Error)?.name === "TimeoutError" ? "timed out" : "unreachable");
      }
    }
  }
  return miss(notes[0]);
}

export type VetResult = {
  name: string;
  url: string;
  kind: "video" | "manga" | "novel";
  probes: Probe[];
  verdict?: Verdict;
  /** Why it could not be vetted at all. */
  skipped?: { why: "unreachable" | "unsupported"; text: string };
  note?: string;
};

export async function vetAddon({ name, url }: { name: string | null; url: string }): Promise<VetResult> {
  const out: VetResult = { name: name ?? url, url, kind: "video", probes: [] };
  let man: Manifest & { name?: string; behaviorHints?: { configurationRequired?: boolean } };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return { ...out, skipped: { why: "unreachable", text: `manifest returned ${res.status}` } };
    man = await res.json();
  } catch (e) {
    return { ...out, skipped: { why: "unreachable", text: `manifest unreachable (${(e as Error)?.message ?? e})` } };
  }
  out.name = name ?? man.name ?? url;
  if (!servesStreams(man)) {
    return { ...out, skipped: { why: "unsupported", text: "no stream resource (catalog or subtitles only)" } };
  }
  if (man.behaviorHints?.configurationRequired) out.note = "wants configuration";
  const base = baseOf(url);

  let dead = 0;
  let cause = "";
  for (const t of VET_VIDEO) {
    // Three titles in a row that fail on the wire and find nothing: stop wasting the clock.
    if (dead >= 3) {
      out.probes.push({ label: t.label, inScope: true, hit: false, ms: 0, alive: null, note: `skipped: ${cause}` });
      continue;
    }
    const p = await probeTitle(man, base, t);
    const { transport, ...probe } = p;
    out.probes.push(probe);
    if (!p.hit && p.inScope && transport > 0) {
      dead++;
      cause = p.note ?? "unreachable";
    } else dead = 0;
    await sleep(GAP_MS);
  }
  return { ...out, verdict: verdict(out.probes) };
}

/* ---------- manga and novels ---------- */

export async function vetReadable(
  kind: "manga" | "novel",
  source: { id: string; name: string; lang: string },
): Promise<VetResult> {
  const be = backend(kind);
  const titles = kind === "manga" ? VET_MANGA : VET_NOVELS;
  const out: VetResult = { name: `${source.name} (${source.lang})`, url: source.id, kind, probes: [] };
  let sampled = 0;
  let dead = 0;
  let cause = "";
  for (const query of titles) {
    if (dead >= 3) {
      out.probes.push({ label: query, inScope: true, hit: false, ms: 0, alive: null, note: `skipped: ${cause}` });
      continue;
    }
    const started = Date.now();
    let probe: Probe;
    try {
      const r = await Promise.race([
        be.search(source.id, query, kind),
        sleep(TITLE_MS).then(() => ({ ok: false as const, reason: "timed out" })),
      ]);
      const ms = Date.now() - started;
      const match = r.ok ? r.value.find((x) => titleScore(x.title, query) >= CONFIDENT) : null;
      if (!match) {
        probe = { label: query, inScope: true, hit: false, ms, alive: null, note: r.ok ? "no match" : r.reason };
        if (r.ok) dead = 0;
        else {
          dead++;
          cause = r.reason;
        }
      } else {
        dead = 0;
        probe = { label: query, inScope: true, hit: true, ms, alive: null };
        // Reading it is the point: a title that lists but has no chapters or pages is not a hit worth much.
        if (sampled < 2) {
          sampled++;
          const ch = await be.chapters(match.id);
          const first = ch.ok ? ch.value[0] : null;
          const pages = first ? await be.pages(first.id) : null;
          probe.alive = (first ? 0.5 : 0) + (pages?.ok && pages.value.length ? 0.5 : 0);
          probe.note = `${ch.ok ? ch.value.length : 0} ch`;
        }
      }
    } catch (e) {
      const why = String((e as Error)?.message ?? e);
      probe = { label: query, inScope: true, hit: false, ms: Date.now() - started, alive: null, note: why };
      dead++;
      cause = why;
    }
    out.probes.push(probe);
    await sleep(GAP_MS);
  }
  return { ...out, verdict: verdict(out.probes) };
}

/* ---------- one source, by the id the app knows it by ---------- */

/** A vet result as the app stores it: scored, or honestly not. */
export function outcomeOf(r: VetResult): Outcome {
  if (r.skipped) {
    return { status: r.skipped.why === "unsupported" ? "unsupported" : "inconclusive", note: r.skipped.text };
  }
  const unsure = transientNote(r.probes);
  if (unsure) return { status: "inconclusive", note: unsure };
  return { status: "ok", verdict: r.verdict!, ...(r.note ? { note: r.note } : {}) };
}

export async function runVet(kind: VetKind, id: string): Promise<Outcome> {
  if (kind === "anime") {
    const p = getPlugin(id, "anime");
    if (!p?.plugin_url) return { status: "unsupported", note: "Not a known addon." };
    return outcomeOf(await vetAddon({ name: p.name, url: p.plugin_url }));
  }
  // A turned-off novel plugin is not in `listSources`, but it still has to be re-vettable.
  if (kind === "novel") {
    const p = getPlugin(id, "novel");
    if (!p) return { status: "unsupported", note: "Not a known plugin." };
    return outcomeOf(await vetReadable("novel", p));
  }
  const listed = await backend("manga").listSources();
  if (!listed.ok) return { status: "inconclusive", note: listed.reason };
  const source = listed.value.find((s) => s.id === id && !s.isLocal);
  if (!source) return { status: "unsupported", note: "Not an installed source." };
  if (!langMatches(source.lang)) return { status: "unsupported", note: "Not in a language Lacrima searches." };
  return outcomeOf(await vetReadable("manga", source));
}

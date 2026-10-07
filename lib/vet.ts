/**
 * What `scripts/vet-sources.mjs` asks every source, and how the answers become a score.
 *
 * The ten titles are fixed on purpose: two sources are only comparable if they were
 * asked the same questions, and a score that moves because the titles changed is not
 * a score. They are chosen to cover the cases that actually separate sources — a
 * ubiquitous classic, a foreign-language film, something recent, an anime movie, a
 * long-tail show nobody mirrors, and long-running anime that only anime addons know.
 */

export type VetTitle = {
  label: string;
  kind: "movie" | "series" | "anime";
  imdb: string;
  /** The title as the app holds it; `wrongWork` rejects files naming something else. */
  work: string;
  season?: number;
  episode?: number;
  /** Anime addons speak `kitsu:` ids, and the app asks those first. */
  kitsu?: number;
};

export const VET_VIDEO: VetTitle[] = [
  { label: "The Shawshank Redemption", kind: "movie", imdb: "tt0111161", work: "The Shawshank Redemption" },
  { label: "Parasite (2019, Korean)", kind: "movie", imdb: "tt6751668", work: "Parasite" },
  { label: "Oppenheimer (2023)", kind: "movie", imdb: "tt15398776", work: "Oppenheimer" },
  { label: "Spirited Away (anime film)", kind: "movie", imdb: "tt0245429", work: "Spirited Away" },
  { label: "Breaking Bad S01E01", kind: "series", imdb: "tt0903747", work: "Breaking Bad", season: 1, episode: 1 },
  { label: "Squid Game S01E01", kind: "series", imdb: "tt10919420", work: "Squid Game", season: 1, episode: 1 },
  { label: "Love Game in Eastern Fantasy S01E01 (long tail)", kind: "series", imdb: "tt30762431", work: "Love Game in Eastern Fantasy", season: 1, episode: 1 },
  { label: "Attack on Titan E01", kind: "anime", imdb: "tt2560140", kitsu: 7442, work: "Attack on Titan", season: 1, episode: 1 },
  { label: "One Piece E01", kind: "anime", imdb: "tt0388629", kitsu: 12, work: "One Piece", season: 1, episode: 1 },
  { label: "Frieren E01", kind: "anime", imdb: "tt22248376", kitsu: 46474, work: "Frieren", season: 1, episode: 1 },
];

/** Searched by title; a hit is a result the matcher is confident is the same work. */
export const VET_MANGA = [
  "One Piece", "Berserk", "Chainsaw Man", "Solo Leveling", "Vagabond",
  "Oyasumi Punpun", "Jujutsu Kaisen", "Tower of God", "Blue Lock", "Frieren",
];

/* Light novels and translated web novels, plus three English-language originals, which
   some sources host exclusively and a list of translations alone cannot judge them on. */
export const VET_NOVELS = [
  "Overlord", "Mushoku Tensei", "Re:Zero", "Lord of the Mysteries",
  "Omniscient Reader's Viewpoint", "Shadow Slave", "The Beginning After the End",
  "Mother of Learning", "The Wandering Inn", "He Who Fights with Monsters",
];

export type Probe = {
  label: string;
  /** False when the source never claimed to serve this (an anime-only addon asked for a film). */
  inScope: boolean;
  hit: boolean;
  /** Everything the source cost for this title, which is what the viewer waits for. */
  ms: number;
  /**
   * 0..1: would the answer actually play or read? A link that responded is 1, a torrent
   * with a healthy swarm is 1, one that says nothing about its swarm is 0.5, a dead link
   * is 0. `null` when it was not checked.
   */
  alive: number | null;
  note?: string;
};

export type Verdict = {
  /** 0..10: coverage 5, liveness 3, speed 2. */
  score: number;
  hits: number;
  scope: number;
  avgHitMs: number | null;
  medianHitMs: number | null;
  /** Mean liveness over the hits that were checked. */
  alive: number | null;
};

/** At or under this a hit is as fast as it can matter; at or over `SLOW` it earns nothing. */
export const FAST_MS = 500;
export const SLOW_MS = 5_000;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

export function verdict(probes: Probe[]): Verdict {
  const scope = probes.filter((p) => p.inScope);
  /* A hit that proves dead is not a hit. Jackettio answers every title with one
     placeholder link, which "found" ten of ten and played none of them. */
  const hits = scope.filter((p) => p.hit && p.alive !== 0);
  if (!scope.length) return { score: 0, hits: 0, scope: 0, avgHitMs: null, medianHitMs: null, alive: null };

  const ms = hits.map((h) => h.ms).sort((a, b) => a - b);
  const avg = ms.length ? mean(ms) : null;
  const checked = hits.flatMap((h) => (h.alive == null ? [] : [h.alive]));
  // Unchecked is not dead, but it is not proven either: half credit.
  const alive = hits.length ? (checked.length ? mean(checked) : 0.5) : null;

  const coverage = 5 * (hits.length / scope.length);
  const liveness = 3 * (alive ?? 0);
  const speed = avg == null ? 0 : 2 * Math.min(1, Math.max(0, (SLOW_MS - avg) / (SLOW_MS - FAST_MS)));
  return {
    score: round(coverage + liveness + speed),
    hits: hits.length,
    scope: scope.length,
    avgHitMs: avg == null ? null : Math.round(avg),
    medianHitMs: ms.length ? ms[Math.floor((ms.length - 1) / 2)] : null,
    alive: alive == null ? null : round(alive, 2),
  };
}

/* ---------- what the app does with a verdict ---------- */

export type VetKind = "anime" | "manga" | "novel";

/** A first vet at or under this turns the source off, once. */
export const AUTO_OFF_AT = 5;

export type VetRow = {
  kind: VetKind;
  id: string;
  /** ok: scored. inconclusive: could not tell a bad source from a bad moment. unsupported: nothing to vet. */
  status: "ok" | "inconclusive" | "unsupported";
  score: number | null;
  hits: number | null;
  scope: number | null;
  avg_ms: number | null;
  median_ms: number | null;
  alive: number | null;
  note: string | null;
  vetted_at: number;
  /** When the first conclusive vet happened; the auto-off decision is made then and never again. */
  confirmed_at: number | null;
  auto_off: 0 | 1;
};

export type Outcome =
  | { status: "ok"; verdict: Verdict; note?: string }
  | { status: "inconclusive" | "unsupported"; note: string };

const TRANSIENT = /rate-limited|timed out|time ?out|unreachable|could not reach|fetch failed|network/i;

/**
 * Why this result cannot be trusted, or null when it can.
 *
 * Switching a source off on the strength of one vet is only fair if the vet measured
 * the source. Nothing found because the site was rate-limiting us, timing out or
 * unreachable measured the moment, not the source: TorrentsDB scored 0 for ten
 * straight 429s and answers 95 streams when asked politely.
 */
export function transientNote(probes: Probe[]): string | null {
  const scope = probes.filter((p) => p.inScope);
  if (!scope.length || scope.some((p) => p.hit && p.alive !== 0)) return null;
  const bad = scope.filter((p) => p.note && TRANSIENT.test(p.note));
  return bad.length * 2 >= scope.length ? bad[0].note! : null;
}

const blank = (kind: VetKind, id: string): VetRow => ({
  kind, id, status: "inconclusive", score: null, hits: null, scope: null,
  avg_ms: null, median_ms: null, alive: null, note: null, vetted_at: 0, confirmed_at: null, auto_off: 0,
});

/**
 * Fold one outcome into what is stored, and say whether to turn the source off.
 *
 * Only the first conclusive vet may switch a source off. After that the user is in
 * charge: re-enabling a 4.0 source must stick, and a retry that scores 3.0 must not
 * undo the choice they just made.
 */
export function decide(
  prev: VetRow | null,
  kind: VetKind,
  id: string,
  out: Outcome,
  now: number,
): { row: VetRow; off: boolean } {
  if (out.status !== "ok") {
    // A failed retry must not erase a score we already have.
    if (prev?.status === "ok") return { row: { ...prev, note: `Last retry: ${out.note}`, vetted_at: now }, off: false };
    return {
      row: { ...blank(kind, id), status: out.status, note: out.note, vetted_at: now, confirmed_at: prev?.confirmed_at ?? null, auto_off: prev?.auto_off ?? 0 },
      off: false,
    };
  }
  const v = out.verdict;
  const first = prev?.confirmed_at == null;
  const off = first && v.score <= AUTO_OFF_AT;
  return {
    off,
    row: {
      kind, id, status: "ok", score: v.score, hits: v.hits, scope: v.scope,
      avg_ms: v.avgHitMs, median_ms: v.medianHitMs, alive: v.alive,
      note: out.note ?? null, vetted_at: now,
      confirmed_at: prev?.confirmed_at ?? now,
      auto_off: off ? 1 : (prev?.auto_off ?? 0),
    },
  };
}

/** What the Sources page shows beside a source. */
export type VetView = {
  state: "pending" | "ok" | "unsure" | "na" | "none";
  score?: number;
  tone?: "good" | "mid" | "bad";
  tip: string;
};

export function viewOf(row: VetRow | null, pending: boolean): VetView {
  if (pending) return { state: "pending", tip: "Vetting against ten fixed titles…" };
  if (!row) return { state: "none", tip: "Not vetted yet." };
  if (row.status === "unsupported") return { state: "na", tip: row.note ?? "Nothing to vet here." };
  if (row.status === "inconclusive" || row.score == null) {
    return { state: "unsure", tip: `Could not be judged: ${row.note ?? "no answer"}. Retry to try again.` };
  }
  const parts = [
    `${row.hits}/${row.scope} titles`,
    row.avg_ms == null ? null : `avg ${row.avg_ms} ms`,
    row.alive == null ? null : `${Math.round(row.alive * 100)}% alive`,
  ].filter(Boolean);
  const why = row.auto_off ? " Turned off automatically after its first vet; enable it again if you want it." : "";
  return {
    state: "ok",
    score: row.score,
    tone: row.score >= 8 ? "good" : row.score > AUTO_OFF_AT ? "mid" : "bad",
    tip: `${parts.join(" · ")}.${row.note ? ` ${row.note}.` : ""}${why}`,
  };
}

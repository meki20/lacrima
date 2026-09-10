import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebTorrent from "webtorrent";

const HASH = /^[a-fA-F0-9]{40}$/;
const VIDEO = /\.(mp4|mkv|webm|m4v|avi|mov|ts)$/i;
const DIR = join(process.cwd(), "data", "torrents");
const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
];

type TorrentFile = {
  name: string;
  /** Includes the folder, which is where a multi-season pack keeps the season. */
  path: string;
  length: number;
  type: string;
  /** 0..1 — how much of *this file* is already verified on disk. */
  progress: number;
  select: () => void;
  deselect: () => void;
  [Symbol.asyncIterator]: (opts?: { start?: number; end?: number }) => AsyncIterableIterator<Uint8Array>;
};

type Torrent = {
  infoHash: string;
  ready: boolean;
  done: boolean;
  downloaded: number;
  /** The .torrent for this swarm, available once metadata has arrived. */
  torrentFile: Uint8Array;
  files: TorrentFile[];
  pause: () => void;
  resume: () => void;
  once: (ev: string, fn: (err?: Error) => void) => void;
  on: (ev: string, fn: (...args: unknown[]) => void) => void;
  removeListener: (ev: string, fn: (...args: unknown[]) => void) => void;
  destroy: (opts?: { destroyStore?: boolean }) => void;
};

/** How many torrents to connect at once while racing a quality bucket. */
export const TORRENT_RACE_MAX = 6;
/** Enough payload to start a video, not a single trickle piece. */
export const MIN_RACE_BYTES = 256 * 1024;
/** First useful bytes must land within this window or the candidate loses. */
export const FIRST_BYTE_MS = 22_000;
/** Metadata budget while racing — must finish before the player's race timeout. */
const RACE_META_MS = 18_000;
/** Keep losing race torrents warm this long so a bust can swap to the next candidate. */
export const RACE_POOL_MS = 120_000;

type Client = {
  torrents: Torrent[];
  add: (
    source: string | Uint8Array,
    opts?: { path?: string; deselect?: boolean; announce?: string[] },
  ) => Torrent;
  on: (ev: string, fn: (err: Error) => void) => void;
};

// One client, one torrent: a season pack in RAM is multiple gigabytes.
let client: Client | null = null;
const pending = new Map<string, Promise<Torrent>>();

export function isInfoHash(s: string) {
  return HASH.test(s);
}

function magnet(ih: string) {
  return `magnet:?xt=urn:btih:${ih}${TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join("")}`;
}

function getClient(): Client {
  if (client) return client;
  mkdirSync(DIR, { recursive: true });
  client = new WebTorrent({
    utp: false,
    lsd: false,
    natUpnp: false,
    natPmp: false,
    maxConns: 55,
  } as { utp: boolean }) as unknown as Client;
  /* An EventEmitter with no `error` listener rethrows, and this one lives in the
     server process — a swarm-level failure was taking down the whole app, which
     surfaces as unrelated pages hanging while Next recovers. Per-torrent errors
     are still handled where they are awaited. */
  client.on("error", (e) => {
    console.warn("[torrent] client error:", e instanceof Error ? e.message : e);
  });
  return client;
}

const readyWait = new Map<string, Promise<Torrent>>();

function waitReady(t: Torrent, ms = 30_000): Promise<Torrent> {
  if (t.ready) return Promise.resolve(t);
  const key = t.infoHash;
  const hit = readyWait.get(key);
  if (hit) return hit;
  const p = new Promise<Torrent>((resolve, reject) => {
    const to = setTimeout(() => {
      kill(t);
      done(new Error("Torrent metadata timed out."));
    }, ms);
    const done = (err?: Error) => {
      clearTimeout(to);
      readyWait.delete(key);
      err ? reject(err) : resolve(t);
    };
    t.once("ready", () => done());
    t.once("error", (...args: unknown[]) =>
      done(args[0] instanceof Error ? args[0] : new Error("Torrent error.")),
    );
  });
  readyWait.set(key, p);
  return p;
}

function kill(t: Torrent, destroyStore = true) {
  try {
    t.destroy({ destroyStore });
  } catch {
    /* already gone */
  }
}

/** Keep losing race torrents in memory but stop them eating peer slots. */
function pauseOthers(keep: string) {
  const wt = client;
  if (!wt) return;
  const keepKey = keep.toLowerCase();
  for (const t of [...wt.torrents]) {
    if (t.infoHash === keepKey) continue;
    try {
      for (const f of t.files) f.deselect();
      t.pause();
    } catch {
      /* already gone */
    }
  }
}

/** Drop every torrent except `keep`, so a failover cannot stack season packs in RAM. */
function dropOthers(keep: string, keepStore = false) {
  const wt = client;
  if (!wt) return;
  const keepKey = keep.toLowerCase();
  for (const t of [...wt.torrents]) {
    if (t.infoHash === keepKey) continue;
    kill(t, !keepStore);
  }
  for (const [key, p] of pending) {
    if (key === keepKey) continue;
    pending.delete(key);
    void p.then((t) => kill(t, !keepStore), () => undefined);
  }
}

type RacePoolEntry = { ih: string; fileIdx: number | null; torrent: Torrent; order: number };

type RacePool = {
  key: string;
  store: string;
  keepStore: boolean;
  entries: RacePoolEntry[];
  timer: ReturnType<typeof setTimeout>;
};

const racePools = new Map<string, RacePool>();

export function racePoolKey(ihs: string[], store: string) {
  return `${store}:${ihs.map((ih) => ih.toLowerCase()).sort().join(",")}`;
}

/** Rank warm race candidates: most bytes on disk first, then original pick order. */
export function rankRaceTry(
  entries: { ih: string; downloaded: number; order: number }[],
  tryN: number,
): string | null {
  const sorted = [...entries].sort(
    (a, b) => b.downloaded - a.downloaded || a.order - b.order,
  );
  return sorted[tryN]?.ih ?? null;
}

function schedulePoolCleanup(pool: RacePool) {
  clearTimeout(pool.timer);
  pool.timer = setTimeout(() => finalizeRacePool(pool.key), RACE_POOL_MS);
}

export function finalizeRacePool(key: string, keepIh?: string) {
  const pool = racePools.get(key);
  if (!pool) return;
  clearTimeout(pool.timer);
  racePools.delete(key);
  const keep = keepIh?.toLowerCase();
  for (const { ih, torrent } of pool.entries) {
    if (keep && ih === keep) continue;
    kill(torrent, !pool.keepStore);
  }
}

export function finalizeRacePoolsForStore(store: string, keepIh?: string) {
  for (const key of [...racePools.keys()]) {
    const pool = racePools.get(key);
    if (pool?.store === store) finalizeRacePool(key, keepIh);
  }
}

/** Snapshot warm torrents from an in-flight race for later `try=` failover. */
export function snapshotRacePool(
  list: { ih: string; fileIdx: number | null }[],
  store = DIR,
  keepStore = store !== DIR,
): RacePool | null {
  const wt = client;
  if (!wt) return null;
  const key = racePoolKey(
    list.map((x) => x.ih),
    store,
  );
  const existing = racePools.get(key);
  if (existing) clearTimeout(existing.timer);

  const entries: RacePoolEntry[] = [];
  list.forEach(({ ih, fileIdx }, order) => {
    const keyIh = ih.toLowerCase();
    const torrent = wt.torrents.find((t) => t.infoHash === keyIh);
    if (torrent?.ready) entries.push({ ih: keyIh, fileIdx, torrent, order });
  });
  if (!entries.length) return null;

  const pool: RacePool = {
    key,
    store,
    keepStore,
    entries,
    timer: setTimeout(() => finalizeRacePool(key), RACE_POOL_MS),
  };
  racePools.set(key, pool);
  schedulePoolCleanup(pool);
  return pool;
}

export function pickFromRacePool(
  list: { ih: string; fileIdx: number | null }[],
  tryN: number,
  want: Slot | undefined,
  store = DIR,
): { ih: string; file: TorrentFile } | null {
  const key = racePoolKey(
    list.map((x) => x.ih),
    store,
  );
  const pool = racePools.get(key);
  if (!pool) return null;

  const ih = rankRaceTry(
    pool.entries.map((e) => ({
      ih: e.ih,
      downloaded: e.torrent.downloaded,
      order: e.order,
    })),
    tryN,
  );
  if (!ih) return null;

  const entry = pool.entries.find((e) => e.ih === ih);
  if (!entry) return null;
  try {
    entry.torrent.resume();
    const file = fileFromTorrent(entry.torrent, entry.fileIdx, want);
    pauseOthers(ih);
    schedulePoolCleanup(pool);
    return { ih, file };
  } catch {
    return null;
  }
}

/** Player left: detach peers. Per-anime cache stores are kept on disk. */
export function dropTorrents(keepStore = false) {
  for (const key of [...racePools.keys()]) finalizeRacePool(key);
  const wt = client;
  if (!wt) return;
  for (const t of [...wt.torrents]) kill(t, !keepStore);
  for (const p of pending.values()) void p.then((t) => kill(t, !keepStore), () => undefined);
  pending.clear();
}

export type Slot = { season: number; episode: number };

/**
 * How well a file inside a torrent matches the episode we asked for.
 *
 * Season packs hold one file per episode, so `fileIdx` (or "the biggest file")
 * plays a random episode — that is how episode 1 became episode 38. Returns 0
 * for "does not name this episode".
 */
/** Not 5.5 / 05b / 0.5 — those are OVAs, not episode 5. `.1080p` is still fine. */
const EP_TAIL = "(?![\\da-z])(?!\\.\\d{1,2}(?!\\d))";

export function fileScore(path: string, want: Slot): number {
  const s = String(want.season).padStart(2, "0");
  const e = String(want.episode).padStart(2, "0");

  // Season and episode together: unambiguous, nothing else can beat it.
  if (new RegExp(`s0*${want.season}[\\s._-]?e0*${want.episode}${EP_TAIL}`, "i").test(path)) return 10;
  if (new RegExp(`\\b0*${want.season}x0*${want.episode}${EP_TAIL}`, "i").test(path)) return 10;
  if (new RegExp(`\\b${s}${e}${EP_TAIL}`, "i").test(path)) return 9;

  // Episode alone. A pack folder naming the season corroborates it.
  const bare = new RegExp(`(?:\\bep?(?:isode)?[\\s._-]?|\\s-\\s|\\[)0*${want.episode}${EP_TAIL}`, "i");
  if (!bare.test(path)) return 0;
  const seasonNamed =
    new RegExp(`(?:\\bs0*${want.season}\\b|season[\\s._-]*0*${want.season}\\b)`, "i").test(path);
  const otherSeason = /(?:\bs(\d{1,2})\b|season[\s._-]*(\d{1,2})\b)/i.exec(path);
  if (!seasonNamed && otherSeason) return 0;
  return seasonNamed ? 6 : 3;
}

/** Picks the file for `want`, or null when nothing in the torrent names it. */
export function pickFile<T extends { path: string; name: string; length: number }>(
  pool: T[],
  want: Slot,
): T | null {
  const scored = pool
    .map((f) => ({ f, score: fileScore(f.path || f.name, want) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.f.length - a.f.length);
  return scored[0]?.f ?? null;
}

/**
 * The episode a filename claims, when it claims one unambiguously.
 *
 * Same patterns `fileScore` trusts to *choose* a file inside a pack, used here to
 * *reject* one: a torrent holding a single video was handed over without ever
 * checking it, so an addon offering "episode 1122" under episode 1 was believed.
 * Only evidence against counts — a file that names no episode is still played,
 * because plenty of good ones are simply called `video.mkv`.
 */
export function claimsEpisode(path: string): number | null {
  const se = new RegExp(`s\\d{1,2}[\\s._-]?e(\\d{1,3})${EP_TAIL}`, "i").exec(path);
  if (se) return Number(se[1]);
  const x = new RegExp(`\\b\\d{1,2}x(\\d{1,3})${EP_TAIL}`, "i").exec(path);
  if (x) return Number(x[1]);
  /* Four digits, because One Piece is past 1100 and a three-digit cap made this
     guard silently useless on exactly the shows long enough to need it. A bare
     number in 1900–2099 is a release year, so it is not read as an episode. */
  const ep = new RegExp(`(?:\\bep?(?:isode)?[\\s._-]?|\\s-\\s)(\\d{1,4})${EP_TAIL}`, "i").exec(path);
  if (!ep) return null;
  const n = Number(ep[1]);
  return n >= 1900 && n <= 2099 ? null : n;
}

function only(file: TorrentFile, files: TorrentFile[]) {
  for (const f of files) {
    if (f === file) f.select();
    else f.deselect();
  }
  return file;
}

/**
 * The .torrent, kept next to the pieces.
 *
 * Fetching metadata off the DHT is the single biggest fixed cost of starting a
 * torrent — up to `RACE_META_MS` before a single video byte is even requested,
 * and it was paid again on every rewatch, every next episode of a season pack
 * (same infohash), and every server restart. Twenty kilobytes on disk removes
 * it entirely, and unlike an in-memory warm pool it survives the player leaving.
 */
function metaFile(store: string, ih: string) {
  return join(store, `${ih}.torrent`);
}

function loadMeta(store: string, ih: string): Uint8Array | null {
  try {
    const path = metaFile(store, ih);
    return existsSync(path) ? readFileSync(path) : null;
  } catch {
    return null;
  }
}

function saveMeta(store: string, ih: string, t: Torrent) {
  try {
    const path = metaFile(store, ih);
    if (!existsSync(path) && t.torrentFile?.byteLength) writeFileSync(path, t.torrentFile);
  } catch {
    /* a cache write must never fail a play */
  }
}

async function addTorrent(ih: string, metaMs = 30_000, store = DIR): Promise<Torrent> {
  if (!HASH.test(ih)) throw new Error("Bad info hash.");
  const key = ih.toLowerCase();
  mkdirSync(store, { recursive: true });
  const wt = getClient();
  const existing = wt.torrents.find((t) => t.infoHash === key);
  if (existing) return waitReady(existing, metaMs);
  /* Keyed by infohash alone, like the `wt.torrents` lookup above: WebTorrent allows
     one swarm per hash regardless of where its files land, so keying this by
     store too let the same hash be added twice — "Cannot add duplicate torrent",
     thrown where nobody was waiting for it. */
  let p = pending.get(key);
  if (!p) {
    const seed = loadMeta(store, key) ?? magnet(key);
    p = waitReady(
      wt.add(seed, { path: store, deselect: true, announce: TRACKERS }),
      metaMs,
    ).then((t) => {
      saveMeta(store, key, t);
      return t;
    });
    pending.set(key, p);
    void p.catch(() => undefined).finally(() => pending.delete(key));
  }
  return p;
}

/**
 * Fires once the selected file has fully downloaded.
 *
 * The cache must never adopt a half-downloaded file: WebTorrent preallocates at
 * full length, so size alone says nothing about how much of it is real.
 */
export function onSelectedComplete(ih: string, cb: () => void) {
  const t = client?.torrents.find((x) => x.infoHash === ih.toLowerCase());
  if (!t) return;
  if (t.done) {
    cb();
    return;
  }
  t.once("done", () => cb());
}

function fileFromTorrent(t: Torrent, fileIdx: number | null, want?: Slot): TorrentFile {
  const files = t.files;
  if (!files.length) throw new Error("Torrent has no files.");
  const videos = files.filter((f) => VIDEO.test(f.name));
  const pool = videos.length ? videos : files;

  if (pool.length === 1) {
    const claimed = want ? claimsEpisode(pool[0].path || pool[0].name) : null;
    if (want && claimed != null && claimed !== want.episode) {
      throw new Error(
        `This torrent holds episode ${claimed}, not episode ${want.episode}.`,
      );
    }
    return only(pool[0], files);
  }

  if (want) {
    const hit = pickFile(pool, want);
    if (hit) return only(hit, files);
    throw new Error(
      `This torrent holds ${pool.length} video files and none is named as season ${want.season} episode ${want.episode}.`,
    );
  }

  if (fileIdx != null && files[fileIdx]) return only(files[fileIdx], files);
  return only([...pool].sort((a, b) => b.length - a.length)[0], files);
}

/**
 * Wait for proof that this swarm can actually feed us.
 *
 * The bytes must be *new*. `t.downloaded` counts everything verified this session,
 * including pieces recovered from a previous attempt's partial download — so a
 * torrent whose swarm is dead reported a quarter-megabyte instantly, won the race
 * against candidates that worked, streamed the few megabytes it already had, and
 * then hung forever at the edge of that cache. Measured on One-Punch Man episode 2:
 * 206 headers, exactly 8,388,608 bytes, then nothing, while the swarm sat at one
 * peer and 0 KB/s. Every failed attempt leaves more cache behind, so the problem
 * compounds: the more you retry, the more reliably the dead torrent wins.
 *
 * Data already on disk still wins instantly — it needs no peers at all — but that
 * is decided by looking at the file, not by a counter that cannot tell the
 * difference between a download and a memory.
 */
function waitFirstByte(
  t: Torrent,
  ms: number,
  minBytes = MIN_RACE_BYTES,
  file?: TorrentFile,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (t.done || (file && file.progress >= 1)) {
      resolve();
      return;
    }
    const already = t.downloaded;
    const to = setTimeout(() => done(new Error("No data from peers.")), ms);
    const onDL = () => {
      if (t.downloaded - already >= minBytes) done();
    };
    const onErr = (...args: unknown[]) =>
      done(args[0] instanceof Error ? args[0] : new Error("Torrent error."));
    const done = (err?: Error) => {
      clearTimeout(to);
      t.removeListener("download", onDL);
      t.removeListener("error", onErr);
      err ? reject(err) : resolve();
    };
    t.on("download", onDL);
    t.once("error", onErr);
  });
}

/** Connect to several torrents at once; the first with peers wins, the rest stay warm. */
export async function raceTorrentFiles(
  pairs: { ih: string; fileIdx: number | null }[],
  want?: Slot,
  max = TORRENT_RACE_MAX,
  store = DIR,
): Promise<{ ih: string; file: TorrentFile }> {
  const seen = new Set<string>();
  const list: { ih: string; fileIdx: number | null }[] = [];
  for (const p of pairs) {
    const key = p.ih.toLowerCase();
    if (!HASH.test(key) || seen.has(key)) continue;
    seen.add(key);
    list.push({ ih: key, fileIdx: p.fileIdx });
    if (list.length >= max) break;
  }
  if (!list.length) throw new Error("No torrents to race.");
  if (list.length === 1) {
    const file = await torrentFile(list[0].ih, list[0].fileIdx, want, store);
    return { ih: list[0].ih, file };
  }

  const keepStore = store !== DIR;

  return new Promise((resolve, reject) => {
    let settled = false;
    let failed = 0;
    const lose = () => {
      failed++;
      if (!settled && failed >= list.length) {
        settled = true;
        finalizeRacePool(racePoolKey(list.map((x) => x.ih), store));
        reject(new Error("No torrent in this race had seeders."));
      }
    };
    for (const { ih, fileIdx } of list) {
      void (async () => {
        try {
          const t = await addTorrent(ih, RACE_META_MS, store);
          if (settled) return;
          const file = fileFromTorrent(t, fileIdx, want);
          await waitFirstByte(t, FIRST_BYTE_MS, MIN_RACE_BYTES, file);
          if (settled) return;
          settled = true;
          snapshotRacePool(list, store, keepStore);
          pauseOthers(ih);
          resolve({ ih, file });
        } catch {
          lose();
        }
      })().catch(lose);
    }
  });
}

export async function torrentFile(
  ih: string,
  fileIdx: number | null,
  want?: Slot,
  store = DIR,
): Promise<TorrentFile> {
  const key = ih.toLowerCase();
  const keepStore = store !== DIR;
  dropOthers(key, keepStore);
  try {
    const t = await addTorrent(key, 30_000, store);
    return fileFromTorrent(t, fileIdx, want);
  } catch (e) {
    if (store === DIR) throw e;
    const t = await addTorrent(key, 30_000, DIR);
    return fileFromTorrent(t, fileIdx, want);
  }
}

export function fileStream(file: TorrentFile, start: number, end: number): ReadableStream<Uint8Array> {
  const iter = file[Symbol.asyncIterator]({ start, end });
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iter.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value instanceof Uint8Array ? value : new Uint8Array(value));
    },
    cancel() {
      void iter.return?.();
    },
  });
}

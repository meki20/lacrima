import { LANGS, bucketLangs, subtitleLangs, trackLangs, type Lang } from "./audio.ts";

/**
 * The layer between addon listings and the player.
 *
 * Addons speak torrents, DualDub, DDP, fileIdx. The `<video>` element only
 * uses what the OS exposes — not ffmpeg. HEVC can work on some machines
 * (Safari, Windows with the HEVC extension); AV1 works in current Chrome.
 * DDP/DTS/FLAC in MKV usually plays video with *no audio*, which is worse
 * than failing loudly, so those are the only hard rejects. HEVC is kept but
 * ranked after H.264 + AAC.
 */

/**
 * Bump when a change to matching or ranking would pick a different stream.
 *
 * Resolved streams are cached in three places that never expire on their own —
 * `resolveStreams`' in-process map, the saved playlist, and the committed pick —
 * so a title played once keeps replaying whatever the *old* rules chose. One-Punch
 * Man went on serving season three's episode 1 after the rules that chose it were
 * fixed, because nothing ever asked the question again. It lives here because
 * every one of those layers already imports this module.
 */
export const RANK_VERSION = 8;

export type Quality = "2160p" | "1080p" | "720p" | "480p";

export type StreamPick = { url: string; provider: string; hint?: string; subtitles?: Lang[] };

/** How many torrents the player races inside one quality bucket. */
export const TORRENT_RACE_MAX = 6;

export function isTorrentPick(pick: StreamPick): boolean {
  return pick.url.includes("ih=");
}

export function isTorrentRaceUrl(url: string): boolean {
  const u = new URL(url, "http://lacrima.local");
  return u.searchParams.has("ih") && u.searchParams.getAll("ih").length > 1;
}

/** HTTP and torrent candidates racing on the same relay request. */
export function isMixedRaceUrl(url: string): boolean {
  const u = new URL(url, "http://lacrima.local");
  return u.searchParams.has("url") && u.searchParams.has("ih");
}

export function splitPicks(picks: StreamPick[]) {
  const http: StreamPick[] = [];
  const torrent: StreamPick[] = [];
  for (const p of picks) {
    (isTorrentPick(p) ? torrent : http).push(p);
  }
  return { http, torrent };
}

/** One relay URL that races up to `max` torrent picks; a single pick passes through. */
export function torrentRaceUrl(picks: StreamPick[], batch = 0, max = TORRENT_RACE_MAX): string | null {
  const batchPicks = picks.filter(isTorrentPick).slice(batch * max, (batch + 1) * max);
  if (!batchPicks.length) return null;
  if (batchPicks.length === 1) return batchPicks[0].url;
  const params = new URLSearchParams();
  for (const p of batchPicks) {
    const u = new URL(p.url, "http://lacrima.local");
    const ih = u.searchParams.get("ih");
    if (!ih) continue;
    params.append("ih", ih);
    const i = u.searchParams.get("i");
    if (i != null) params.append("i", i);
  }
  if (!params.getAll("ih").length) return null;
  const u0 = new URL(batchPicks[0].url, "http://lacrima.local");
  for (const k of ["s", "e"]) {
    const v = u0.searchParams.get(k);
    if (v) params.set(k, v);
  }
  return `/api/stream?${params}`;
}

/**
 * Ask the relay to hand back this source with one chosen audio track.
 *
 * Everything plays through here. A browser cannot pick an audio track — Chrome
 * exposes no `audioTracks` — and sources ship single files carrying Hindi, English
 * and Japanese at once, so without this the viewer gets whichever track happens to
 * be first. The same pass normalises audio no browser decodes (DDP, AC3, DTS).
 *
 * `t` restarts the remux at a keyframe: a live pipe cannot answer a byte range, so
 * seeking is a new request rather than a range on the old one.
 */
export function remuxUrl(url: string | null, lang?: Lang, seek = 0, subtitle?: Lang): string | null {
  if (!url) return null;
  const u = new URL(url, "http://lacrima.local");
  u.searchParams.set("remux", "1");
  if (lang) u.searchParams.set("lang", lang);
  if (subtitle) u.searchParams.set("sub", subtitle);
  if (seek > 0) u.searchParams.set("t", String(Math.round(seek * 100) / 100));
  return `${u.pathname}${u.search}`;
}

/** Swap to the next warm torrent in an in-flight race without reconnecting. */
export function withRaceTry(url: string | null, tryN: number): string | null {
  if (!url || tryN <= 0) return url;
  if (!isTorrentRaceUrl(url) && !isMixedRaceUrl(url)) return url;
  const u = new URL(url, "http://lacrima.local");
  u.searchParams.set("try", String(tryN));
  return `${u.pathname}${u.search}`;
}

/**
 * How long the player may wait for canPlay before this URL is a bust.
 * Warm `try=` swaps are already connected; a fresh race has to find peers.
 */
export function srcDeadlineMs(url: string): number {
  const u = new URL(url, "http://lacrima.local");
  const tryN = Math.max(0, Number(u.searchParams.get("try") ?? 0) || 0);
  if (tryN > 0) return 12_000;
  /*
   * A mixed race carries a direct link, and a direct link answers in about a
   * second — so it must not inherit the torrent budget just because torrents are
   * racing alongside it.
   *
   * Some hosts serve byte 0 instantly and then stall forever on a range deep into
   * the file, which is exactly what a resume seek asks for: One-Punch Man episode 3
   * resumes at 9:04, `bytes=0-2047` returned at once and the seek never came back.
   * The player cannot tell that apart from a slow start, so the budget is what
   * decides whether it recovers in fifteen seconds or looks broken for forty-five.
   */
  if (u.searchParams.get("remux") === "1" && u.searchParams.has("cv")) return 120_000;
  if (u.searchParams.has("url") && u.searchParams.has("ih")) return 15_000;
  if (u.searchParams.has("ih")) return 45_000;
  if (isScrape(u.searchParams.get("url") ?? "")) return 8_000;
  return 15_000;
}

/** Race the best HTTP pick against a torrent batch; first bytes win on the server. */
export function mixedRaceUrl(
  httpPicks: StreamPick[],
  torrentPicks: StreamPick[],
  httpAt = 0,
  torrentBatch = 0,
  max = TORRENT_RACE_MAX,
): string | null {
  const http = httpPicks[httpAt];
  const torrentUrl = torrentRaceUrl(torrentPicks, torrentBatch, max);
  if (!http || !torrentUrl) return null;
  const hu = new URL(http.url, "http://lacrima.local");
  const raw = hu.searchParams.get("url");
  if (!raw) return null;
  /* The player has to commit to HLS or plain video before a byte arrives, and in a
     mixed race it cannot know which side will win. Carrying `hls=1` across meant
     that when the torrent won — which is the normal outcome once the HTTP source
     is dead — hls.js was handed an MKV and died on "no EXTM3U delimiter".
     An HLS pick races alone; the caller already falls back to it, then to torrents. */
  if (hu.searchParams.get("hls") === "1") return null;
  const params = new URLSearchParams(new URL(torrentUrl, "http://lacrima.local").search);
  params.set("url", raw);
  const ref = hu.searchParams.get("referer");
  if (ref) params.set("referer", ref);
  const hls = hu.searchParams.get("hls");
  if (hls) params.set("hls", hls);
  /* The remux can reject a file whose advertised language is not actually in
     its tracks. Carry a few direct alternatives so that rejection can recover
     inside the same request instead of looking like a fifteen-second stall. */
  for (const pick of httpPicks.slice(httpAt + 1, httpAt + 5)) {
    params.append("alt", pick.url);
  }
  return `/api/stream?${params}`;
}

export type StreamGroup = {
  id: string;
  quality: Quality;
  lang: Lang;
  label: string;
  picks: StreamPick[];
};

export type Playlist = { groups: StreamGroup[]; preferred: string | null };

export function qualitiesForLang(groups: StreamGroup[], lang: Lang): StreamGroup[] {
  return groups.filter((g) => g.lang === lang);
}

/** First group per language — `present()` already sorted quality, so this is the best of that dub. */
export function langChoices(groups: StreamGroup[]): { lang: Lang; id: string; label: string }[] {
  const seen = new Set<Lang>();
  const out: { lang: Lang; id: string; label: string }[] = [];
  for (const g of groups) {
    if (seen.has(g.lang)) continue;
    seen.add(g.lang);
    out.push({ lang: g.lang, id: g.id, label: LANGS.find((l) => l.id === g.lang)?.label ?? g.lang });
  }
  return out;
}

export type Candidate = {
  text: string;
  url: string;
  provider: string;
  /** False when the addon sent no title, filename or description — see `rankRows`. */
  described?: boolean;
  /** True when the filename names exactly the work we asked for. */
  sameWork?: boolean;
  /** True when the listing names the season and episode asked for, not a bare number. */
  exactSlot?: boolean;
  /** Subtitle languages the listing says are embedded in this file. */
  subtitles?: Lang[];
};

const QORDER: Quality[] = ["1080p", "720p", "2160p", "480p"];

function qualityOf(text: string): Quality {
  if (/\b(2160p|4k)\b/i.test(text)) return "2160p";
  if (/\b(1080p?|fhd)\b/i.test(text)) return "1080p";
  if (/\b720p?\b/i.test(text)) return "720p";
  if (/\b(480p?|sd)\b/i.test(text)) return "480p";
  return "1080p";
}

/**
 * How many peers the addon says are seeding.
 *
 * The single best predictor of whether a torrent will ever start playing, and it
 * was sitting unread in every listing. `raceTorrentFiles` connects the first six
 * picks in a bucket and waits `FIRST_BYTE_MS` (22s) for one to produce bytes, so
 * ranking a 2-seeder above a 108-seeder does not merely pick a worse stream — it
 * spends the user's first twenty-two seconds on a swarm that has nobody in it.
 *
 * `null`, not 0, when the listing does not say: HTTP streams have no seeders and
 * must not be punished for it.
 */
export function seeders(text: string): number | null {
  const m = /(?:👤|👥|🌱)\s*(\d[\d.,]*)|\b(?:seed(?:er)?s?|se?)\s*[:=]\s*(\d[\d.,]*)/i.exec(text);
  if (!m) return null;
  const n = Number((m[1] ?? m[2]).replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Total torrent size in GB, from `💾 1.5 GB` / `📏 259.9 MiB`. */
export function sizeGb(text: string): number | null {
  const m = /(?:💾|📏)?\s*(\d+(?:\.\d+)?)\s*(gi?b|mi?b|ti?b)\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith("t")) return n * 1024;
  if (unit.startsWith("m")) return n / 1024;
  return n;
}

/**
 * Seeder count as a rank bonus: strongly diminishing, because the gap between
 * 2 and 30 peers decides whether playback starts, and the gap between 100 and
 * 400 decides nothing.
 */
function seedScore(text: string): number {
  const s = seeders(text);
  if (s == null) return 0;
  if (s <= 0) return -10;
  return Math.min(12, Math.round(Math.log2(1 + s) * 2));
}

/**
 * Remuxes and full-series packs are technically playable and practically not:
 * a 145 GB Death Note is a BD remux at roughly 23 Mbps per episode, which
 * WebTorrent will buffer forever. Mild, because total size cannot be told apart
 * from a legitimate season pack whose one selected file is small.
 */
function sizeScore(text: string): number {
  const gb = sizeGb(text);
  if (gb == null) return 0;
  if (gb > 60) return -6;
  if (gb > 20) return -3;
  return 0;
}

function videoOf(text: string): "hevc" | "av1" | "avc" | "unknown" {
  if (/\b(hevc|x265|h\.?265)\b/i.test(text)) return "hevc";
  if (/\bav1\b/i.test(text)) return "av1";
  if (/\b(x264|h\.?264|avc)\b/i.test(text)) return "avc";
  return "unknown";
}

function audioOf(
  text: string,
): "ddp" | "ac3" | "dts" | "flac" | "truehd" | "aac" | "opus" | "mp3" | "unknown" {
  if (/\b(truehd|atmos)\b/i.test(text)) return "truehd";
  /* `EAC3` is written without hyphens as often as with them, and the hyphenated
     form was the only one matched — so Death Note's best direct link read as
     "unknown audio" and would have played picture with no sound. */
  if (/\bddp|\be-?ac-?3\b/i.test(text)) return "ddp";
  /* Plain Dolby Digital, written AC3 or DD5.1. Chrome refuses `ac-3` for the same
     licensing reason it refuses `ec-3`, so this is not the milder sibling of DDP —
     it is the same silent video, and it used to slip through as "unknown". */
  if (/\bac-?3\b|\bdd[\s._-]?[257]\.[01]\b/i.test(text)) return "ac3";
  if (/\bdts\b/i.test(text)) return "dts";
  if (/\bflac\b/i.test(text)) return "flac";
  if (/\bopus\b/i.test(text)) return "opus";
  if (/\baac/i.test(text)) return "aac";
  if (/\bmp3\b/i.test(text)) return "mp3";
  return "unknown";
}

/**
 * Hard reject: encodes that often show a picture but stay silent in Chrome,
 * or are obviously junk. HEVC/AV1 are not rejected — they may work and
 * failover handles the rest.
 */
export function browserPlayable(text: string): boolean {
  /*
   * Almost nothing is unplayable any more.
   *
   * This used to reject DDP, AC3, DTS, FLAC, TrueHD and AVI on sight, because the
   * browser would show a picture with no sound — and those tags sit on a large
   * share of the best releases, so the rule was quietly discarding most of what
   * the sources had. Every one of them now goes through the relay's remux, which
   * re-encodes the audio track to AAC and rewraps the container, so the reason to
   * refuse them is gone.
   *
   * A cam is still a cam: that is about what the picture is worth, not what the
   * browser can decode. Video codecs the browser cannot handle are *ranked* down
   * rather than rejected, because video is only ever stream-copied.
   */
  return !/\b(cam|telesync)\b/i.test(text);
}

/** PenguPlay scrapes — links rot often and buffer through a double hop. */
const SCRAPE = /\b(?:Miruro|2Peckle|Animegg|AnimeGG)\b/i;

/**
 * A link that just serves bytes, from a source not known to rot.
 *
 * Time to first frame is the difference the viewer actually feels: a direct link
 * starts in about a second, while a torrent must fetch metadata, find peers and
 * buffer — and `raceTorrentFiles` waits up to `FIRST_BYTE_MS` (22s) before
 * writing off a whole batch. Even a four-hundred-peer swarm loses that race.
 *
 * Deliberately a tier and not a weight. As a weight it was worth twenty points
 * and still lost, because a Crunchyroll `MULTi` release gives up fourteen on the
 * language rules alone — quality scoring is not a currency that can be traded
 * against latency. Rot is handled where it belongs: `SCRAPE` sources are excluded
 * here, and `srcDeadlineMs` puts a dead link on a short leash before failover.
 */
function direct(c: Candidate): boolean {
  return c.url.includes("url=") && !SCRAPE.test(c.text);
}

export function preferUrl(text: string, url: string, lang: Lang): number {
  const buckets = bucketLangs(text);
  let n = 0;
  if (buckets.length === 1 && buckets[0] === lang) n += 8;
  else if (buckets.includes(lang)) n += 2;
  if (lang === "ja" && /🎧\s*Audio:\s*Japanese/i.test(text)) n += 3;
  if (lang === "ja" && /🔊[^\n]*🇯🇵/u.test(text)) n += 4;
  if (lang === "ja" && subtitleLangs(text).includes("en")) n += 6;
  if (lang === "en" && /\benglish\s*dub\b/i.test(text)) n += 6;
  if (lang === "ja" && /\bsub\b/i.test(text) && !/\bdub\b/i.test(text)) n += 4;
  if (lang === "ja" && /\bmulti\b/i.test(text) && !/🎧\s*Audio:\s*Japanese/i.test(text)) n -= 8;
  if (lang === "en" && trackLangs(text).includes("ja") && trackLangs(text).includes("en")) n -= 3;
  if (SCRAPE.test(text)) n -= 15;
  // Seeders and size decide among torrents; see `direct` for HTTP against them.
  if (url.includes("ih=")) n += seedScore(text) + sizeScore(text);
  const v = videoOf(text);
  const a = audioOf(text);
  if (v === "avc") n += 3;
  else if (v === "hevc") n += 1;
  /* Chrome's HEVC support on Windows is the 8-bit Main profile via the store
     extension; Main10 decodes on almost nothing, so 10-bit is a black picture
     rather than a slow one. Not a hard reject — Safari on Apple silicon plays it,
     and phones on the same network are real clients — but it must lose to any
     8-bit alternative, however much better seeded that alternative is not. */
  if (/\b10[\s._-]?bit\b/i.test(text) && (v === "hevc" || v === "av1")) n -= 12;
  if (a === "aac" || a === "opus" || a === "mp3") n += 2;
  if (url.includes("url=") && /\bWEB-DL\b/i.test(text) && v === "avc" && a === "aac") n += 4;
  else if (url.includes("url=") && !SCRAPE.test(text)) n += 1;
  return n;
}

export function isScrape(text: string): boolean {
  return SCRAPE.test(text);
}

/**
 * A listing that is only a provider name and a resolution — `Peerflix 🇪🇸 1080p`,
 * with no title, filename or description — has told us nothing checkable: not the
 * codec, not the audio language, not the episode, not even which work it is. Every
 * text rule above silently passes it, so it used to sort as if it were verified
 * and win the group.
 *
 * It stays in the list, because it may be the only thing that plays. It must never
 * outrank a listing we could actually read.
 */
/**
 * A file naming exactly the work we asked for — "One Piece" over "ONE PIECE 2023",
 * which is the live action.
 *
 * Weighted rather than absolute, on purpose. As a tier above everything it decided
 * matches it has no business deciding: an alternate romanisation is unjudgeable,
 * not wrong, so "Shingeki no Kyojin" scores 0 here, and a 10-bit HEVC that happens
 * to use the English title was beating an x264 that plays. Big enough to settle
 * otherwise-equal picks, small enough to lose to a codec that cannot decode.
 */
const SAME_WORK_BONUS = 8;

/**
 * Naming the exact slot outranks naming the work, because the season is the thing
 * that actually goes wrong: `One Punch Man (2025) - 01` is the same work and the
 * wrong show to hand someone who asked for season one, episode one.
 */
const EXACT_SLOT_BONUS = 14;

const rowScore = (c: Candidate, lang: Lang) =>
  preferUrl(c.text, c.url, lang) +
  (c.sameWork ? SAME_WORK_BONUS : 0) +
  (c.exactSlot ? EXACT_SLOT_BONUS : 0);

function rankRows(rows: Candidate[], lang: Lang): Candidate[] {
  return [...rows].sort((a, b) => {
    const pa = browserPlayable(a.text) ? 1000 : 0;
    const pb = browserPlayable(b.text) ? 1000 : 0;
    if (pa !== pb) return pb - pa;
    const da = a.described === false ? 0 : 100;
    const db = b.described === false ? 0 : 100;
    if (da !== db) return db - da;
    const ha = direct(a) ? 10 : 0;
    const hb = direct(b) ? 10 : 0;
    if (ha !== hb) return hb - ha;
    return rowScore(b, lang) - rowScore(a, lang);
  });
}

export function present(items: Candidate[], prefer?: Lang): Playlist {
  const buckets = new Map<string, Candidate[]>();
  for (const item of items) {
    if (!item.url) continue;
    const q = qualityOf(item.text);
    for (const lang of bucketLangs(item.text)) {
      const id = `${q}-${lang}`;
      const rows = buckets.get(id);
      if (rows) rows.push(item);
      else buckets.set(id, [item]);
    }
  }

  const groups: StreamGroup[] = [];
  for (const q of QORDER) {
    for (const { id: lang, label } of LANGS) {
      const rows = buckets.get(`${q}-${lang}`);
      if (!rows?.length) continue;
      const seen = new Set<string>();
      const picks: StreamPick[] = [];
      for (const r of rankRows(rows, lang)) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        picks.push({
          url: r.url,
          provider: r.provider,
          hint: r.text,
          subtitles: r.subtitles ?? subtitleLangs(r.text),
        });
      }
      if (!picks.length) continue;
      groups.push({ id: `${q}-${lang}`, quality: q, lang, label: `${q} · ${label}`, picks });
    }
  }

  const preferred = groups.find((g) => g.lang === "ja")?.id ?? groups[0]?.id ?? null;
  return forLang({ groups, preferred }, prefer);
}

/**
 * Drop picks from sources that are no longer installed.
 *
 * The saved playlist is the fast path and never expires, so removing a bad addon
 * did not stop it playing: its picks kept being served from disk for every title
 * already resolved. Removing a source has to take effect on the next play, or the
 * only working remedy is deleting cache files by hand.
 *
 * `null` for `installed` means "we could not find out" — a source-listing failure
 * must not empty a playlist that is probably fine.
 */
export function fromProviders(
  pl: Playlist | null,
  installed: Set<string> | null,
): Playlist | null {
  if (!pl || !installed) return pl;
  const groups = pl.groups
    .map((g) => ({ ...g, picks: g.picks.filter((p) => installed.has(p.provider)) }))
    .filter((g) => g.picks.length > 0);
  if (!groups.length) return null;
  return { groups, preferred: groups.find((g) => g.id === pl.preferred)?.id ?? groups[0].id };
}

/**
 * Open a playlist in a given language.
 *
 * A stored playlist has to serve every language it contains, because the one on
 * disk is shared by whoever asks next — so which group leads is a property of the
 * request, not of the resolve that built it. Quality order is untouched.
 */
export function forLang(pl: Playlist, lang?: Lang): Playlist {
  if (!lang) return pl;
  const groups = [...pl.groups].sort((a, b) => {
    const q = QORDER.indexOf(a.quality) - QORDER.indexOf(b.quality);
    if (q) return q;
    return (a.lang === lang ? 0 : 1) - (b.lang === lang ? 0 : 1);
  });
  return { groups, preferred: groups.find((g) => g.lang === lang)?.id ?? pl.preferred };
}

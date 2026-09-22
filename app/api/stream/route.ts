import { existsSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import { PLAYLIST_TYPE, isPlaylist, rewritePlaylist } from "@/lib/hls";
import { mimeForPath, playableType, readFileRange } from "@/lib/local-video";
import { parseLang, parseLangToken, type Lang } from "@/lib/audio";
import { probeAudio, probeSubtitleTracks, remuxStream, selfRelayUrl } from "@/lib/remux";
import {
  adoptCompleted,
  cachedFileStat,
  discardPart,
  ensureMediaDir,
  parseCacheCtx,
  partPath,
  playPath,
  promotePart,
  torrentStore,
  hasVideo,
  persistMedia,
  type CacheCtx,
} from "@/lib/play-cache";
import {
  dropTorrents,
  fileStream,
  isInfoHash,
  onSelectedComplete,
  pickFromRacePool,
  raceTorrentFiles,
  snapshotRacePool,
  torrentFile,
  type Slot,
} from "@/lib/torrent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function blocked(ip: string) {
  if (ip === "::1" || ip === "::" || ip === "0.0.0.0") return true;
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) {
    return true;
  }
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  const v6 = ip.toLowerCase();
  return v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function assertPublic(target: URL) {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Unsupported scheme");
  }
  const host = target.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Host not allowed");
  }
  if (isIP(host) && blocked(host)) throw new Error("Host not allowed");
  const { address } = await lookup(host);
  if (blocked(address)) throw new Error("Host not allowed");
}

function byteRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Number(m[2]);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= size || start > end) {
    return null;
  }
  return { start, end };
}

function mediaHeaders(type: string, size: number, range: { start: number; end: number } | null) {
  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-type": type || "application/octet-stream",
    "cache-control": "no-store",
  });
  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("content-length", String(range.end - range.start + 1));
  } else {
    headers.set("content-length", String(size));
  }
  return headers;
}

function wantSlot(q: URLSearchParams): Slot | undefined {
  const season = Number(q.get("s"));
  const episode = Number(q.get("e"));
  if (!Number.isFinite(season) || !Number.isFinite(episode) || episode <= 0) return;
  return { season: Math.max(season, 1), episode };
}

function raceTry(q: URLSearchParams) {
  return Math.max(0, Number(q.get("try") ?? 0) || 0);
}

/* One listener per (episode, torrent), not one per byte-range request. */
const adopting = new Set<string>();

/** Link the torrent's copy into the chapter cache the moment it finishes downloading. */
function adoptWhenComplete(
  ctx: CacheCtx | null,
  ih: string,
  file: { path: string },
  replace = false,
) {
  if (!persistMedia() || !ctx || (!replace && hasVideo(ctx))) return;
  const key = `${ctx.via}|${ctx.mediaId}|${ctx.chapterId}|${ih}|${replace}`;
  if (adopting.has(key)) return;
  adopting.add(key);
  onSelectedComplete(ih, () => {
    adopting.delete(key);
    adoptCompleted(ctx, join(torrentStore(ctx.via, ctx.mediaId), file.path), replace);
  });
}

function streamFile(req: Request, file: Awaited<ReturnType<typeof torrentFile>>) {
  const range = byteRange(req.headers.get("range"), file.length);
  const start = range?.start ?? 0;
  const end = range?.end ?? file.length - 1;
  const type = playableType(file.type);
  const body = fileStream(file, start, end);
  req.signal.addEventListener("abort", () => body.cancel().catch(() => undefined));
  return new Response(body, {
    status: range ? 206 : 200,
    headers: mediaHeaders(type, file.length, range),
  });
}

function cachedResponse(req: Request, ctx: CacheCtx) {
  const hit = cachedFileStat(ctx);
  if (!hit) return null;
  return fileResponse(req, hit.path);
}

function fileResponse(req: Request, path: string) {
  const size = statSync(path).size;
  const range = byteRange(req.headers.get("range"), size);
  if (range === null && req.headers.get("range")) return null;
  const body = readFileRange(path, range);
  const headers = mediaHeaders(mimeForPath(path), body.size, range);
  return new Response(Readable.toWeb(body.stream) as ReadableStream, {
    status: range ? 206 : 200,
    headers,
  });
}

async function fromTorrent(req: Request, ih: string, idx: string | null, ctx: CacheCtx | null) {
  if (!isInfoHash(ih)) return new Response("Bad info hash", { status: 400 });
  const q = new URL(req.url).searchParams;
  const replace = q.get("replace") === "1";
  if (ctx && !replace) {
    const cached = cachedResponse(req, ctx);
    if (cached) return cached;
  }
  const store = ctx ? torrentStore(ctx.via, ctx.mediaId) : undefined;
  try {
    const file = await torrentFile(
      ih,
      idx == null || idx === "" ? null : Number(idx),
      wantSlot(q),
      store,
    );
    adoptWhenComplete(ctx, ih, file, replace);
    return streamFile(req, file);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Torrent failed", { status: 502 });
  }
}

async function fromTorrentRace(
  req: Request,
  pairs: { ih: string; fileIdx: number | null }[],
  ctx: CacheCtx | null,
) {
  for (const { ih } of pairs) {
    if (!isInfoHash(ih)) return new Response("Bad info hash", { status: 400 });
  }
  const q = new URL(req.url).searchParams;
  const replace = q.get("replace") === "1";
  if (ctx && !replace) {
    const cached = cachedResponse(req, ctx);
    if (cached) return cached;
  }
  const store = ctx ? torrentStore(ctx.via, ctx.mediaId) : undefined;
  const tryN = raceTry(q);
  if (tryN > 0) {
    const hit = pickFromRacePool(pairs, tryN, wantSlot(q), store);
    if (!hit) return new Response("No warm race candidates left", { status: 502 });
    adoptWhenComplete(ctx, hit.ih, hit.file, replace);
    return streamFile(req, hit.file);
  }
  try {
    const { ih, file } = await raceTorrentFiles(pairs, wantSlot(q), undefined, store);
    adoptWhenComplete(ctx, ih, file, replace);
    return streamFile(req, file);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Torrent race failed", { status: 502 });
  }
}

/** Playlists are kilobytes. Anything bigger gets streamed, never buffered into memory. */
function small(r: Response) {
  const len = Number(r.headers.get("content-length") ?? 0);
  return len <= 4 << 20;
}

function requestStart(req: Request): number {
  return byteRange(req.headers.get("range"), Number.MAX_SAFE_INTEGER)?.start ?? 0;
}

/** Total size of the resource, not of this range. */
function totalBytes(h: Headers): number | null {
  const m = /\/(\d+)\s*$/.exec(h.get("content-range") ?? "");
  if (m) return Number(m[1]);
  const len = Number(h.get("content-length"));
  return Number.isFinite(len) && len > 0 ? len : null;
}

/**
 * Mirror an HTTP source into `.part`, and promote it only when it is whole.
 *
 * Two rules, both learned the hard way. Only a read that starts at zero can
 * produce a complete file, so a seek is passed straight through — the old code
 * tried to open the part file for update, found the previous request's abort had
 * already deleted it, and errored the response, which meant seeking killed
 * playback. And the rename only happens on a clean end-of-body whose size
 * matches upstream, because the old code promoted whatever had arrived after
 * fifteen seconds and then served those few megabytes as the whole episode.
 *
 * Mirroring is a side effect of watching: bytes go to the player first, and a
 * failed write costs the cache entry, never the stream.
 */
function teeHttp(
  body: ReadableStream<Uint8Array>,
  ctx: CacheCtx,
  offset: number,
  total: number | null,
  replace = false,
) {
  if (!persistMedia() || offset !== 0 || total == null || (!replace && hasVideo(ctx))) return body;
  ensureMediaDir(ctx);
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  let written = 0;
  let broken = false;
  let cancelled = false;
  const reader = body.getReader();
  const shut = async () => {
    const f = fh;
    fh = null;
    await f?.close().catch(() => undefined);
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (cancelled) return;
      if (done) {
        await shut();
        if (broken) discardPart(ctx);
        else promotePart(ctx, total);
        controller.close();
        return;
      }
      controller.enqueue(value);
      if (broken) return;
      try {
        fh ??= await open(partPath(ctx), "w");
        await fh.write(value, 0, value.byteLength, written);
        written += value.byteLength;
      } catch {
        broken = true;
        void shut();
        discardPart(ctx);
      }
    },
    async cancel() {
      cancelled = true;
      await reader.cancel().catch(() => undefined);
      await shut();
      discardPart(ctx);
    },
  });
}

function mergeAbort(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ac = new AbortController();
  const stop = () => ac.abort();
  a.addEventListener("abort", stop);
  b.addEventListener("abort", stop);
  return ac.signal;
}

async function pumpHttp(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    }
  } catch (e) {
    /* This runs detached from the request, so anything thrown here lands on the
       process. Seeking closes the controller under us, and reporting the failure
       to an already-closed controller throws a second time — which is how a
       routine seek became "uncaughtException: Controller is already closed". */
    try {
      controller.error(e);
    } catch {
      /* consumer already gone */
    }
    void reader.cancel().catch(() => undefined);
  }
}

/** HTTP lane for a mixed race: resolve once the upstream body delivers its first chunk. */
async function httpUntilFirstByte(
  req: Request,
  raw: string,
  referer: string | null,
  ctx: CacheCtx | null,
  laneAbort: AbortSignal,
  replace = false,
): Promise<Response> {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("Bad url");
  }
  await assertPublic(target);

  const headers: Record<string, string> = { accept: "*/*" };
  const range = req.headers.get("range");
  if (range) headers.range = range;
  if (referer) {
    try {
      headers.referer = referer;
      headers.origin = new URL(referer).origin;
    } catch {
      /* ignore malformed referer */
    }
  }

  const signal = mergeAbort(req.signal, laneAbort);
  const upstream = await fetch(target, { headers, cache: "no-store", signal });
  if (!upstream.body) throw new Error(`Upstream ${upstream.status}`);

  const landed = upstream.url || target.href;
  if (small(upstream) && isPlaylist(upstream.headers.get("content-type"), landed)) {
    const body = rewritePlaylist(await upstream.text(), landed, (abs) => {
      const q = new URLSearchParams({ url: abs });
      if (referer) q.set("referer", referer);
      if (ctx) {
        q.set("cv", ctx.via);
        q.set("cm", String(ctx.mediaId));
        q.set("cc", ctx.chapterId);
      }
      return `/api/stream?${q}`;
    });
    return new Response(body, {
      status: upstream.status,
      headers: { "content-type": PLAYLIST_TYPE, "cache-control": "no-store" },
    });
  }

  if (!upstream.ok && upstream.status !== 206) throw new Error(`Upstream ${upstream.status}`);

  const reader = upstream.body.getReader();
  const { done, value } = await reader.read();
  if (done || !value?.byteLength) throw new Error("Empty HTTP body");

  const out = new Headers();
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  out.set("content-type", playableType(upstream.headers.get("content-type")));
  out.set("cache-control", "no-store");
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");

  let body: ReadableStream<Uint8Array> = new ReadableStream({
    start(controller) {
      controller.enqueue(value);
      void pumpHttp(reader, controller);
    },
  });
  if (ctx && upstream.ok) {
    body = teeHttp(body, ctx, requestStart(req), totalBytes(upstream.headers), replace);
  }
  return new Response(body, { status: upstream.status, headers: out });
}

async function fromMixedRace(
  req: Request,
  raw: string,
  referer: string | null,
  pairs: { ih: string; fileIdx: number | null }[],
  ctx: CacheCtx | null,
) {
  for (const { ih } of pairs) {
    if (!isInfoHash(ih)) return new Response("Bad info hash", { status: 400 });
  }
  const q = new URL(req.url).searchParams;
  const replace = q.get("replace") === "1";
  if (ctx && !replace) {
    const cached = cachedResponse(req, ctx);
    if (cached) return cached;
  }

  const store = ctx ? torrentStore(ctx.via, ctx.mediaId) : undefined;
  const tryN = raceTry(q);
  if (tryN > 0) {
    const hit = pickFromRacePool(pairs, tryN, wantSlot(q), store);
    if (!hit) return new Response("No warm race candidates left", { status: 502 });
    adoptWhenComplete(ctx, hit.ih, hit.file, replace);
    return streamFile(req, hit.file);
  }

  const keepPieces = Boolean(store);
  const laneAbort = new AbortController();

  try {
    return await new Promise<Response>((resolve, reject) => {
      let settled = false;
      let failed = 0;
      const lose = () => {
        failed++;
        if (!settled && failed >= 2) {
          settled = true;
          reject(new Error("No source had data."));
        }
      };
      const win = (response: Response, fromHttp: boolean) => {
        if (settled) return;
        settled = true;
        /*
         * `laneAbort` belongs to the HTTP lane alone — it is the signal on that
         * lane's upstream fetch — so aborting it when HTTP *wins* tears down the
         * body we are about to return, and the browser sees the connection reset
         * mid-response rather than a stream.
         *
         * This hid because the torrent lane used to win every race on bytes it
         * merely remembered from an earlier attempt (see `waitFirstByte`), and in
         * that case aborting the HTTP lane is exactly right. Once dead swarms
         * stopped winning, the relay started killing its own good answer.
         */
        if (!fromHttp) laneAbort.abort();
        if (fromHttp && pairs.length > 1) snapshotRacePool(pairs, store, keepPieces);
        resolve(response);
      };

      void httpUntilFirstByte(req, raw, referer, ctx, laneAbort.signal, replace)
        .then((r) => win(r, true))
        .catch(lose);

      void raceTorrentFiles(pairs, wantSlot(q), undefined, store)
        .then(({ ih, file }) => {
          adoptWhenComplete(ctx, ih, file, replace);
          win(streamFile(req, file), false);
        })
        .catch(lose);
    });
  } catch (e) {
    if (ctx && !hasVideo(ctx)) discardPart(ctx);
    return new Response(e instanceof Error ? e.message : "Mixed race failed", { status: 502 });
  }
}

async function fromHttp(req: Request, raw: string, referer: string | null, ctx: CacheCtx | null) {
  const replace = new URL(req.url).searchParams.get("replace") === "1";
  if (ctx && !replace) {
    const cached = cachedResponse(req, ctx);
    if (cached) return cached;
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  try {
    await assertPublic(target);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Host not allowed", { status: 403 });
  }

  const headers: Record<string, string> = { accept: "*/*" };
  const range = req.headers.get("range");
  if (range) headers.range = range;
  if (referer) {
    try {
      headers.referer = referer;
      headers.origin = new URL(referer).origin;
    } catch {
      /* ignore malformed referer */
    }
  }

  try {
    const upstream = await fetch(target, { headers, cache: "no-store", signal: req.signal });
    if (!upstream.body) return new Response(`Upstream ${upstream.status}`, { status: 502 });

    const landed = upstream.url || target.href;
    if (small(upstream) && isPlaylist(upstream.headers.get("content-type"), landed)) {
      const body = rewritePlaylist(await upstream.text(), landed, (abs) => {
        const q = new URLSearchParams({ url: abs });
        if (referer) q.set("referer", referer);
        if (ctx) {
          q.set("cv", ctx.via);
          q.set("cm", String(ctx.mediaId));
          q.set("cc", ctx.chapterId);
        }
        return `/api/stream?${q}`;
      });
      return new Response(body, {
        status: upstream.status,
        headers: { "content-type": PLAYLIST_TYPE, "cache-control": "no-store" },
      });
    }

    const out = new Headers();
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    out.set("content-type", playableType(upstream.headers.get("content-type")));
    out.set("cache-control", "no-store");
    if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");

    let body: ReadableStream<Uint8Array> = upstream.body;
    if (ctx && upstream.ok) {
      body = teeHttp(upstream.body, ctx, requestStart(req), totalBytes(upstream.headers), replace);
    }
    return new Response(body, { status: upstream.status, headers: out });
  } catch {
    if (ctx && !hasVideo(ctx)) discardPart(ctx);
    return new Response("Upstream unreachable", { status: 502 });
  }
}

/**
 * Play this source with the audio track the viewer actually asked for.
 *
 * ffmpeg reads from *this same relay*, one layer down, so every existing path —
 * mixed race, torrent race, HTTP, the on-disk cache — is reused untouched and the
 * remux only ever sees a plain byte stream. Video is copied; only audio the
 * browser cannot decode is re-encoded.
 *
 * The response is a live pipe, so it carries no length and no byte ranges: seeking
 * re-requests with a new `t`, which restarts ffmpeg at that keyframe.
 */
async function hasTextSubtitle(path: string, lang: Lang, signal: AbortSignal) {
  const text = new Set(["ass", "ssa", "subrip", "webvtt", "mov_text", "text"]);
  const tracks = await probeSubtitleTracks(path, null, signal);
  return tracks.some(
    (track) =>
      text.has(track.codec) &&
      (parseLangToken(track.language) === lang || parseLangToken(track.title) === lang),
  );
}

async function fromRemux(req: Request, u: URL): Promise<Response> {
  const inner = new URL(u.toString());
  const subtitle = parseLang(u.searchParams.get("sub")) ?? undefined;
  inner.searchParams.delete("remux");
  inner.searchParams.delete("lang");
  inner.searchParams.delete("sub");
  inner.searchParams.delete("t");
  inner.searchParams.delete("pack");
  inner.searchParams.delete("video");
  const pack = u.searchParams.get("pack") === "ts" ? "ts" as const : undefined;
  const transcodeVideo = u.searchParams.get("video") === "h264";
  const lang = parseLang(u.searchParams.get("lang")) ?? undefined;
  const seek = Math.max(0, Number(u.searchParams.get("t") ?? 0) || 0);
  const tryN = Math.max(0, Number(u.searchParams.get("try") ?? 0) || 0);
  const alternatives = inner.searchParams.getAll("alt");
  inner.searchParams.delete("alt");
  const candidates: URL[] = [];
  /* HTTP files are probed for the requested audio, then the mixed URL is remuxed
     so torrents can still win. A warm `try=` is already a torrent from that race. */
  candidates.push(inner);
  for (const rawAlt of alternatives) {
    const alt = new URL(rawAlt, "http://lacrima.local");
    const candidate = new URL(inner);
    candidate.searchParams.delete("ih");
    candidate.searchParams.delete("i");
    for (const key of ["cv", "cm", "cc"]) candidate.searchParams.delete(key);
    for (const key of ["url", "referer", "hls"]) candidate.searchParams.delete(key);
    for (const key of ["url", "referer", "hls"]) {
      const value = alt.searchParams.get(key);
      if (value) candidate.searchParams.set(key, value);
    }
    if (candidate.searchParams.has("url")) candidates.push(candidate);
  }
  if (lang && inner.searchParams.has("ih")) {
    const torrent = new URL(inner);
    for (const key of ["url", "referer", "hls"]) torrent.searchParams.delete(key);
    if (!subtitle) for (const key of ["cv", "cm", "cc"]) torrent.searchParams.delete(key);
    candidates.push(torrent);
  }

  /*
   * One source, opened once.
   *
   * ffmpeg is the only process that opens the input, so a mixed race URL runs its
   * race a single time and whatever wins is what gets remuxed. An earlier version
   * probed with ffprobe first; that ran the race twice, and the two runs need not
   * agree — the probe answered instantly from the direct link while ffmpeg's own
   * request went to a torrent still looking for peers. The result was a stream that
   * started and then stopped dead, which is exactly what it looked like.
   */
  let lastError = "Remux failed";
  for (const candidate of candidates) {
    const candidateReferer = candidate.searchParams.get("referer");
    const candidateCtx = parseCacheCtx(candidate.searchParams);
    let local = candidateCtx ? cachedFileStat(candidateCtx)?.path ?? null : null;
    if (local && subtitle && !(await hasTextSubtitle(local, subtitle, req.signal))) {
      /* The saved release cannot satisfy the viewer's subtitle preference.
         Stream the better-ranked source now and replace the cache only after
         that source has downloaded completely. */
      local = null;
      candidate.searchParams.set("replace", "1");
    }
    if (local && candidateCtx && lang) {
      const dest = playPath(candidateCtx, lang);
      if (existsSync(dest) && statSync(dest).size > 1024) {
        const served = fileResponse(req, dest);
        if (served) return served;
      }
    }
    /* A mid-episode remux of the on-disk file re-encodes from that timestamp.
       That is why a resume waited a minute while a fresh episode (copy from
       zero, racing HTTP against torrents) started in seconds. */
    if (seek > 0) local = null;
    const input = local ?? selfRelayUrl(candidate);
    const mixed = candidate.searchParams.has("url") && candidate.searchParams.has("ih");
    /*
     * Probe the HTTP side alone. ffprobe on the mixed URL would start a second
     * race, and the two winners need not agree. After the language check, ffmpeg
     * opens the mixed URL so torrents can still beat a slow-but-valid direct link.
     */
    let probeUrl = input;
    if (mixed && !local) {
      const direct = new URL(candidate);
      direct.searchParams.delete("ih");
      direct.searchParams.delete("i");
      probeUrl = selfRelayUrl(direct);
    }
    const probedAudio =
      lang && tryN === 0 && (local || candidate.searchParams.has("url"))
        ? await probeAudio(probeUrl, lang, local ? null : candidateReferer, req.signal)
        : undefined;
    if (tryN === 0 && lang && candidate.searchParams.has("url") && !local && probedAudio == null) {
      lastError = `This source has no ${lang} audio track`;
      continue;
    }
    const raw = remuxStream(
      input,
      {
        lang,
        /* A mixed race may be won by a different file than the HTTP source we
           probed. Its numeric stream indexes and codecs are unrelated, so let
           ffmpeg select the requested language from the actual winner and
           normalize that winner's audio. */
        audioIndex: mixed ? undefined : probedAudio?.index,
        copyAudio: mixed ? false : probedAudio?.copyAudio,
        seek,
        referer: local ? null : candidateReferer,
        pack,
        transcodeVideo,
      },
      req.signal,
    );
    const reader = raw.getReader();
    try {
      const first = await reader.read();
      if (first.done || !first.value.byteLength) throw new Error("ffmpeg returned no video");
      let initial: Uint8Array | null = first.value;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (cancelled) return;
          if (initial) {
            controller.enqueue(initial);
            initial = null;
            return;
          }
          const next = await reader.read();
          if (cancelled) return;
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
        cancel() {
          cancelled = true;
          return reader.cancel();
        },
      });
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": pack === "ts" ? "video/mp2t" : "video/mp4",
          "cache-control": "no-store",
          /* Say so explicitly: a live pipe cannot answer a byte range, and a player
             that believes otherwise will ask for one and stall. */
          "accept-ranges": "none",
        },
      });
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Remux failed";
      await reader.cancel().catch(() => undefined);
    }
  }
  return new Response(lastError, { status: 502 });
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("remux") === "1") return fromRemux(req, u);
  const ctx = parseCacheCtx(u.searchParams);
  const raw = u.searchParams.get("url");
  const ihs = u.searchParams.getAll("ih");
  if (raw && ihs.length > 0) {
    const idxs = u.searchParams.getAll("i");
    const pairs = ihs.map((ih, n) => ({
      ih,
      fileIdx: idxs[n] == null || idxs[n] === "" ? null : Number(idxs[n]),
    }));
    return fromMixedRace(req, raw, u.searchParams.get("referer"), pairs, ctx);
  }
  if (ihs.length > 1) {
    const idxs = u.searchParams.getAll("i");
    const pairs = ihs.map((ih, n) => ({
      ih,
      fileIdx: idxs[n] == null || idxs[n] === "" ? null : Number(idxs[n]),
    }));
    return fromTorrentRace(req, pairs, ctx);
  }
  if (ihs.length === 1) return fromTorrent(req, ihs[0], u.searchParams.get("i"), ctx);
  if (raw) return fromHttp(req, raw, u.searchParams.get("referer"), ctx);
  return new Response("Missing url", { status: 400 });
}

export async function DELETE() {
  /* Detach peers but keep per-anime torrent pieces on disk for the next play. */
  queueMicrotask(() => dropTorrents(true));
  return new Response(null, { status: 204 });
}


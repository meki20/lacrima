import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cueType, fileHref, type SubCue } from "./subs.ts";
import {
  chapterSlug,
  ensureMediaDir,
  mediaDir,
  persistMedia,
  type CacheCtx,
} from "./play-cache.ts";
import { listStoredPlugins } from "./sources/store.ts";

const MAX_BYTES = 8_000_000;
const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

export type SubRead = { buf: Uint8Array; error?: undefined } | { buf: null; error: string };

function subsDir(ctx: CacheCtx): string {
  /* Video persist is off in Docker; /app/data is root-owned, so mkdir EACCES.
     Torrents already land in tmp for the same reason. */
  if (!persistMedia()) {
    return join(tmpdir(), "lacrima-subs", `${ctx.via}-${ctx.mediaId}`, chapterSlug(ctx.chapterId));
  }
  return join(mediaDir(ctx), "subs");
}

function indexPath(ctx: CacheCtx): string {
  return join(subsDir(ctx), "index.json");
}

export function subBodyPath(ctx: CacheCtx, url: string): string {
  const id = createHash("sha256").update(url).digest("hex").slice(0, 20);
  return join(subsDir(ctx), `${id}.${cueType(url)}`);
}

export const SUB_INDEX_TTL_MS = 24 * 60 * 60 * 1000;

function thaw(ctx: CacheCtx, row: SubCue): SubCue {
  return {
    id: row.id,
    lang: row.lang,
    label: row.label,
    url: row.url,
    type: row.type,
    src: fileHref(row.url, ctx),
  };
}

export function loadSubIndex(ctx: CacheCtx, maxAge = SUB_INDEX_TTL_MS): SubCue[] {
  try {
    const raw = JSON.parse(readFileSync(indexPath(ctx), "utf8")) as unknown;
    const { at, rows } = readIndex(raw);
    if (maxAge >= 0 && Date.now() - at > maxAge) return [];
    return rows.filter((r) => r?.url).map((r) => thaw(ctx, r));
  } catch {
    return [];
  }
}

function readIndex(raw: unknown): { at: number; rows: SubCue[] } {
  if (Array.isArray(raw)) return { at: 0, rows: raw as SubCue[] };
  if (raw && typeof raw === "object" && Array.isArray((raw as { cues?: unknown }).cues)) {
    const file = raw as { at?: unknown; cues: SubCue[] };
    return { at: typeof file.at === "number" ? file.at : 0, rows: file.cues };
  }
  return { at: 0, rows: [] };
}

export function saveSubIndex(ctx: CacheCtx, cues: SubCue[]): void {
  if (!cues.length) return;
  try {
    ensureMediaDir(ctx);
    mkdirSync(subsDir(ctx), { recursive: true });
    writeFileSync(
      indexPath(ctx),
      JSON.stringify({
        at: Date.now(),
        cues: cues.map((c) => ({ id: c.id, lang: c.lang, label: c.label, url: c.url, type: c.type })),
      }),
    );
  } catch {
    /* a cache write must never fail a play */
  }
}

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

function addonHosts(): Set<string> {
  const hosts = new Set<string>();
  try {
    for (const kind of ["anime", "manga", "novel"] as const) {
      for (const p of listStoredPlugins(kind)) {
        if (!p.plugin_url) continue;
        try {
          hosts.add(new URL(p.plugin_url).hostname.toLowerCase());
        } catch {
          /* ignore malformed plugin urls */
        }
      }
    }
  } catch {
    /* db may be closed in unit tests */
  }
  return hosts;
}

async function assertReachable(target: URL) {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("That subtitle URL is not http(s).");
  }
  const host = target.hostname.toLowerCase();
  if (addonHosts().has(host)) return;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("That subtitle URL is on a private host.");
  }
  if (isIP(host) && blocked(host)) throw new Error("That subtitle URL is on a private host.");
  const { address } = await lookup(host);
  if (blocked(address)) throw new Error("That subtitle URL is on a private host.");
}

function readFromDisk(dest: string): Uint8Array | null {
  try {
    if (!existsSync(dest)) return null;
    const buf = readFileSync(dest);
    return buf.byteLength ? buf : null;
  } catch {
    return null;
  }
}

const pulling = new Map<string, Promise<SubRead>>();

async function pull(ctx: CacheCtx, url: string): Promise<SubRead> {
  const dest = subBodyPath(ctx, url);
  const cached = readFromDisk(dest);
  if (cached) return { buf: cached };

  if (url.startsWith("embedded:")) {
    try {
      const { embeddedSubtitles } = await import("./embedded-subs.ts");
      await embeddedSubtitles(ctx);
    } catch (e) {
      return {
        buf: null,
        error: e instanceof Error ? e.message : "Could not extract embedded subtitles.",
      };
    }
    const extracted = readFromDisk(dest);
    if (extracted) return { buf: extracted };
    return { buf: null, error: "Could not extract that subtitle track from the video file." };
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { buf: null, error: "That subtitle URL is not valid." };
  }
  try {
    await assertReachable(target);
  } catch (e) {
    return { buf: null, error: e instanceof Error ? e.message : "That subtitle URL is not allowed." };
  }
  try {
    const upstream = await fetch(target, {
      headers: {
        accept: "text/plain,text/vtt,application/x-subrip,text/*,*/*",
        "accept-language": "en",
        "user-agent": BROWSER_UA,
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) {
      return { buf: null, error: `The subtitle host returned ${upstream.status}.` };
    }
    const buf = new Uint8Array(await upstream.arrayBuffer());
    if (!buf.byteLength) return { buf: null, error: "The subtitle host returned an empty file." };
    if (buf.byteLength > MAX_BYTES) return { buf: null, error: "That subtitle file is larger than 8 MB." };
    try {
      mkdirSync(subsDir(ctx), { recursive: true });
      if (!existsSync(dest)) writeFileSync(dest, buf);
    } catch {
      /* a cache write must never fail a play */
    }
    return { buf };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { buf: null, error: "Timed out fetching the subtitle file." };
    }
    return { buf: null, error: e instanceof Error ? e.message : "Couldn't fetch that subtitle file." };
  }
}

/** Disk first. Fetch and save once if missing. */
export function readSubBody(ctx: CacheCtx, url: string): Promise<SubRead> {
  const dest = subBodyPath(ctx, url);
  const cached = readFromDisk(dest);
  if (cached) return Promise.resolve({ buf: cached });
  const hit = pulling.get(dest);
  if (hit) return hit;
  const run = pull(ctx, url).finally(() => pulling.delete(dest));
  pulling.set(dest, run);
  return run;
}

export async function loadSubBody(ctx: CacheCtx, url: string): Promise<Uint8Array | null> {
  return (await readSubBody(ctx, url)).buf;
}

/** Warm every file as soon as the addon list lands. Missing files stay missing. */
export function ensureSubFiles(ctx: CacheCtx, cues: SubCue[]): void {
  for (const c of cues) void loadSubBody(ctx, c.url);
}

export function mimeForSub(url: string): string {
  const t = cueType(url);
  if (t === "srt") return "application/x-subrip; charset=utf-8";
  if (t === "ass" || t === "ssa") return "text/x-ssa; charset=utf-8";
  return "text/vtt; charset=utf-8";
}

export function decodeSubBytes(buf: Uint8Array): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buf);
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buf);
  }
  return new TextDecoder("utf-8").decode(buf);
}

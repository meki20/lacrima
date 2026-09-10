import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { cueType, fileHref, type SubCue } from "./subs.ts";
import { ensureMediaDir, mediaDir, type CacheCtx } from "./play-cache.ts";

const MAX_BYTES = 2_000_000;

function subsDir(ctx: CacheCtx): string {
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

async function assertPublic(target: URL) {
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Unsupported scheme");
  const host = target.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Host not allowed");
  }
  if (isIP(host) && blocked(host)) throw new Error("Host not allowed");
  const { address } = await lookup(host);
  if (blocked(address)) throw new Error("Host not allowed");
}

const pulling = new Map<string, Promise<Uint8Array | null>>();

async function pull(ctx: CacheCtx, url: string): Promise<Uint8Array | null> {
  const dest = subBodyPath(ctx, url);
  if (existsSync(dest)) return readFileSync(dest);
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  try {
    await assertPublic(target);
  } catch {
    return null;
  }
  try {
    const upstream = await fetch(target, {
      headers: { accept: "text/*,*/*" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok || !upstream.body) return null;
    const buf = new Uint8Array(await upstream.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > MAX_BYTES) return null;
    mkdirSync(subsDir(ctx), { recursive: true });
    if (!existsSync(dest)) writeFileSync(dest, buf);
    return buf;
  } catch {
    return null;
  }
}

/** Disk first. Fetch and save once if missing. */
export function loadSubBody(ctx: CacheCtx, url: string): Promise<Uint8Array | null> {
  const dest = subBodyPath(ctx, url);
  if (existsSync(dest)) return Promise.resolve(readFileSync(dest));
  const hit = pulling.get(dest);
  if (hit) return hit;
  const run = pull(ctx, url).finally(() => pulling.delete(dest));
  pulling.set(dest, run);
  return run;
}

/** Warm every file as soon as the addon list lands. Missing files stay missing. */
export function ensureSubFiles(ctx: CacheCtx, cues: SubCue[]): void {
  for (const c of cues) void loadSubBody(ctx, c.url);
}

export function mimeForSub(url: string): string {
  const t = cueType(url);
  if (t === "srt") return "text/plain; charset=utf-8";
  if (t === "ass" || t === "ssa") return "text/plain; charset=utf-8";
  return "text/vtt; charset=utf-8";
}

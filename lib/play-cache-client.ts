import type { ProviderSlug } from "./media.ts";

export type CacheCtx = { via: ProviderSlug; mediaId: number; chapterId: string };

/**
 * On-disk episode and torrent copies. Off unless tests set `LACRIMA_CACHE`, or
 * `LACRIMA_CACHE_PERSIST=1`. Season packs were filling tens of gigabytes.
 */
export function persistMedia(): boolean {
  if (process.env.LACRIMA_CACHE_PERSIST === "0") return false;
  if (process.env.LACRIMA_CACHE_PERSIST === "1") return true;
  return Boolean(process.env.LACRIMA_CACHE);
}

/** Tag a same-origin stream URL with the anime cache folder keys. Safe for client bundles. */
export function withCacheParams(url: string, ctx: CacheCtx): string {
  const u = new URL(url, "http://lacrima.local");
  u.searchParams.set("cv", ctx.via);
  u.searchParams.set("cm", String(ctx.mediaId));
  u.searchParams.set("cc", ctx.chapterId);
  return `${u.pathname}${u.search}`;
}

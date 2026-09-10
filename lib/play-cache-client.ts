import type { ProviderSlug } from "./media.ts";

export type CacheCtx = { via: ProviderSlug; mediaId: number; chapterId: string };

/** Tag a same-origin stream URL with the anime cache folder keys. Safe for client bundles. */
export function withCacheParams(url: string, ctx: CacheCtx): string {
  const u = new URL(url, "http://lacrima.local");
  u.searchParams.set("cv", ctx.via);
  u.searchParams.set("cm", String(ctx.mediaId));
  u.searchParams.set("cc", ctx.chapterId);
  return `${u.pathname}${u.search}`;
}

import { parseLang } from "@/lib/audio";
import type { MediaKind, ProviderSlug } from "@/lib/media";
import {
  boostPlaylist,
  fastPlaylist,
  getCachedPick,
  hasLocalVideo,
  loadPlaylist,
  savePlaylist,
  type CacheCtx,
} from "@/lib/play-cache";
import { fetchTitle } from "@/lib/metadata";
import { backend } from "@/lib/sources";
import { forLang, fromProviders } from "@/lib/streams";
import { resolveStreams } from "@/lib/sources/stremio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind") as MediaKind | null;
  const chapterId = u.searchParams.get("chapterId");
  const via = u.searchParams.get("via") ?? undefined;
  const mediaId = Number(u.searchParams.get("mediaId"));
  if (!kind || !chapterId) {
    return Response.json({ error: "Missing kind or chapterId" }, { status: 400 });
  }
  const lang = parseLang(u.searchParams.get("lang") ?? u.searchParams.get("audio"));
  const extras = {
    via,
    mediaId: Number.isFinite(mediaId) ? mediaId : undefined,
    lang,
  };
  if (kind === "anime") {
    const fresh = u.searchParams.get("fresh") === "1";
    const ctx: CacheCtx | null =
      via && Number.isFinite(extras.mediaId)
        ? { via: via as ProviderSlug, mediaId: extras.mediaId!, chapterId }
        : null;
    /* Removing an addon has to take effect on the next play. The saved playlist
       never expires, so without this its picks outlive the source they came from. */
    const sources = await backend("anime").listSources();
    const installed = sources.ok ? new Set(sources.value.map((s) => s.name)) : null;
    const cachedPick = ctx && !fresh ? getCachedPick(ctx.via, ctx.mediaId, chapterId, lang) : null;
    const pick = cachedPick && (!installed || installed.has(cachedPick.provider)) ? cachedPick : null;

    /* The stored playlist is the fast path: no addon is contacted, and the whole
       quality/language menu survives instead of collapsing to the one pick that
       happened to work. `forLang` runs last so boosting a Japanese pick cannot
       override a request that asked for the English dub. */
    const saved = ctx && !fresh ? fromProviders(loadPlaylist(ctx), installed) : null;
    if (saved) {
      return Response.json({
        ...forLang(boostPlaylist(saved, pick), lang),
        source: pick
          ? { provider: pick.provider, cached: true, local: hasLocalVideo(ctx!) }
          : undefined,
      });
    }
    if (pick) {
      return Response.json({
        ...fastPlaylist(pick),
        source: { provider: pick.provider, cached: true, local: hasLocalVideo(ctx!) },
      });
    }

    /* Memoised and already warm from the page render. The resolver needs it to
       tell this show apart from its spin-offs and its live-action remake, which
       addons happily return under the same id. */
    const meta = ctx ? await fetchTitle(ctx.via, "anime", ctx.mediaId) : null;
    const r = await resolveStreams(chapterId, {
      ...extras,
      title: meta?.ok ? meta.value.title : undefined,
      fresh,
    });
    if (!r.ok) return Response.json({ error: r.reason }, { status: 502 });
    if (ctx) savePlaylist(ctx, r.value);
    return Response.json(r.value);
  }
  const r = await backend(kind).pages(chapterId, extras);
  if (!r.ok) return Response.json({ error: r.reason }, { status: 502 });
  return Response.json({ urls: r.value });
}

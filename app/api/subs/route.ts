import type { ProviderSlug } from "@/lib/media";
import { resolveEmbeddedSubtitles, resolveSubtitles } from "@/lib/sources/stremio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const chapterId = u.searchParams.get("chapterId");
  const via = u.searchParams.get("via") ?? undefined;
  const mediaId = Number(u.searchParams.get("mediaId"));
  if (!chapterId) {
    return Response.json({ error: "Missing chapterId" }, { status: 400 });
  }
  if (u.searchParams.get("local") === "1") {
    if (!via || !Number.isFinite(mediaId)) {
      return Response.json({ error: "Missing media context" }, { status: 400 });
    }
    return Response.json({
      cues: await resolveEmbeddedSubtitles({
        via: via as ProviderSlug,
        mediaId,
        chapterId,
      }),
    });
  }
  const r = await resolveSubtitles(chapterId, {
    via: via as ProviderSlug | undefined,
    mediaId: Number.isFinite(mediaId) ? mediaId : undefined,
    fresh: u.searchParams.get("fresh") === "1",
  });
  if (!r.ok) return Response.json({ error: r.reason }, { status: 502 });
  return Response.json({ cues: r.value });
}

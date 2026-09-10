import type { ProviderSlug } from "@/lib/media";
import { resolveSubtitles } from "@/lib/sources/stremio";

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
  const r = await resolveSubtitles(chapterId, {
    via: via as ProviderSlug | undefined,
    mediaId: Number.isFinite(mediaId) ? mediaId : undefined,
  });
  if (!r.ok) return Response.json({ error: r.reason }, { status: 502 });
  return Response.json({ cues: r.value });
}

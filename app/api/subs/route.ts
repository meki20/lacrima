import type { ProviderSlug } from "@/lib/media";
import { resolveEmbeddedSubtitles, resolveSubtitles } from "@/lib/sources/stremio";
import { currentProfile } from "@/lib/profile";
import { updateSubtitleChoice } from "@/lib/settings";

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
    const ih = u.searchParams.get("ih") ?? undefined;
    const i = u.searchParams.get("i");
    const season = Number(u.searchParams.get("s"));
    const episode = Number(u.searchParams.get("e"));
    const result = await resolveEmbeddedSubtitles(
      { via: via as ProviderSlug, mediaId, chapterId },
      {
        ih,
        fileIdx: i != null && i !== "" ? Number(i) : null,
        season: Number.isFinite(season) && season > 0 ? season : undefined,
        episode: Number.isFinite(episode) && episode > 0 ? episode : undefined,
      },
    );
    return Response.json({ cues: result.cues, pending: result.pending });
  }
  const r = await resolveSubtitles(chapterId, {
    via: via as ProviderSlug | undefined,
    mediaId: Number.isFinite(mediaId) ? mediaId : undefined,
    fresh: u.searchParams.get("fresh") === "1",
  });
  if (!r.ok) return Response.json({ error: r.reason }, { status: 502 });
  return Response.json({ cues: r.value });
}

export async function PUT(req: Request) {
  let body: { via?: unknown; mediaId?: unknown; chapterId?: unknown; choice?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "Bad json" }, { status: 400 }); }
  if (!body || typeof body.via !== "string" || !["anilist", "jikan", "kitsu"].includes(body.via) ||
    !Number.isSafeInteger(body.mediaId) || Number(body.mediaId) <= 0 ||
    typeof body.chapterId !== "string" || !body.chapterId || body.chapterId.length > 500 ||
    typeof body.choice !== "string" || !body.choice || body.choice.length > 8_000) {
    return Response.json({ error: "Invalid subtitle choice" }, { status: 400 });
  }
  const me = await currentProfile();
  updateSubtitleChoice(me.id, body.via, body.mediaId as number, body.chapterId, body.choice);
  return Response.json({ ok: true });
}

import { skipTimes } from "@/lib/skip-times";
import type { ProviderSlug } from "@/lib/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROVIDERS = new Set<ProviderSlug>(["anilist", "jikan", "kitsu"]);

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  const via = query.get("via");
  const mediaId = Number(query.get("mediaId"));
  const episode = Number(query.get("episode"));
  if (!via || !PROVIDERS.has(via as ProviderSlug) || !Number.isInteger(mediaId) || mediaId < 1 ||
    !Number.isInteger(episode) || episode < 1) {
    return Response.json({ error: "Invalid episode context." }, { status: 400 });
  }
  const result = await skipTimes({ via: via as ProviderSlug, mediaId, episode });
  return Response.json({ segments: result.ok ? result.value : [] });
}

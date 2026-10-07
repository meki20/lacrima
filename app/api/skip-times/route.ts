import { skipTimes } from "@/lib/skip-times";
import { isProviderSlug } from "@/lib/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  const via = query.get("via");
  const mediaId = Number(query.get("mediaId"));
  const episode = Number(query.get("episode"));
  if (!isProviderSlug(via) || !Number.isInteger(mediaId) || mediaId < 1 ||
    !Number.isInteger(episode) || episode < 1) {
    return Response.json({ error: "Invalid episode context." }, { status: 400 });
  }
  // Skip times are keyed on a MAL id; movie and series providers have no mapping to
  // one, so `skipTimes` answers with no segments rather than an error.
  const result = await skipTimes({ via, mediaId, episode });
  return Response.json({ segments: result.ok ? result.value : [] });
}

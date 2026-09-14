import { commitPick, type CacheCtx } from "@/lib/play-cache";
import { currentProfile } from "@/lib/profile";
import { recordProviderChoice } from "@/lib/settings";
import type { StreamPick } from "@/lib/streams";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = CacheCtx & {
  groupId: string;
  pick: StreamPick;
  title?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad json" }, { status: 400 });
  }
  const { via, mediaId, chapterId, groupId, pick } = body;
  if (!via || !Number.isFinite(mediaId) || !chapterId || !groupId || !pick?.url) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }
  const entry = commitPick({ via, mediaId, chapterId }, groupId, pick);
  recordProviderChoice((await currentProfile()).id, pick.provider);
  return Response.json({ ok: true, committedAt: entry.committedAt });
}

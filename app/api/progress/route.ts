import type { Anchor } from "@/lib/db";
import type { MediaKind, ProviderSlug } from "@/lib/media";
import { currentProfile } from "@/lib/profile";
import { setProgress } from "@/lib/progress";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  via?: ProviderSlug;
  mediaId?: number;
  kind?: MediaKind;
  title?: string;
  cover?: string | null;
  unit?: number;
  anchor?: Anchor;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const { via, mediaId, kind, title, cover, unit, anchor } = body;
  if (!via || !kind || !title || mediaId == null || unit == null || !anchor) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }
  const me = await currentProfile();
  setProgress({
    profileId: me.id,
    media: { via, id: mediaId, kind, title, cover: cover ?? null },
    unit,
    anchor,
  });
  return Response.json({ ok: true });
}

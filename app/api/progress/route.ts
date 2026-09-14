import type { Anchor } from "@/lib/db";
import type { MediaKind, ProviderSlug } from "@/lib/media";
import { currentProfile } from "@/lib/profile";
import { setProgressTree } from "@/lib/progress";

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
  watchedDelta?: number;
  skipAhead?: boolean;
  durationSeconds?: number;
  exact?: boolean;
  seriesParts?: { mediaId?: number; title?: string; cover?: string | null; units?: number }[];
  partIndex?: number;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const {
    via,
    mediaId,
    kind,
    title,
    cover,
    unit,
    anchor,
    watchedDelta,
    skipAhead,
    durationSeconds,
    exact,
    seriesParts,
    partIndex,
  } = body;
  if (!via || !kind || !title || mediaId == null || unit == null || !anchor) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }
  const me = await currentProfile();
  const parts = (seriesParts ?? [])
    .map((s) => ({
      mediaId: Number(s.mediaId),
      title: String(s.title ?? title),
      cover: s.cover ?? null,
      units: Math.max(0, Math.floor(Number(s.units) || 0)),
    }))
    .filter((s) => Number.isFinite(s.mediaId) && s.mediaId > 0);
  const stickers = await setProgressTree({
    profileId: me.id,
    media: { via, id: mediaId, kind, title, cover: cover ?? null },
    unit,
    anchor,
    watchedDelta,
    skipAhead: Boolean(skipAhead),
    exact: Boolean(exact),
    durationSeconds,
    seriesParts: parts,
    partIndex: typeof partIndex === "number" ? partIndex : undefined,
  });
  return Response.json({ ok: true, stickers });
}

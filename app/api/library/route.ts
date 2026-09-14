import { currentProfile } from "@/lib/profile";
import {
  parseStatus,
  removeLibrary,
  reorderPins,
  setPinned,
  upsertLibrary,
  type LibraryStatus,
} from "@/lib/library";
import type { MediaKind, ProviderSlug } from "@/lib/media";

export const runtime = "nodejs";

type Body = {
  via?: ProviderSlug;
  id?: number;
  kind?: MediaKind;
  title?: string;
  cover?: string | null;
  color?: string | null;
  units?: number | null;
  genres?: string[];
  status?: LibraryStatus | "remove";
  score?: number | null;
  pin?: boolean;
  remove?: boolean;
  reorder?: { via: ProviderSlug; id: number }[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad json" }, { status: 400 });
  }
  const me = await currentProfile();
  if (body.reorder) {
    reorderPins(me.id, body.reorder);
    return Response.json({ ok: true });
  }
  const { via, id, kind, title } = body;
  if (!via || !kind || id == null) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }
  if (body.remove || body.status === "remove") {
    removeLibrary(me.id, via, id);
    return Response.json({ ok: true, entry: null });
  }
  if (body.pin != null && !title) {
    const entry = setPinned(me.id, via, id, body.pin);
    return Response.json({ ok: true, entry: entry ?? null });
  }
  if (!title) return Response.json({ error: "Missing fields" }, { status: 400 });
  const status = parseStatus(body.status) ?? undefined;
  const entry = upsertLibrary(
    me.id,
    {
      via,
      id,
      kind,
      title,
      cover: body.cover ?? null,
      color: body.color ?? null,
      units: body.units ?? null,
      genres: body.genres ?? [],
    },
    { status, score: body.score },
  );
  const pinned = body.pin == null ? entry : setPinned(me.id, via, id, body.pin) ?? entry;
  return Response.json({ ok: true, entry: pinned });
}

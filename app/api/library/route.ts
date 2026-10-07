import { currentProfile } from "@/lib/profile";
import {
  parseStatus,
  removeLibrary,
  reorderPins,
  setPinned,
  upsertLibrary,
  type LibraryStatus,
} from "@/lib/library";
import { removeHistory } from "@/lib/progress";
import { parseKind } from "@/lib/kinds";
import { isProviderSlug } from "@/lib/media";

export const runtime = "nodejs";

type Body = {
  via?: unknown;
  id?: number;
  kind?: unknown;
  title?: string;
  cover?: string | null;
  color?: string | null;
  units?: number | null;
  genres?: string[];
  status?: LibraryStatus | "remove";
  score?: number | null;
  pin?: boolean;
  remove?: boolean;
  removeHistory?: boolean;
  reorder?: { via?: unknown; id?: unknown }[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad json" }, { status: 400 });
  }
  const me = await currentProfile();
  if (Array.isArray(body.reorder)) {
    reorderPins(
      me.id,
      body.reorder.flatMap((r) =>
        isProviderSlug(r?.via) && Number.isInteger(r.id) ? [{ via: r.via, id: r.id as number }] : [],
      ),
    );
    return Response.json({ ok: true });
  }
  const { id, title } = body;
  if (!body.via || !body.kind || id == null) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }
  const via = isProviderSlug(body.via) ? body.via : null;
  const kind = parseKind(body.kind);
  if (!via || !kind) {
    return Response.json({ error: "Unknown provider or kind" }, { status: 400 });
  }
  if (body.remove || body.status === "remove") {
    removeLibrary(me.id, via, id);
    return Response.json({ ok: true, entry: null });
  }
  if (body.removeHistory) {
    removeHistory(me.id, via, id);
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

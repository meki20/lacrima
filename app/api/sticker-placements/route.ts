import { currentProfile } from "@/lib/profile";
import {
  addPlacement,
  listPlacements,
  movePlacement,
  removePlacement,
} from "@/lib/sticker-placements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  const me = await currentProfile();
  return Response.json({
    ok: true,
    placements: listPlacements(me.id, path, url.searchParams.get("surface")),
  });
}

export async function POST(req: Request) {
  let body: {
    stickerId?: string;
    path?: string;
    x?: unknown;
    y?: unknown;
    scale?: unknown;
    rot?: unknown;
    surface?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad json" }, { status: 400 });
  }
  const x = num(body.x);
  const y = num(body.y);
  const scale = num(body.scale) ?? 1;
  if (!body.stickerId || !body.path || x == null || y == null) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }
  const me = await currentProfile();
  const placement = addPlacement(me.id, {
    stickerId: body.stickerId,
    path: body.path,
    x,
    y,
    scale,
    rot: num(body.rot) ?? 0,
    surface: body.surface,
  });
  if (!placement) return Response.json({ error: "Cannot place" }, { status: 400 });
  return Response.json({ ok: true, placement });
}

export async function PATCH(req: Request) {
  let body: { id?: unknown; x?: unknown; y?: unknown; scale?: unknown; rot?: unknown; path?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad json" }, { status: 400 });
  }
  const id = num(body.id);
  if (id == null) return Response.json({ error: "Missing id" }, { status: 400 });
  const me = await currentProfile();
  const placement = movePlacement(me.id, Math.trunc(id), {
    x: num(body.x) ?? undefined,
    y: num(body.y) ?? undefined,
    scale: num(body.scale) ?? undefined,
    rot: num(body.rot) ?? undefined,
    path: typeof body.path === "string" ? body.path : undefined,
  });
  if (!placement) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true, placement });
}

export async function DELETE(req: Request) {
  let body: { id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad json" }, { status: 400 });
  }
  const id = num(body.id);
  if (id == null) return Response.json({ error: "Missing id" }, { status: 400 });
  const me = await currentProfile();
  if (!removePlacement(me.id, Math.trunc(id))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

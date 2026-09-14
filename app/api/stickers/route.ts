import { currentProfile } from "@/lib/profile";
import { earnedCatalog, toggleSticker } from "@/lib/stickers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await currentProfile();
  return Response.json({ ok: true, groups: earnedCatalog(me.id) });
}

export async function POST(req: Request) {
  let body: { id?: string };
  try {
    body = (await req.json()) as { id?: string };
  } catch {
    return Response.json({ error: "Bad json" }, { status: 400 });
  }
  const id = body.id?.trim() ?? "";
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  const me = await currentProfile();
  const got = toggleSticker(me.id, id);
  if (!got) return Response.json({ error: "Unknown sticker" }, { status: 404 });
  return Response.json({ ok: true, ...got });
}

import { currentProfile } from "@/lib/profile";
import { updateProfileSettings, type Settings } from "@/lib/settings";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  let values: Partial<Settings>;
  try { values = await req.json() as Partial<Settings>; } catch { return Response.json({ error: "Bad json" }, { status: 400 }); }
  const me = await currentProfile();
  return Response.json({ ok: true, settings: updateProfileSettings(me.id, values) });
}

import { currentProfile } from "@/lib/profile";
import { parseHidden } from "@/lib/kinds";
import { updateProfileSettings, type Settings } from "@/lib/settings";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  let values: Partial<Settings>;
  try { values = await req.json() as Partial<Settings>; } catch { return Response.json({ error: "Bad json" }, { status: 400 }); }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return Response.json({ error: "Bad json" }, { status: 400 });
  }
  // The other fields fall back to defaults; a mistyped category is a bug worth surfacing.
  if ("hidden_kinds" in values && parseHidden(values.hidden_kinds) == null) {
    return Response.json({ error: "Unknown category" }, { status: 400 });
  }
  const me = await currentProfile();
  return Response.json({ ok: true, settings: updateProfileSettings(me.id, values) });
}

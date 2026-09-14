import { currentProfile, updateProfile } from "@/lib/profile";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  let patch: { name?: string; accent?: string; wallpaper?: string | null; avatar_color?: string };
  try {
    patch = (await req.json()) as typeof patch;
  } catch {
    return Response.json({ error: "Bad json" }, { status: 400 });
  }
  const me = await currentProfile();
  const next = updateProfile(me.id, patch);
  if ("error" in next) return Response.json({ error: next.error }, { status: 400 });
  return Response.json({ ok: true, profile: next });
}

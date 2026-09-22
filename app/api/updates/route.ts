import { checkForRelease, queueUpdate, saveUpdatePreferences, updateStatus, type UpdatePreferences } from "@/lib/updates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: updateStatus() }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(req: Request) {
  let values: Partial<UpdatePreferences>;
  try { values = await req.json() as Partial<UpdatePreferences>; } catch { return Response.json({ error: "Bad json" }, { status: 400 }); }
  return Response.json({ status: saveUpdatePreferences(values) });
}

export async function POST(req: Request) {
  let action: unknown;
  try { action = (await req.json() as { action?: unknown }).action; } catch { return Response.json({ error: "Bad json" }, { status: 400 }); }
  if (action === "check") return Response.json({ status: await checkForRelease() });
  if (action === "update") return Response.json({ status: queueUpdate() });
  return Response.json({ error: "Unknown update action" }, { status: 400 });
}

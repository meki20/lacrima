import { isVetKind, retryVet, vetViewsFor } from "@/lib/vet-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (error: string) => Response.json({ error }, { status: 400 });

/** Where a source's vet stands; the badge polls this while one is running. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind");
  const id = q.get("id");
  if (!isVetKind(kind) || !id) return bad("kind and id are required");
  return Response.json({ view: vetViewsFor(kind, [id])[id] });
}

/** The retry icon: vet this source again now. */
export async function POST(req: Request) {
  let body: { kind?: unknown; id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return bad("Bad json");
  }
  if (!isVetKind(body.kind) || typeof body.id !== "string" || !body.id || body.id.length > 500) {
    return bad("kind and id are required");
  }
  return Response.json({ view: retryVet(body.kind, body.id) });
}

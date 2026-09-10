import { parseCacheCtx } from "@/lib/play-cache";
import { loadSubBody, mimeForSub } from "@/lib/sub-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const raw = q.get("url");
  const ctx = parseCacheCtx(q);
  if (!raw || !ctx) return new Response("Missing url", { status: 400 });
  const buf = await loadSubBody(ctx, raw);
  if (!buf) return new Response("Subtitle unavailable", { status: 502 });
  return new Response(Buffer.from(buf), {
    headers: {
      "content-type": mimeForSub(raw),
      "cache-control": "public, max-age=86400",
    },
  });
}

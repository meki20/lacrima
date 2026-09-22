import { parseCacheCtx } from "@/lib/play-cache";
import { mimeForSub, readSubBody } from "@/lib/sub-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const raw = q.get("url");
  const ctx = parseCacheCtx(q);
  if (!raw || !ctx) return new Response("Missing url", { status: 400 });
  const read = await readSubBody(ctx, raw);
  if (!read.buf) return new Response(read.error || "Subtitle unavailable", { status: 502 });
  return new Response(Buffer.from(read.buf), {
    headers: {
      "content-type": mimeForSub(raw),
      "cache-control": "public, max-age=86400",
    },
  });
}

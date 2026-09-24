import { parseCacheCtx } from "@/lib/play-cache";
import { decodeSubBytes, mimeForSub, readSubBody } from "@/lib/sub-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const raw = q.get("url");
  const ctx = parseCacheCtx(q);
  if (!raw || !ctx) return new Response("Missing url", { status: 400 });
  const read = await readSubBody(ctx, raw);
  if (!read.buf) return new Response(read.error || "Subtitle unavailable", { status: 502 });
  // Providers occasionally serve UTF-16 SRT files. Normalise once here so every
  // HTTP client, including the native player, receives valid UTF-8 text.
  return new Response(decodeSubBytes(read.buf), {
    headers: {
      "content-type": mimeForSub(raw),
      "cache-control": "public, max-age=86400",
    },
  });
}

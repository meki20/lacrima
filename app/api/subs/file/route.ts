import { parseCacheCtx } from "@/lib/play-cache";
import { decodeSubBytes, mimeForSub, readSubBody } from "@/lib/sub-cache";
import { castVtt } from "@/lib/subs";
import { castOrigin } from "@/lib/cast-origin";

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
  const cast = q.get("cast") === "1";
  const start = Number(q.get("t") ?? 0);
  if (cast && (!Number.isFinite(start) || start < 0 || start > 86_400)) {
    return new Response("Invalid subtitle start", { status: 400 });
  }
  const body = decodeSubBytes(read.buf);
  const origin = cast ? castOrigin(req) : null;
  return new Response(cast ? castVtt(body, start) : body, {
    headers: {
      "content-type": cast ? "text/vtt; charset=utf-8" : mimeForSub(raw),
      "cache-control": raw.startsWith("embedded:") ? "no-store" : "public, max-age=86400",
      ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    },
  });
}

export function OPTIONS(req: Request) {
  const origin = castOrigin(req);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "Range, Accept-Encoding, Content-Type",
      vary: "Origin",
    },
  });
}

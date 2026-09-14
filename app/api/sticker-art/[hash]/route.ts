import { ensureArtFile } from "@/lib/stickers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ hash: string }> },
) {
  const { hash } = await ctx.params;
  const art = await ensureArtFile(hash);
  if (!art) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(art.body), {
    headers: {
      "content-type": art.mime,
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}

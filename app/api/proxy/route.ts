import { suwayomiBase } from "@/lib/sources/suwayomi";

/**
 * Image relay for reader pages.
 *
 * Suwayomi already fetches from the origin with the right headers, so this does
 * not need referer spoofing *today* — it exists to keep the backend URL off the
 * client, to add caching, and because non-Suwayomi backends (anime m3u8, novel
 * plugins) will need it.
 *
 * SECURITY: allowlisted hosts only. An unrestricted `?url=` proxy is an SSRF
 * hole that would let anyone on the LAN reach internal services through us.
 */
function allowed(target: URL): boolean {
  const base = new URL(suwayomiBase());
  if (target.host === base.host) return true;

  const extra = (process.env.LACRIMA_PROXY_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return extra.includes(target.host);
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return new Response("Unsupported scheme", { status: 400 });
  }
  if (!allowed(target)) {
    return new Response("Host not allowed", { status: 403 });
  }

  const referer = new URL(req.url).searchParams.get("referer");

  try {
    const upstream = await fetch(target, {
      headers: {
        accept: "image/*,*/*",
        ...(referer ? { referer, origin: new URL(referer).origin } : {}),
      },
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(`Upstream ${upstream.status}`, { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
        // Pages are immutable once fetched; let the browser and any edge cache hold them.
        "cache-control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new Response("Upstream unreachable", { status: 502 });
  }
}

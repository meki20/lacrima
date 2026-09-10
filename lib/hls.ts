/* HLS is the only way to get a first frame in about a second: the player fetches one
   short segment instead of waiting for torrent metadata and peers. But a playlist is
   text, and every URI inside it is fetched by the browser directly — so unless those
   URIs are rewritten to come back through the relay, the segments hit the origin and
   get CORS- or hotlink-blocked while the playlist itself loaded fine. */

const PLAYLIST_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
  "video/mpegurl",
  "video/x-mpegurl",
]);

/** Types a source might send for a playlist while meaning "I don't know". */
const VAGUE = new Set(["application/octet-stream", "text/plain", "binary/octet-stream"]);

export const PLAYLIST_TYPE = "application/vnd.apple.mpegurl";

/** Playlists must be rewritten; media must be streamed untouched. Guess wrong either
    way and playback breaks, so trust the declared type and fall back to the path. */
export function isPlaylist(contentType: string | null, url: string): boolean {
  const type = contentType?.split(";")[0].trim().toLowerCase();
  if (type) {
    if (PLAYLIST_TYPES.has(type)) return true;
    if (!VAGUE.has(type)) return false;
  }
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return false;
  }
}

/** Anything that isn't http(s) — a `data:` decryption key, mostly — is left alone. */
function absolute(uri: string, base: string): string | null {
  try {
    const u = new URL(uri, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/* #EXT-X-KEY, -MAP, -MEDIA, -I-FRAME-STREAM-INF and the low-latency tags all carry
   their target in a URI attribute rather than on a line of its own. */
const URI_ATTR = /URI="([^"]*)"/gi;

/**
 * Rewrite every URI in an HLS playlist through `relay`.
 *
 * @param base The playlist's own final URL, after redirects — relative segment paths
 *   resolve against it, so passing the pre-redirect URL points them at the wrong host.
 */
export function rewritePlaylist(
  body: string,
  base: string,
  relay: (absolute: string) => string,
): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const uri = line.trim();
      if (!uri) return line;
      if (uri.startsWith("#")) {
        return line.replace(URI_ATTR, (whole, target: string) => {
          const abs = absolute(target, base);
          return abs ? `URI="${relay(abs)}"` : whole;
        });
      }
      const abs = absolute(uri, base);
      return abs ? relay(abs) : line;
    })
    .join("\n");
}

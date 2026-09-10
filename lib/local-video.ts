import { createReadStream, statSync } from "node:fs";

/*
 * Serving the cached copy of an episode.
 *
 * There used to be a size/name heuristic here that guessed which file in the
 * torrent store was the episode. It could not tell a finished download from a
 * sparse one, so a rewatch was served zeros with a confident content-length.
 * The cache now only ever points at a file something wrote byte-complete, which
 * makes the guessing unnecessary.
 */

export function readFileRange(
  path: string,
  range: { start: number; end: number } | null,
) {
  const size = statSync(path).size;
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  return {
    stream: createReadStream(path, { start, end }),
    size,
    start,
    end,
  };
}

export function mimeForPath(path: string) {
  if (/\.mp4$/i.test(path)) return "video/mp4";
  if (/\.webm$/i.test(path)) return "video/webm";
  if (/\.mkv$/i.test(path)) return "video/x-matroska";
  return "application/octet-stream";
}

/**
 * What to tell the browser this is.
 *
 * A `<video>` element refuses to decode `application/octet-stream` outright — it
 * does not sniff its way past it — so a file host that labels its bytes that way
 * produces a player that never starts, with no error to show. The torrent path
 * has always normalised this; the HTTP path passed the label through, which is
 * why One-Punch Man episode 1 played (a torrent won its race, `video/mp4`) and
 * episode 3 did not (a direct link won, `application/octet-stream`) — byte for
 * byte the same Matroska container in both cases.
 *
 * `video/mp4` is a deliberate lie that works: browsers route media by codec
 * support, not by this string, and it is what the torrent path already sends.
 */
const VAGUE = /^(?:application\/octet-stream|binary\/octet-stream|application\/force-download)$/i;

export function playableType(type: string | null | undefined): string {
  return !type || VAGUE.test(type.split(";")[0].trim()) ? "video/mp4" : type;
}

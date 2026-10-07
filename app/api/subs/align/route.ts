import { parseLangToken } from "@/lib/audio";
import { parseCacheCtx } from "@/lib/play-cache";
import { decodeSubBytes, loadSubIndex, readSubBody } from "@/lib/sub-cache";
import { envelope, fitFile, MIN_AUDIO, readTap, tapPath, tapSeconds } from "@/lib/sub-align";
import { parseCues, type SubFit } from "@/lib/subs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where each subtitle file of one language sits against the audio `src` is playing.
 * `src` is the exact remux URL the player requested; the remux has been writing its
 * audio beside the video, and until three minutes of it exist there is no verdict.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const src = q.get("src");
  const lang = parseLangToken(q.get("lang"));
  const ctx = parseCacheCtx(q);
  if (!src || !lang || !ctx) return Response.json({ error: "Missing src, lang or media context" }, { status: 400 });

  const path = tapPath(src);
  const seconds = Math.floor(tapSeconds(path));
  if (seconds < MIN_AUDIO) return Response.json({ ready: false, seconds });

  const env = envelope(readTap(path));
  const origin = Number(new URL(src, "http://lacrima.local").searchParams.get("t") ?? 0) || 0;
  const fits: SubFit[] = [];
  for (const cue of loadSubIndex(ctx, -1).filter((c) => c.lang === lang)) {
    const read = await readSubBody(ctx, cue.url);
    if (!read.buf) continue;
    fits.push(fitFile(cue.id, env, parseCues(decodeSubBytes(read.buf)), origin));
  }
  return Response.json({ ready: true, seconds, fits });
}

import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { castOrigin } from "@/lib/cast-origin";
import { FFMPEG, selfRelayUrl } from "@/lib/remux";

export const runtime = "nodejs";

type Session = {
  dir: string;
  child: ChildProcess;
  mediaKey: string;
  failed: boolean;
  stopped: boolean;
  idle: NodeJS.Timeout;
};

const sessions = new Map<string, Promise<Session>>();

function stop(id: string, session: Session) {
  if (session.stopped) return;
  session.stopped = true;
  sessions.delete(id);
  clearTimeout(session.idle);
  if (session.child.exitCode === null) session.child.kill();
  else void rm(session.dir, { recursive: true, force: true });
}

function touch(id: string, session: Session) {
  clearTimeout(session.idle);
  session.idle = setTimeout(() => stop(id, session), 5 * 60_000);
  session.idle.unref();
}

async function start(id: string, source: URL, mediaKey: string): Promise<Session> {
  const dir = await mkdtemp(join(tmpdir(), "lacrima-cast-"));
  const input = selfRelayUrl(source);
  const child = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "error",
    "-re", "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy",
    "-f", "hls", "-hls_time", "4", "-hls_list_size", "12",
    "-hls_flags", "delete_segments+temp_file",
    "-hls_segment_filename", join(dir, "seg%06d.ts"),
    join(dir, "index.m3u8"),
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const session: Session = { dir, child, mediaKey, failed: false, stopped: false, idle: setTimeout(() => {}, 0) };
  child.stderr?.resume();
  child.on("error", () => { session.failed = true; });
  child.on("close", (code) => {
    session.failed = code !== 0;
    if (session.stopped) void rm(dir, { recursive: true, force: true });
  });
  touch(id, session);
  return session;
}

async function playlist(session: Session, id: string): Promise<string> {
  for (let n = 0; n < 300; n++) {
    const body = await readFile(join(session.dir, "index.m3u8"), "utf8").catch(() => "");
    if (body.includes("#EXTINF:")) {
      return body.replace(/^seg(\d{6})\.ts$/gm, `/api/cast?id=${id}&seg=seg$1.ts`);
    }
    if (session.failed) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw Error("Cast stream did not produce a playable segment.");
}

function cors(req: Request, headers: Record<string, string>): Record<string, string> {
  const origin = castOrigin(req);
  return origin ? { ...headers, "access-control-allow-origin": origin, vary: "Origin" } : headers;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = q.get("id");
  const segment = q.get("seg");
  if (id || segment) {
    if (!id || !/^[a-f0-9]{32}$/.test(id) || !segment || !/^seg\d{6}\.ts$/.test(segment)) {
      return new Response("Invalid segment", { status: 400 });
    }
    const session = await sessions.get(id);
    if (!session) return new Response("Cast session expired", { status: 404 });
    touch(id, session);
    const body = await readFile(join(session.dir, segment)).catch(() => null);
    if (!body) return new Response("Segment unavailable", { status: 404 });
    return new Response(new Uint8Array(body), {
      headers: cors(req, { "content-type": "video/mp2t", "content-length": String(body.length), "cache-control": "no-store" }),
    });
  }

  const raw = q.get("src");
  if (!raw) return new Response("Missing stream", { status: 400 });
  let source: URL;
  try {
    source = new URL(raw);
    if (!/^https?:$/.test(source.protocol) || source.pathname !== "/api/stream" || source.searchParams.get("remux") !== "1") {
      return new Response("Invalid stream", { status: 400 });
    }
  } catch {
    return new Response("Invalid stream", { status: 400 });
  }
  // Only the query is reused; ffmpeg always calls this server, never src's host.
  source = new URL(`/api/stream${source.search}`, req.url);
  source.searchParams.set("pack", "ts");
  source.searchParams.set("video", "h264");
  const key = createHash("sha256").update(source.search).digest("hex").slice(0, 32);
  const mediaKey = ["cv", "cm", "cc"].map((name) => source.searchParams.get(name) ?? "").join("\0");
  try {
    let pending = sessions.get(key);
    if (!pending) {
      if (source.searchParams.has("cc")) {
        for (const [oldId, previous] of sessions) {
          const old = await previous.catch(() => null);
          if (old && old.mediaKey === mediaKey) stop(oldId, old);
        }
      }
      pending = start(key, source, mediaKey);
      sessions.set(key, pending);
    }
    const session = await pending;
    touch(key, session);
    const body = await playlist(session, key);
    return new Response(body, {
      headers: cors(req, { "content-type": "application/x-mpegURL", "cache-control": "no-store" }),
    });
  } catch {
    const pending = sessions.get(key);
    if (pending) {
      const session = await pending.catch(() => null);
      if (session) stop(key, session);
      else sessions.delete(key);
    }
    return new Response("Cast stream could not start", { status: 502 });
  }
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

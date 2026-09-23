import { currentProfile } from "@/lib/profile";
import { profileBackup, restoreProfile, restoreSources, sourcesBackup, unzipBackup, zipBackup } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ kind: string }> };

export async function GET(_req: Request, context: Context) {
  const { kind } = await context.params;
  try {
    const backup = kind === "profile"
      ? profileBackup((await currentProfile()).id)
      : kind === "sources"
        ? await sourcesBackup()
        : null;
    if (!backup) return Response.json({ error: "Unknown backup type." }, { status: 404 });
    const day = new Date().toISOString().slice(0, 10);
    const zip = zipBackup(backup);
    const body = new ArrayBuffer(zip.length);
    new Uint8Array(body).set(zip);
    return new Response(body, { headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="lacrima-${kind}-${day}.zip"`,
      "cache-control": "no-store",
    } });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 503 });
  }
}

export async function POST(req: Request, context: Context) {
  const { kind } = await context.params;
  try {
    const form = await req.formData();
    const file = form.get("backup");
    if (!file || typeof file === "string") return Response.json({ error: "Choose a ZIP backup first." }, { status: 400 });
    const backup = unzipBackup(Buffer.from(await file.arrayBuffer()));
    if (kind === "profile") {
      restoreProfile((await currentProfile()).id, backup);
      return Response.json({ ok: true, message: "Imported this profile." });
    }
    if (kind === "sources") return Response.json({ ok: true, message: await restoreSources(backup) });
    return Response.json({ error: "Unknown backup type." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The backup could not be processed.";
}

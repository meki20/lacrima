#!/usr/bin/env node
/**
 * Vet sources against the same ten titles every time and score each 0-10.
 *
 * The app does this itself for every source (and shows the score on the Sources page);
 * this is the same vet from a terminal, for an addon you have not added yet.
 *
 *   node scripts/vet-sources.mjs <manifest-url> ...     addons by URL, installed or not
 *   node scripts/vet-sources.mjs --installed            every installed video addon
 *   node scripts/vet-sources.mjs --all                  ...plus stored-but-uninstalled ones
 *   node scripts/vet-sources.mjs --kind manga|novel     every installed manga / novel source
 *   --json                                              machine-readable instead of a table
 *
 * `--installed`, `--all` and `--kind` read the app's database, and Docker holds that open:
 * never point the host at the live file (SQLite WAL cannot be shared across the VM
 * boundary and the app starts answering 500). Vet a private snapshot instead:
 *
 *   docker exec lacrima node -e "new (require('node:sqlite').DatabaseSync)('/data/lacrima.db',{readOnly:true}).exec(\"vacuum into '/data/_vet.db'\")"
 *   LACRIMA_DB=data/_vet.db SUWAYOMI_URL=http://localhost:4567 node scripts/vet-sources.mjs --installed
 *
 * (Manifest URLs need no database at all.) Delete the snapshot and its -wal/-shm afterwards.
 *
 * Scoring lives in lib/vet.ts (coverage 5, liveness 3, speed 2), the probing in
 * lib/vet-run.ts. A "hit" means what it means in the app: a playable listing for the
 * right work and the right episode.
 */
import { backend, langMatches } from "../lib/sources/index.ts";
import { listStoredPlugins } from "../lib/sources/store.ts";
import { VET_MANGA, VET_NOVELS, VET_VIDEO } from "../lib/vet.ts";
import { vetAddon, vetReadable } from "../lib/vet-run.ts";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const kindArg = args.includes("--kind") ? args[args.indexOf("--kind") + 1] : null;
const urls = args.filter((a) => /^https?:\/\//i.test(a));
const JSON_OUT = flag("--json");
const POOL = 5;

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Hits per kind, so a specialist reads as 3/3 anime rather than 3/10. */
function byKind(r) {
  if (r.kind !== "video") return "";
  const kinds = { movie: [0, 0], series: [0, 0], anime: [0, 0] };
  r.probes.forEach((p, i) => {
    if (!p.inScope) return;
    const k = kinds[VET_VIDEO[i].kind];
    k[1]++;
    if (p.hit && p.alive !== 0) k[0]++;
  });
  return Object.entries(kinds).map(([k, [h, n]]) => `${k[0]}${n ? `${h}/${n}` : "-"}`).join(" ");
}

function row(r) {
  const v = r.verdict;
  if (!v) return `${"-".padStart(5)}  ${r.name.slice(0, 34).padEnd(34)}  ${r.skipped?.text ?? ""}`;
  const hits = `${v.hits}/${v.scope}`.padStart(5);
  const avg = v.avgHitMs == null ? "-" : `${v.avgHitMs}ms`;
  const med = v.medianHitMs == null ? "-" : `${v.medianHitMs}ms`;
  const alive = v.alive == null ? "-" : `${Math.round(v.alive * 100)}%`;
  return `${v.score.toFixed(1).padStart(5)}  ${r.name.slice(0, 34).padEnd(34)}  ${hits}  ${avg.padStart(7)}  ${med.padStart(7)}  ${alive.padStart(5)}  ${byKind(r).padEnd(18)}${r.note ?? ""}`;
}

function report(results) {
  const scored = results.filter((r) => r.verdict).sort((a, b) => b.verdict.score - a.verdict.score);
  const skipped = results.filter((r) => !r.verdict);
  console.log(`\n${"score".padStart(5)}  ${"source".padEnd(34)}  ${"hits".padStart(5)}  ${"avg".padStart(7)}  ${"median".padStart(7)}  ${"alive".padStart(5)}  ${"m/s/a hits".padEnd(18)}`);
  for (const r of scored) console.log(row(r));
  for (const r of skipped) console.log(row(r));
  console.log("\nscore = coverage 5 + liveness 3 + speed 2.  avg/median are over hits only.  hits are out of the titles the source claims to serve.");
}

const emit = (results) => (JSON_OUT ? console.log(JSON.stringify(results, null, 2)) : report(results));

if (kindArg === "manga" || kindArg === "novel") {
  const listed = await backend(kindArg).listSources();
  if (!listed.ok) {
    console.error(`Could not list ${kindArg} sources: ${listed.reason}`);
    process.exit(1);
  }
  const mine = listed.value.filter((s) => !s.isLocal && langMatches(s.lang));
  if (!JSON_OUT) console.error(`Vetting ${mine.length} ${kindArg} sources on ${(kindArg === "manga" ? VET_MANGA : VET_NOVELS).length} titles...`);
  emit(await pool(mine, POOL, (s) => vetReadable(kindArg, s)));
} else {
  const sources = [];
  if (flag("--installed") || flag("--all")) {
    for (const p of listStoredPlugins("anime")) {
      if (p.plugin_url && (flag("--all") || p.installed)) sources.push({ name: p.name, url: p.plugin_url });
    }
  }
  for (const url of urls) sources.push({ name: null, url });
  if (!sources.length) {
    console.error("Nothing to vet. Pass manifest URLs, --installed, --all, or --kind manga|novel.");
    process.exit(1);
  }
  if (!JSON_OUT) console.error(`Vetting ${sources.length} addons on ${VET_VIDEO.length} titles...`);
  emit(await pool(sources, POOL, vetAddon));
}
process.exit(0);

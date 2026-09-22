import type { MediaKind } from "../media.ts";
import type { Result } from "../result.ts";
import { Err, Ok } from "../result.ts";
import type { SourceBackend, SourceInfo } from "./types.ts";
import { suwayomi } from "./suwayomi.ts";
import { lnreader } from "./lnreader.ts";
import { stremio } from "./stremio.ts";
import { isSourceDisabled } from "./store.ts";

export const BACKENDS: Record<MediaKind, SourceBackend> = {
  manga: suwayomi,
  novel: lnreader,
  anime: stremio,
};

export const backend = (kind: MediaKind): SourceBackend => BACKENDS[kind] ?? suwayomi;

const LANGS = (process.env.LACRIMA_LANGS ?? "en,all").split(",").map((s) => s.trim().toLowerCase());

/** `*` means every language. `all` is a source lang code (MangaDex "all"), not a wildcard. */
export function langMatches(lang: string, langs = LANGS): boolean {
  if (langs.includes("*")) return true;
  const l = lang.toLowerCase();
  if (langs.some((w) => w !== "*" && (l === w || l.startsWith(`${w}-`) || l.startsWith(`${w},`)))) {
    return true;
  }
  if (langs.includes("en") && (l === "en" || l.includes("english"))) return true;
  return false;
}

function langPref(lang: string): number {
  const l = lang.toLowerCase();
  if (l === "en" || l.startsWith("en-") || l.startsWith("en,") || l.includes("english")) return 0;
  if (l === "all") return 1;
  return 2;
}

export function pickSearchable<T extends { isLocal: boolean; lang: string; id: string; kind: MediaKind }>(
  all: T[],
): T[] {
  return all
    .filter(
      (s) => !s.isLocal && langMatches(s.lang) && !isSourceDisabled(s.kind, s.id),
    )
    .sort((a, b) => langPref(a.lang) - langPref(b.lang))
    .slice(0, 8);
}

const HEALTH_TTL_MS = 20_000;
let healthAt = 0;
let healthHit: Result<SourceInfo[]> | null = null;

export function clearSourceHealth() {
  healthAt = 0;
  healthHit = null;
}

export async function allRemoteSources(): Promise<Result<SourceInfo[]>> {
  if (healthHit && Date.now() - healthAt < HEALTH_TTL_MS) return healthHit;
  const rs = await Promise.all(Object.values(BACKENDS).map((b) => b.listSources()));
  const out: SourceInfo[] = [];
  const failures: string[] = [];
  for (const [i, r] of rs.entries()) {
    const name = Object.values(BACKENDS)[i].name;
    if (!r.ok) {
      failures.push(`${name}: ${r.reason}`);
      continue;
    }
    out.push(...r.value.filter((s) => !s.isLocal && !isSourceDisabled(s.kind, s.id)));
  }
  const hit: Result<SourceInfo[]> =
    out.length === 0 && failures.length === Object.keys(BACKENDS).length
      ? Err(`Every source backend failed. ${failures.join(" ")}`)
      : Ok(out);
  healthAt = Date.now();
  healthHit = hit;
  return hit;
}

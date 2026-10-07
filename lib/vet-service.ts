/**
 * The app's vetter: real sources, real switches, started with the server.
 *
 * "Off" means what the Sources page already means by it. Manga sources are switched
 * off in `source_disabled` and stay listed; video addons and novel plugins are
 * switched off by uninstalling them, which moves them to the Extensions list with an
 * Enable button. Either way the user can turn it back on or delete it.
 */
import { backend, clearSourceHealth, langMatches } from "./sources/index.ts";
import { isSourceDisabled, listStoredPlugins, setSourceDisabled } from "./sources/store.ts";
import { runVet } from "./vet-run.ts";
import { makeVetter } from "./vet-queue.ts";
import type { VetKind, VetView } from "./vet.ts";

export const VET_KINDS: VetKind[] = ["anime", "manga", "novel"];

export const isVetKind = (v: unknown): v is VetKind => VET_KINDS.includes(v as VetKind);

async function vettable(kind: VetKind): Promise<string[]> {
  if (kind === "manga") {
    const listed = await backend("manga").listSources();
    if (!listed.ok) return [];
    return listed.value
      .filter((s) => !s.isLocal && langMatches(s.lang) && !isSourceDisabled("manga", s.id))
      .map((s) => s.id);
  }
  return listStoredPlugins(kind)
    .filter((p) => p.installed && (kind === "novel" || p.plugin_url))
    .map((p) => p.id);
}

async function turnOff(kind: VetKind, id: string) {
  if (kind === "manga") setSourceDisabled("manga", id, true);
  else await backend(kind).setExtensionInstalled(id, false);
  clearSourceHealth();
}

const vetter = makeVetter({ run: runVet, turnOff, vettable });

/** Vet this source now (or join the vet already running for it). */
export const retryVet = (kind: VetKind, id: string): VetView => {
  void vetter.queue(kind, id);
  return vetter.views(kind, [id])[id];
};

export const vetViewsFor = (kind: VetKind, ids: string[]) => vetter.views(kind, ids);

/** Vet whatever of this kind is on and has never been judged. Cheap when there is nothing to do. */
export const ensureVetted = (kind: VetKind) => vetter.ensure(kind).catch(() => undefined);

const SWEEP_EVERY_MS = 6 * 60 * 60_000;
let started = false;

/**
 * Called once when the server starts. The delay keeps the first sweep out of the way of
 * startup and of whoever is already watching something; the interval is what retries a
 * source that could not be judged (rate-limited, unreachable) without anyone asking.
 */
export function startVetting() {
  if (started) return;
  started = true;
  const sweep = () => void Promise.all(VET_KINDS.map(ensureVetted));
  setTimeout(sweep, 20_000).unref();
  setInterval(sweep, SWEEP_EVERY_MS).unref();
}

/**
 * Where vet results live and the queue that produces them.
 *
 * A vet costs a source ten requests, so they are deliberate: two at a time, one per
 * source, and nothing re-vets itself except a source that has never been judged.
 * Written as a factory so the behaviour (first vet may switch off, a retry may not)
 * is tested with fakes instead of the network.
 */
import type { DatabaseSync } from "node:sqlite";
import { db, plain, plainAll } from "./db.ts";
import { decide, viewOf, type Outcome, type VetKind, type VetRow, type VetView } from "./vet.ts";

export function getVet(kind: VetKind, id: string, d: DatabaseSync = db()): VetRow | null {
  const row = d.prepare("select * from source_vets where kind = ? and id = ?").get(kind, id) as VetRow | undefined;
  return row ? plain(row) : null;
}

export function listVets(kind: VetKind, d: DatabaseSync = db()): Map<string, VetRow> {
  const rows = plainAll(d.prepare("select * from source_vets where kind = ?").all(kind) as VetRow[]);
  return new Map(rows.map((r) => [r.id, r]));
}

export function putVet(r: VetRow, d: DatabaseSync = db()) {
  d.prepare(
    `insert into source_vets
       (kind, id, status, score, hits, scope, avg_ms, median_ms, alive, note, vetted_at, confirmed_at, auto_off)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(kind, id) do update set
       status = excluded.status, score = excluded.score, hits = excluded.hits, scope = excluded.scope,
       avg_ms = excluded.avg_ms, median_ms = excluded.median_ms, alive = excluded.alive, note = excluded.note,
       vetted_at = excluded.vetted_at, confirmed_at = excluded.confirmed_at, auto_off = excluded.auto_off`,
  ).run(
    r.kind, r.id, r.status, r.score, r.hits, r.scope, r.avg_ms, r.median_ms, r.alive,
    r.note, r.vetted_at, r.confirmed_at, r.auto_off,
  );
}

/** A source that could not be judged is asked again after this long, never sooner. */
export const RETRY_UNSURE_MS = 6 * 60 * 60_000;

export type VetDeps = {
  run(kind: VetKind, id: string): Promise<Outcome>;
  turnOff(kind: VetKind, id: string): Promise<void>;
  /** Ids of the sources of this kind that are on, and so worth vetting unprompted. */
  vettable(kind: VetKind): Promise<string[]>;
  d?: () => DatabaseSync;
  now?: () => number;
  /** How many vets may run at once. */
  max?: number;
};

export function makeVetter(deps: VetDeps) {
  const d = deps.d ?? db;
  const now = deps.now ?? Date.now;
  const max = deps.max ?? 2;
  const key = (kind: VetKind, id: string) => `${kind}|${id}`;
  const pending = new Map<string, Promise<void>>();
  let running = 0;
  const waiting: (() => void)[] = [];

  async function slot() {
    if (running < max) {
      running++;
      return;
    }
    // The slot is handed over still counted, so the cap cannot be overshot between wake and run.
    await new Promise<void>((resume) => waiting.push(resume));
  }
  function release() {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }

  /** Vet one source; joins the vet already running for it rather than starting a second. */
  function queue(kind: VetKind, id: string): Promise<void> {
    const k = key(kind, id);
    const joined = pending.get(k);
    if (joined) return joined;
    const job = (async () => {
      await slot();
      try {
        let out: Outcome;
        try {
          out = await deps.run(kind, id);
        } catch (e) {
          out = { status: "inconclusive", note: e instanceof Error ? e.message : "the vet failed" };
        }
        const { row, off } = decide(getVet(kind, id, d()), kind, id, out, now());
        putVet(row, d());
        if (off) await deps.turnOff(kind, id);
      } catch (e) {
        // Nothing awaits a background vet, so a rejection here would be an unhandled one.
        console.warn(`[vet] ${kind} ${id}: ${e instanceof Error ? e.message : e}`);
      } finally {
        release();
        pending.delete(k);
      }
    })();
    pending.set(k, job);
    return job;
  }

  /** Vet whatever is on and has never been judged (or could not be, a while ago). */
  async function ensure(kind: VetKind): Promise<void> {
    const have = listVets(kind, d());
    for (const id of await deps.vettable(kind)) {
      const row = have.get(id);
      const stale = row?.status === "inconclusive" && now() - row.vetted_at > RETRY_UNSURE_MS;
      if (!row || stale) void queue(kind, id);
    }
  }

  const isPending = (kind: VetKind, id: string) => pending.has(key(kind, id));

  /** What the page shows for these ids, in one read. */
  function views(kind: VetKind, ids: string[]): Record<string, VetView> {
    const rows = listVets(kind, d());
    return Object.fromEntries(ids.map((id) => [id, viewOf(rows.get(id) ?? null, isPending(kind, id))]));
  }

  return { queue, ensure, isPending, views, idle: () => Promise.all([...pending.values()]).then(() => undefined) };
}

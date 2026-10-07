import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.ts";
import { RETRY_UNSURE_MS, getVet, makeVetter, putVet } from "./vet-queue.ts";
import type { Outcome } from "./vet.ts";

const ok = (score: number): Outcome => ({
  status: "ok",
  verdict: { score, hits: 3, scope: 10, avgHitMs: 400, medianHitMs: 300, alive: 1 },
});

/** A vetter wired to fakes: the score each id gets, and a log of what was switched off. */
function setup(scores: Record<string, Outcome | (() => Promise<Outcome>)>, extra: { max?: number; now?: () => number } = {}) {
  const d = new DatabaseSync(":memory:");
  migrate(d);
  const off: string[] = [];
  let live = 0;
  let peak = 0;
  const vetter = makeVetter({
    d: () => d,
    max: extra.max,
    now: extra.now,
    async run(_kind, id) {
      live++;
      peak = Math.max(peak, live);
      try {
        const s = scores[id];
        return typeof s === "function" ? await s() : s;
      } finally {
        live--;
      }
    },
    async turnOff(kind, id) {
      off.push(`${kind}:${id}`);
    },
    async vettable() {
      return Object.keys(scores);
    },
  });
  return { d, off, vetter, peak: () => peak };
}

test("migration 20 creates the vet table", () => {
  const d = new DatabaseSync(":memory:");
  migrate(d);
  putVet({ kind: "anime", id: "x", status: "ok", score: 7.5, hits: 6, scope: 10, avg_ms: 100, median_ms: 90, alive: 1, note: null, vetted_at: 1, confirmed_at: 1, auto_off: 0 }, d);
  assert.equal(getVet("anime", "x", d)?.score, 7.5);
  assert.equal(getVet("anime", "y", d), null);
});

test("a new source scoring five or below is turned off once, and a retry never does it again", async () => {
  const { vetter, off, d } = setup({ good: ok(9), bad: ok(4.5) });
  await vetter.ensure("anime");
  await vetter.idle();
  assert.deepEqual(off, ["anime:bad"]);
  assert.equal(getVet("anime", "good", d)?.score, 9);
  assert.equal(getVet("anime", "bad", d)?.auto_off, 1);
  // The user enabled it again and asked for another vet: it scores worse, and stays on.
  await vetter.queue("anime", "bad");
  assert.deepEqual(off, ["anime:bad"]);
  // Already judged, so a sweep leaves both alone.
  await vetter.ensure("anime");
  await vetter.idle();
  assert.deepEqual(off, ["anime:bad"]);
});

test("a source that could not be judged is not turned off, and is asked again after six hours", async () => {
  let t = 1_000;
  const { vetter, off, d } = setup({ shy: { status: "inconclusive", note: "rate-limited" } }, { now: () => t });
  await vetter.ensure("anime");
  await vetter.idle();
  assert.equal(getVet("anime", "shy", d)?.status, "inconclusive");
  assert.deepEqual(off, []);
  assert.equal(vetter.views("anime", ["shy"]).shy.state, "unsure");
  // Too soon to ask again: nothing is queued.
  await vetter.ensure("anime");
  assert.equal(vetter.isPending("anime", "shy"), false);
  t += RETRY_UNSURE_MS + 1;
  await vetter.ensure("anime");
  assert.equal(vetter.isPending("anime", "shy"), true);
  await vetter.idle();
});

test("one vet per source at a time, and no more than the cap overall", async () => {
  const gate: (() => void)[] = [];
  const slow = () => new Promise<Outcome>((resolve) => gate.push(() => resolve(ok(8))));
  const { vetter, peak } = setup({ a: slow, b: slow, c: slow }, { max: 2 });
  const first = vetter.queue("anime", "a");
  assert.equal(vetter.queue("anime", "a"), first, "asking again joins the running vet");
  void vetter.queue("anime", "b");
  void vetter.queue("anime", "c");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(gate.length, 2, "the third waits for a free slot");
  assert.equal(vetter.views("anime", ["c"]).c.state, "pending");
  gate.shift()!();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(gate.length, 2);
  gate.splice(0).forEach((g) => g());
  await vetter.idle();
  assert.equal(peak(), 2);
});

test("a vet that throws is recorded as unsure and never escapes", async () => {
  const { vetter, d, off } = setup({ boom: () => Promise.reject(new Error("socket hang up")) });
  await vetter.queue("manga", "boom");
  assert.equal(getVet("manga", "boom", d)?.status, "inconclusive");
  assert.match(getVet("manga", "boom", d)?.note ?? "", /socket hang up/);
  assert.deepEqual(off, []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTO_OFF_AT, VET_MANGA, VET_NOVELS, VET_VIDEO, decide, transientNote, verdict, viewOf,
  type Outcome, type Probe, type VetRow,
} from "./vet.ts";

const probe = (over: Partial<Probe> = {}): Probe => ({
  label: "t",
  inScope: true,
  hit: true,
  ms: 300,
  alive: 1,
  ...over,
});

test("the fixed picks stay ten each, so two scores stay comparable", () => {
  assert.equal(VET_VIDEO.length, 10);
  assert.equal(VET_MANGA.length, 10);
  assert.equal(VET_NOVELS.length, 10);
  assert.ok(VET_VIDEO.every((t) => /^tt\d+$/.test(t.imdb)));
  assert.ok(VET_VIDEO.filter((t) => t.kind === "anime").every((t) => t.kitsu));
});

test("a source that answers everything, alive and fast, scores ten", () => {
  const v = verdict(Array.from({ length: 10 }, () => probe()));
  assert.equal(v.score, 10);
  assert.equal(v.hits, 10);
  assert.equal(v.avgHitMs, 300);
});

test("a source that finds nothing scores zero, however fast it said so", () => {
  const v = verdict(Array.from({ length: 10 }, () => probe({ hit: false, ms: 80, alive: null })));
  assert.equal(v.score, 0);
  assert.equal(v.avgHitMs, null);
});

test("coverage, liveness and speed each cost what the header says they cost", () => {
  // Half the titles found: 2.5 coverage; all alive: 3; 500ms or less: 2.
  const half = verdict([...Array(5)].map(() => probe()).concat([...Array(5)].map(() => probe({ hit: false }))));
  assert.equal(half.score, 7.5);
  // A thin swarm keeps the title but pays for it in liveness: 5 + 3 * 0.3 + 2.
  assert.equal(verdict([probe({ alive: 0.3 })]).score, 7.9);
  // Unchecked is half credit, and 5s or slower forfeits the 2 speed points.
  assert.equal(verdict([probe({ alive: null, ms: 5000 })]).score, 6.5);
});

test("a hit that proves dead is not a hit", () => {
  const v = verdict([probe({ alive: 0 }), probe({ alive: 0 })]);
  assert.equal(v.hits, 0);
  assert.equal(v.score, 0);
  assert.equal(v.avgHitMs, null);
});

test("what a source never claimed to serve is not held against it", () => {
  const v = verdict([probe(), probe({ inScope: false, hit: false })]);
  assert.equal(v.scope, 1);
  assert.equal(v.score, 10);
  assert.equal(verdict([probe({ inScope: false })]).score, 0);
});

test("only hits are timed, and the median ignores one outlier", () => {
  const v = verdict([probe({ ms: 100 }), probe({ ms: 200 }), probe({ ms: 9000 }), probe({ hit: false, ms: 20000 })]);
  assert.equal(v.avgHitMs, 3100);
  assert.equal(v.medianHitMs, 200);
});


const ok = (score: number): Outcome => ({
  status: "ok",
  verdict: { score, hits: 4, scope: 10, avgHitMs: 300, medianHitMs: 250, alive: 1 },
});

test("only the first conclusive vet may turn a source off, at five or below", () => {
  assert.equal(AUTO_OFF_AT, 5);
  assert.equal(decide(null, "anime", "a", ok(4), 1).off, true);
  assert.equal(decide(null, "anime", "a", ok(5), 1).off, true);
  assert.equal(decide(null, "anime", "a", ok(5.1), 1).off, false);
  const first = decide(null, "anime", "a", ok(4), 1);
  assert.equal(first.row.confirmed_at, 1);
  assert.equal(first.row.auto_off, 1);
  // The user switched it back on; a retry that scores worse must not undo that.
  const retry = decide(first.row, "anime", "a", ok(2), 9);
  assert.equal(retry.off, false);
  assert.equal(retry.row.score, 2);
  assert.equal(retry.row.confirmed_at, 1);
  assert.equal(retry.row.auto_off, 1);
});

test("an inconclusive vet confirms nothing and a failed retry keeps the score", () => {
  const unsure: Outcome = { status: "inconclusive", note: "rate-limited" };
  const first = decide(null, "anime", "a", unsure, 1);
  assert.equal(first.off, false);
  assert.equal(first.row.confirmed_at, null);
  // Rate-limited once, then judged: this is still the first confirmation.
  assert.equal(decide(first.row, "anime", "a", ok(3), 2).off, true);
  const scored = decide(null, "anime", "a", ok(8), 1).row;
  const failed = decide(scored, "anime", "a", unsure, 2);
  assert.equal(failed.row.score, 8);
  assert.match(failed.row.note ?? "", /rate-limited/);
});

test("rate limits and timeouts are not evidence against a source", () => {
  const miss = (note?: string): Probe => ({ label: "t", inScope: true, hit: false, ms: 50, alive: null, note });
  assert.equal(transientNote(Array.from({ length: 10 }, () => miss("rate-limited"))), "rate-limited");
  const dead = [...Array(3)].map(() => miss("timed out")).concat([...Array(7)].map(() => miss("skipped: timed out")));
  assert.equal(transientNote(dead), "timed out");
  // A source that answers "nothing" is a bad source; a broken extension says so too.
  assert.equal(transientNote(Array.from({ length: 10 }, () => miss())), null);
  assert.equal(transientNote(Array.from({ length: 10 }, () => miss("The manga source failed."))), null);
  // One hit anywhere means it was reachable and answering.
  const mostly = [...Array(9)].map(() => miss("rate-limited")).concat([{ label: "t", inScope: true, hit: true, ms: 1, alive: 1 }]);
  assert.equal(transientNote(mostly), null);
});

test("the Sources page view says what happened and never invents a score", () => {
  const row = decide(null, "manga", "x", ok(4.2), 1).row as VetRow;
  const v = viewOf(row, false);
  assert.equal(v.state, "ok");
  assert.equal(v.tone, "bad");
  assert.match(v.tip, /Turned off automatically/);
  assert.equal(viewOf(row, true).state, "pending");
  assert.equal(viewOf(null, false).state, "none");
  assert.equal(viewOf(decide(null, "manga", "x", { status: "inconclusive", note: "timed out" }, 1).row, false).state, "unsure");
  assert.equal(viewOf({ ...row, score: 9.1, auto_off: 0 }, false).tone, "good");
  assert.equal(viewOf({ ...row, score: 6, auto_off: 0 }, false).tone, "mid");
});

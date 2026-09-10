import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bufferedEnd,
  clampBuffered,
  fmtClock,
  fmtRemaining,
  jumpPercent,
  planSeek,
  scrubPercents,
  type TimeRangesLike,
} from "./seek.ts";

const ranges = (pairs: [number, number][]): TimeRangesLike => ({
  length: pairs.length,
  start: (i) => pairs[i][0],
  end: (i) => pairs[i][1],
});

test("clampBuffered hits the containing range and stays off the edge", () => {
  const buf = ranges([
    [0, 12],
    [40, 90],
  ]);
  assert.equal(clampBuffered(buf, 8), 8);
  assert.equal(clampBuffered(buf, 12), 11.95);
  assert.equal(clampBuffered(buf, 50), 50);
  assert.equal(clampBuffered(buf, 20), null);
  assert.equal(clampBuffered(ranges([]), 5), null);
});

test("planSeek: native is always currentTime, even outside the buffer", () => {
  assert.deepEqual(
    planSeek({ next: 400, startAt: 0, native: true, ranges: ranges([[0, 10]]) }),
    { kind: "currentTime", time: 400 },
  );
});

test("planSeek: in-buffer remux is currentTime relative to startAt, never a restart", () => {
  const plan = planSeek({
    next: 610,
    startAt: 600,
    native: false,
    ranges: ranges([[0, 120]]),
  });
  assert.deepEqual(plan, { kind: "currentTime", time: 10 });
});

test("planSeek: ±10 around the playhead stays in a 2-minute buffer", () => {
  const startAt = 1400;
  const playhead = 30;
  const buf = ranges([[0, 120]]);
  const back = planSeek({ next: startAt + playhead - 10, startAt, native: false, ranges: buf });
  const fwd = planSeek({ next: startAt + playhead + 10, startAt, native: false, ranges: buf });
  assert.equal(back.kind, "currentTime");
  assert.equal(fwd.kind, "currentTime");
  if (back.kind === "currentTime") assert.equal(back.time, 20);
  if (fwd.kind === "currentTime") assert.equal(fwd.time, 40);
});

test("planSeek: outside the buffer restarts at the absolute target", () => {
  assert.deepEqual(
    planSeek({ next: 900, startAt: 600, native: false, ranges: ranges([[0, 120]]) }),
    { kind: "restart", startAt: 900 },
  );
  assert.deepEqual(
    planSeek({ next: 10, startAt: 600, native: false, ranges: ranges([[0, 120]]) }),
    { kind: "restart", startAt: 10 },
  );
});

test("planSeek: missing ranges or a seek before startAt restarts", () => {
  assert.deepEqual(
    planSeek({ next: 610, startAt: 600, native: false, ranges: null }),
    { kind: "restart", startAt: 610 },
  );
  assert.deepEqual(
    planSeek({ next: -4, startAt: 0, native: false, ranges: ranges([[0, 10]]) }),
    { kind: "currentTime", time: 0 },
  );
});

test("scrubPercents maps remux buffer onto the episode clock", () => {
  const mid = scrubPercents({
    position: 650,
    duration: 1440,
    startAt: 600,
    native: false,
    bufferedEnd: 80,
  });
  assert.equal(mid.played, 650 / 1440);
  assert.equal(mid.buffered, 680 / 1440);
  const native = scrubPercents({
    position: 100,
    duration: 200,
    startAt: 0,
    native: true,
    bufferedEnd: 150,
  });
  assert.equal(native.played, 0.5);
  assert.equal(native.buffered, 0.75);
  assert.deepEqual(
    scrubPercents({ position: 10, duration: 0, startAt: 0, native: true, bufferedEnd: 5 }),
    { played: 0, buffered: 0 },
  );
});

test("fmtClock and fmtRemaining match player chrome", () => {
  assert.equal(fmtClock(0), "0:00");
  assert.equal(fmtClock(65), "1:05");
  assert.equal(fmtClock(3605), "1:00:05");
  assert.equal(fmtRemaining(1440, 600), "−14:00");
  assert.equal(fmtRemaining(90, 90), "−0:00");
  assert.equal(bufferedEnd(ranges([[0, 12], [40, 90]])), 90);
  assert.equal(bufferedEnd(ranges([])), null);
});

test("jumpPercent maps 0–9 onto the episode, and ignores junk", () => {
  assert.equal(jumpPercent(1440, "0"), 0);
  assert.equal(jumpPercent(1440, "5"), 720);
  assert.equal(jumpPercent(1440, "9"), 1296);
  assert.equal(jumpPercent(null, "5"), null);
  assert.equal(jumpPercent(0, "5"), null);
  assert.equal(jumpPercent(1440, "a"), null);
  assert.equal(jumpPercent(1440, "10"), null);
});

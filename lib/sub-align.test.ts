import assert from "node:assert/strict";
import { test } from "node:test";
import { TAP_RATE } from "./remux.ts";
import { envelope, fitCues } from "./sub-align.ts";
import type { TimedCue } from "./subs.ts";

/* Deterministic stand-in for dialogue: bursts of noise 0.6-4 s long with 0.5-6 s gaps. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function dialogue(seed: number, seconds: number) {
  const next = rng(seed);
  const spans: { start: number; end: number }[] = [];
  for (let t = 3 + next() * 4; t < seconds - 5; ) {
    const len = 0.6 + next() * 3.4;
    spans.push({ start: t, end: t + len });
    t += len + 0.5 + next() * 5.5;
  }
  return spans;
}

function audio(spans: { start: number; end: number }[], seconds: number): Uint8Array {
  const next = rng(99);
  const pcm = new Int16Array(seconds * TAP_RATE);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / TAP_RATE;
    const talking = spans.some((s) => t >= s.start && t < s.end);
    pcm[i] = Math.round((next() * 2 - 1) * (talking ? 9000 : 300));
  }
  return new Uint8Array(pcm.buffer);
}

const cues = (spans: { start: number; end: number }[], shift: number): TimedCue[] =>
  spans.map((s) => ({ start: s.start - shift, end: s.end - shift, text: "x" }));

const SECONDS = 200;
const spans = dialogue(7, SECONDS);
const env = envelope(audio(spans, SECONDS));

test("a file timed for another cut is found, and by how much", () => {
  for (const shift of [21.3, 4.95, -5.05, 0]) {
    const fit = fitCues(env, cues(spans, shift));
    assert.ok(fit.matched, `shift ${shift} should match`);
    assert.ok(Math.abs(fit.shift - shift) <= 0.1, `shift ${shift} measured ${fit.shift}`);
  }
});

test("a file that is not this episode's timeline is not matched", () => {
  const other = dialogue(1234, SECONDS);
  assert.equal(fitCues(env, cues(other, 0)).matched, false);
});

test("audio that starts mid-episode is measured against the episode clock", () => {
  const from = 600;
  const late = cues(spans, 2).map((c) => ({ ...c, start: c.start + from, end: c.end + from }));
  const fit = fitCues(env, late, from);
  assert.ok(fit.matched);
  assert.ok(Math.abs(fit.shift - 2) <= 0.1, `measured ${fit.shift}`);
});

test("silence and an empty file are not a match", () => {
  assert.equal(fitCues(env, []).matched, false);
  assert.equal(fitCues(envelope(new Uint8Array(SECONDS * TAP_RATE * 2)), cues(spans, 0)).matched, false);
});

test("a handful of cues is not enough to call a match", () => {
  assert.equal(fitCues(env, cues(spans, 0).slice(0, 8)).matched, false);
});

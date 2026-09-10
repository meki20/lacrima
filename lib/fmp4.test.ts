import assert from "node:assert/strict";
import test from "node:test";
import { readTfdt, readTimescale, scanRemuxClock } from "./fmp4.ts";

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.byteLength);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(Array.from(type, (c) => c.charCodeAt(0)), 4);
  out.set(payload, 8);
  return out;
}

function nest(type: string, ...kids: Uint8Array[]): Uint8Array {
  const n = kids.reduce((s, k) => s + k.byteLength, 0);
  const payload = new Uint8Array(n);
  let at = 0;
  for (const k of kids) {
    payload.set(k, at);
    at += k.byteLength;
  }
  return box(type, payload);
}

function mdhd(timescale: number): Uint8Array {
  const p = new Uint8Array(24);
  new DataView(p.buffer).setUint32(12, timescale);
  return box("mdhd", p);
}

function tfdt(ticks: number): Uint8Array {
  const p = new Uint8Array(8);
  new DataView(p.buffer).setUint32(4, ticks);
  return box("tfdt", p);
}

test("scanRemuxClock reads the first frame from mdhd + tfdt", () => {
  const init = nest("moov", nest("trak", nest("mdia", mdhd(24_000))));
  const frag = nest("moof", nest("traf", tfdt(24_000 * 173)));
  assert.equal(readTimescale(init), 24_000);
  assert.equal(readTfdt(frag), 24_000 * 173);

  let clock = scanRemuxClock(init, { timescale: null, origin: null });
  assert.equal(clock.timescale, 24_000);
  assert.equal(clock.origin, null);

  clock = scanRemuxClock(frag, clock);
  assert.equal(clock.origin, 173);
});

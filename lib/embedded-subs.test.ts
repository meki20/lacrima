import assert from "node:assert/strict";
import test from "node:test";
import {
  embeddedCueUrl,
  embeddedExtractArgsForTest,
  progressBucket,
} from "./embedded-subs.ts";

test("progressBucket steps by five percent until the file is complete", () => {
  assert.equal(progressBucket(0, false), "0");
  assert.equal(progressBucket(0.04, false), "0");
  assert.equal(progressBucket(0.05, false), "1");
  assert.equal(progressBucket(0.99, false), "19");
  assert.equal(progressBucket(0.5, true), "full");
  assert.equal(progressBucket(1, false), "full");
});

test("embedded cue urls carry the progress bucket so the player refetches", () => {
  assert.equal(embeddedCueUrl(2, "0"), "embedded:0:2.srt");
  assert.equal(embeddedCueUrl(2, "full"), "embedded:full:2.srt");
});

test("partial extracts tell ffmpeg to keep going past torrent holes", () => {
  const args = embeddedExtractArgsForTest("C:/cache/ep.mkv", 3);
  assert.equal(args[args.indexOf("-err_detect") + 1], "ignore_err");
  assert.equal(args[args.indexOf("-fflags") + 1], "+discardcorrupt");
  assert.equal(args[args.indexOf("-map") + 1], "0:3");
});

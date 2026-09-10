import assert from "node:assert/strict";
import { test } from "node:test";
import { playableType } from "./local-video.ts";

test("a vague content type becomes one the video element will decode", () => {
  /* One-Punch Man episode 3: the same Matroska bytes as episode 1, refused by
     Chrome purely because the file host labelled them octet-stream. */
  assert.equal(playableType("application/octet-stream"), "video/mp4");
  assert.equal(playableType("binary/octet-stream"), "video/mp4");
  assert.equal(playableType("application/force-download"), "video/mp4");
  assert.equal(playableType("APPLICATION/OCTET-STREAM"), "video/mp4");
  assert.equal(playableType("application/octet-stream; charset=binary"), "video/mp4");
  assert.equal(playableType(null), "video/mp4");
  assert.equal(playableType(undefined), "video/mp4");
  assert.equal(playableType(""), "video/mp4");
});

test("a content type the browser can act on is left alone", () => {
  assert.equal(playableType("video/mp4"), "video/mp4");
  assert.equal(playableType("video/x-matroska"), "video/x-matroska");
  assert.equal(playableType("video/webm"), "video/webm");
  // HLS must survive: rewriting it to video/mp4 would stop hls.js being used.
  assert.equal(playableType("application/vnd.apple.mpegurl"), "application/vnd.apple.mpegurl");
  assert.equal(playableType("application/x-mpegURL"), "application/x-mpegURL");
});

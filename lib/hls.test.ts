import assert from "node:assert/strict";
import test from "node:test";
import { isPlaylist, rewritePlaylist } from "./hls.ts";

const relay = (u: string) => `/api/stream?url=${encodeURIComponent(u)}`;

test("isPlaylist trusts the declared content type", () => {
  assert.equal(isPlaylist("application/vnd.apple.mpegurl", "https://x.tv/a"), true);
  assert.equal(isPlaylist("application/x-mpegURL; charset=utf-8", "https://x.tv/a"), true);
  assert.equal(isPlaylist("video/mp4", "https://x.tv/a.m3u8"), false);
});

test("isPlaylist falls back to the path when the type says nothing useful", () => {
  assert.equal(isPlaylist(null, "https://x.tv/hls/master.m3u8?token=1"), true);
  assert.equal(isPlaylist("application/octet-stream", "https://x.tv/hls/1.m3u8"), true);
  assert.equal(isPlaylist(null, "https://x.tv/video.mp4"), false);
});

test("relative segments resolve against the playlist, not the app", () => {
  const out = rewritePlaylist(
    ["#EXTM3U", "#EXTINF:10,", "seg1.ts", "#EXTINF:10,", "../other/seg2.ts"].join("\n"),
    "https://cdn.x.tv/hls/720/index.m3u8",
    relay,
  );
  assert.match(out, /url=https%3A%2F%2Fcdn\.x\.tv%2Fhls%2F720%2Fseg1\.ts/);
  assert.match(out, /url=https%3A%2F%2Fcdn\.x\.tv%2Fhls%2Fother%2Fseg2\.ts/);
});

test("tag attributes are rewritten too, so keys and maps are not missed", () => {
  const out = rewritePlaylist(
    [
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/en.m3u8"',
    ].join("\n"),
    "https://cdn.x.tv/hls/index.m3u8",
    relay,
  );
  assert.match(out, /URI="\/api\/stream\?url=https%3A%2F%2Fcdn\.x\.tv%2Fhls%2Fkey\.bin"/);
  assert.match(out, /URI="\/api\/stream\?url=https%3A%2F%2Fcdn\.x\.tv%2Fhls%2Finit\.mp4"/);
  assert.match(out, /URI="\/api\/stream\?url=https%3A%2F%2Fcdn\.x\.tv%2Fhls%2Faudio%2Fen\.m3u8"/);
  // IV is not a URI and must survive untouched.
  assert.match(out, /IV=0x00/);
});

test("a data: key is left alone rather than proxied into nonsense", () => {
  const line = '#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA"';
  assert.equal(rewritePlaylist(line, "https://cdn.x.tv/i.m3u8", relay), line);
});

test("directives and comments pass through, and absolute URIs are kept absolute", () => {
  const out = rewritePlaylist(
    ["#EXTM3U", "#EXT-X-VERSION:3", "https://other.cdn/seg.ts", ""].join("\n"),
    "https://cdn.x.tv/i.m3u8",
    relay,
  );
  const lines = out.split("\n");
  assert.equal(lines[0], "#EXTM3U");
  assert.equal(lines[1], "#EXT-X-VERSION:3");
  assert.equal(lines[2], relay("https://other.cdn/seg.ts"));
  assert.equal(lines[3], "");
});

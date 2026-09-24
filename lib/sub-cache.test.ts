import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodeSubBytes, loadSubBody, loadSubIndex, mimeForSub, saveSubIndex, subBodyPath } from "./sub-cache.ts";
import { mediaDir } from "./play-cache.ts";

async function scratch(fn: () => void | Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "lacrima-subs-"));
  process.env.LACRIMA_CACHE = root;
  try {
    await fn();
  } finally {
    rmSync(root, { recursive: true, force: true });
    delete process.env.LACRIMA_CACHE;
  }
}

const ctx = { via: "kitsu" as const, mediaId: 10740, chapterId: "ep-1" };
const cue = {
  id: "en-1",
  lang: "en" as const,
  label: "English · OpenSubtitles",
  url: "https://cdn.example/ep.srt",
  src: "/api/subs/file?url=https%3A%2F%2Fcdn.example%2Fep.srt",
  type: "srt" as const,
};

test("the first find writes an index next to the episode cache", async () => {
  await scratch(() => {
    assert.deepEqual(loadSubIndex(ctx), []);
    saveSubIndex(ctx, [cue]);
    const got = loadSubIndex(ctx);
    assert.equal(got.length, 1);
    assert.equal(got[0].url, cue.url);
    assert.equal(got[0].label, cue.label);
    assert.match(got[0].src, /cv=kitsu/);
    assert.match(got[0].src, /cc=ep-1/);
  });
});

test("a saved body is reused and not overwritten", async () => {
  await scratch(async () => {
    saveSubIndex(ctx, [cue]);
    const dest = subBodyPath(ctx, cue.url);
    writeFileSync(dest, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n");
    const first = await loadSubBody(ctx, cue.url);
    assert.equal(new TextDecoder().decode(first!), "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n");
    writeFileSync(dest, "kept");
    const second = await loadSubBody(ctx, cue.url);
    assert.equal(new TextDecoder().decode(second!), "kept");
    assert.equal(existsSync(dest), true);
  });
});

test("a just-written index is reused; an aged one is fetched again", async () => {
  await scratch(() => {
    saveSubIndex(ctx, [cue]);
    assert.equal(loadSubIndex(ctx).length, 1);
    const file = join(mediaDir(ctx), "subs", "index.json");
    writeFileSync(file, JSON.stringify({ at: Date.now() - 10_000, cues: [cue] }));
    assert.deepEqual(loadSubIndex(ctx, 1_000), []);
    assert.equal(loadSubIndex(ctx, 60_000).length, 1);
  });
});

test("legacy array indexes are stale so a bad first fetch does not stick forever", async () => {
  await scratch(() => {
    saveSubIndex(ctx, [cue]);
    const file = join(mediaDir(ctx), "subs", "index.json");
    writeFileSync(file, JSON.stringify([cue]));
    assert.deepEqual(loadSubIndex(ctx), []);
    writeFileSync(file, JSON.stringify({ at: Date.now() - 48 * 60 * 60 * 1000, cues: [cue] }));
    assert.deepEqual(loadSubIndex(ctx), []);
    writeFileSync(file, JSON.stringify({ at: Date.now(), cues: [cue] }));
    assert.equal(loadSubIndex(ctx)[0]?.url, cue.url);
  });
});

test("embedded: urls are served from disk without an http fetch", async () => {
  await scratch(async () => {
    const url = "embedded:11:22:0.srt";
    const dest = subBodyPath(ctx, url);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, "1\n00:00:01,000 --> 00:00:02,000\nHi\n");
    const buf = await loadSubBody(ctx, url);
    assert.equal(new TextDecoder().decode(buf!), "1\n00:00:01,000 --> 00:00:02,000\nHi\n");
  });
});

test("utf-16 subtitle files decode to text", () => {
  const le = Buffer.from("\ufeff1\n00:00:01,000 --> 00:00:02,000\nHi\n", "utf16le");
  assert.match(decodeSubBytes(le), /Hi/);
  const utf8 = new TextEncoder().encode("Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi");
  assert.match(decodeSubBytes(utf8), /Dialogue:/);
});

test("HTTP subtitle files declare their native text format", () => {
  assert.equal(mimeForSub("https://cdn.example/ep.srt"), "application/x-subrip; charset=utf-8");
  assert.equal(mimeForSub("https://cdn.example/ep.ass"), "text/x-ssa; charset=utf-8");
  assert.equal(mimeForSub("https://cdn.example/ep.vtt"), "text/vtt; charset=utf-8");
});

test("subtitle files go to tmp when media persist is off", async () => {
  const cache = process.env.LACRIMA_CACHE;
  const persist = process.env.LACRIMA_CACHE_PERSIST;
  delete process.env.LACRIMA_CACHE;
  process.env.LACRIMA_CACHE_PERSIST = "0";
  const isolated = { ...ctx, chapterId: `ep-tmp-${Date.now()}` };
  try {
    saveSubIndex(isolated, [cue]);
    const dest = subBodyPath(isolated, cue.url);
    assert.match(dest.replace(/\\/g, "/"), /lacrima-subs/);
    assert.equal(loadSubIndex(isolated)[0]?.url, cue.url);
    writeFileSync(dest, "1\n00:00:01,000 --> 00:00:02,000\nHi\n");
    const buf = await loadSubBody(isolated, cue.url);
    assert.equal(new TextDecoder().decode(buf!), "1\n00:00:01,000 --> 00:00:02,000\nHi\n");
  } finally {
    if (cache) process.env.LACRIMA_CACHE = cache;
    else delete process.env.LACRIMA_CACHE;
    if (persist) process.env.LACRIMA_CACHE_PERSIST = persist;
    else delete process.env.LACRIMA_CACHE_PERSIST;
  }
});

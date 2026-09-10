import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadSubBody, loadSubIndex, saveSubIndex, subBodyPath } from "./sub-cache.ts";
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

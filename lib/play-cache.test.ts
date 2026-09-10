import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { withCacheParams } from "./play-cache-client.ts";
import {
  animeDir,
  boostPlaylist,
  chapterSlug,
  commitPick,
  ensureMediaDir,
  getCachedPick,
  loadPlaylist,
  partPath,
  pickToStreamPick,
  promotePart,
  savePlaylist,
  videoPath,
} from "./play-cache.ts";
import { forLang, type Playlist } from "./streams.ts";

function scratch(fn: () => void) {
  const root = mkdtempSync(join(tmpdir(), "lacrima-cache-"));
  process.env.LACRIMA_CACHE = root;
  try {
    fn();
  } finally {
    rmSync(root, { recursive: true, force: true });
    delete process.env.LACRIMA_CACHE;
  }
}

test("chapter slugs are stable", () => {
  const a = chapterSlug("com.addon::tt1:1:5");
  const b = chapterSlug("com.addon::tt1:1:5");
  assert.equal(a, b);
  assert.notEqual(a, chapterSlug("com.addon::tt1:1:6"));
});

test("commit only lands after an explicit write", () => {
  const root = mkdtempSync(join(tmpdir(), "lacrima-cache-"));
  process.env.LACRIMA_CACHE = root;
  try {
    const ctx = { via: "kitsu" as const, mediaId: 7442, chapterId: "ch-5" };
    assert.equal(getCachedPick("kitsu", 7442, "ch-5"), null);
    commitPick(ctx, "1080p-ja", {
      url: "/api/stream?ih=aa",
      provider: "TorrentClaw",
      hint: "1080p AAC",
    });
    const hit = getCachedPick("kitsu", 7442, "ch-5", "ja");
    assert.equal(hit?.provider, "TorrentClaw");
    assert.equal(hit?.kind, "torrent");
    assert.ok(readFileSync(join(animeDir("kitsu", 7442), "picks.json"), "utf8").includes("TorrentClaw"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    delete process.env.LACRIMA_CACHE;
  }
});

test("cached torrent picks collapse to a single relay url", () => {
  const pick = pickToStreamPick({
    groupId: "1080p-ja",
    url: "/api/stream?ih=aa&ih=bb&i=0&s=1&e=1",
    provider: "TorrentClaw",
    kind: "torrent",
    ih: "aa",
    fileIdx: 0,
    s: 1,
    e: 1,
    committedAt: 1,
  });
  const u = new URL(pick.url, "http://lacrima.local");
  assert.deepEqual(u.searchParams.getAll("ih"), ["aa"]);
  assert.equal(u.searchParams.get("i"), "0");
});

test("withCacheParams tags relay urls", () => {
  const out = withCacheParams("/api/stream?ih=abc", {
    via: "kitsu",
    mediaId: 1,
    chapterId: "x",
  });
  assert.match(out, /cv=kitsu/);
  assert.match(out, /cm=1/);
  assert.match(out, /cc=x/);
});

test("a warm play keeps the whole menu, not just the pick that worked", () => {
  scratch(() => {
    const ctx = { via: "kitsu" as const, mediaId: 7442, chapterId: "ch-5" };
    const pl: Playlist = {
      groups: [
        {
          id: "1080p-ja",
          quality: "1080p",
          lang: "ja",
          label: "1080p · Japanese",
          picks: [
            { url: "/api/stream?ih=slow", provider: "A" },
            { url: "/api/stream?ih=known", provider: "B" },
          ],
        },
        {
          id: "1080p-en",
          quality: "1080p",
          lang: "en",
          label: "1080p · English",
          picks: [{ url: "/api/stream?ih=dub", provider: "C" }],
        },
      ],
      preferred: "1080p-ja",
    };
    savePlaylist(ctx, pl);

    const back = loadPlaylist(ctx);
    assert.equal(back?.groups.length, 2, "both language groups survive a restart");

    commitPick(ctx, "1080p-ja", { url: "/api/stream?ih=known", provider: "B" });
    const pick = getCachedPick("kitsu", 7442, "ch-5", "ja");
    const warm = forLang(boostPlaylist(back!, pick), "ja");
    assert.equal(warm.groups[0].picks[0].url, "/api/stream?ih=known");
    assert.equal(warm.groups.length, 2);

    // Asking for the dub must win over the confirmed Japanese pick.
    const dub = forLang(boostPlaylist(back!, pick), "en");
    assert.equal(dub.preferred, "1080p-en");
    assert.equal(dub.groups[0].lang, "en", "and it leads the menu");
  });
});

test("a partial download is never promoted to the served file", () => {
  scratch(() => {
    const ctx = { via: "kitsu" as const, mediaId: 7442, chapterId: "ch-5" };
    ensureMediaDir(ctx);
    writeFileSync(partPath(ctx), Buffer.alloc(500));

    promotePart(ctx, 4000);
    assert.equal(existsSync(videoPath(ctx)), false, "short of upstream's length");
    assert.equal(existsSync(partPath(ctx)), false, "and the stub is thrown away");

    writeFileSync(partPath(ctx), Buffer.alloc(4000));
    promotePart(ctx, 4000);
    assert.equal(existsSync(videoPath(ctx)), true);

    // No length from upstream means nothing can be verified, so nothing is kept.
    rmSync(videoPath(ctx));
    writeFileSync(partPath(ctx), Buffer.alloc(4000));
    promotePart(ctx, null);
    assert.equal(existsSync(videoPath(ctx)), false);
  });
});

test("boostPlaylist surfaces a known-good pick first", () => {
  const pl = boostPlaylist(
    {
      groups: [
        {
          id: "1080p-ja",
          quality: "1080p",
          lang: "ja",
          label: "1080p · Japanese",
          picks: [
            { url: "/api/stream?ih=slow", provider: "A" },
            { url: "/api/stream?ih=fast", provider: "B" },
          ],
        },
      ],
      preferred: "1080p-ja",
    },
    {
      groupId: "1080p-ja",
      url: "/api/stream?ih=fast",
      provider: "B",
      kind: "torrent",
      committedAt: 1,
    },
  );
  assert.equal(pl.groups[0].picks[0].url, "/api/stream?ih=fast");
});

test("a pick or playlist chosen by superseded rules is not reused", () => {
  scratch(() => {
    const ctx = { via: "kitsu" as const, mediaId: 10740, chapterId: "opm-1" };
    ensureMediaDir(ctx);

    /* Exactly what was on disk for One-Punch Man: a committed pick pointing at
       season three's episode 1, written before the rules that chose it were fixed.
       Nothing expires it, so without a version stamp it replays forever. */
    const picks = join(animeDir("kitsu", 10740), "picks.json");
    writeFileSync(
      picks,
      JSON.stringify({
        [chapterSlug("opm-1")]: {
          "1080p-ja": {
            groupId: "1080p-ja",
            url: "/api/stream?ih=499cbaf7&i=0&s=1&e=1",
            provider: "[HS+] Sootio",
            kind: "torrent",
            committedAt: Date.now(),
          },
        },
      }),
    );
    assert.equal(getCachedPick("kitsu", 10740, "opm-1"), null, "unversioned pick must be dropped");

    const stale: Playlist = {
      groups: [
        {
          id: "1080p-ja",
          quality: "1080p",
          lang: "ja",
          label: "1080p · Japanese",
          picks: [{ url: "/api/stream?ih=499cbaf7", provider: "AniScraper" }],
        },
      ],
      preferred: "1080p-ja",
    };
    writeFileSync(join(animeDir("kitsu", 10740), "media", chapterSlug("opm-1"), "playlist.json"),
      JSON.stringify(stale));
    assert.equal(loadPlaylist(ctx), null, "unversioned playlist must be dropped");

    // A playlist written now carries the stamp and survives.
    savePlaylist(ctx, stale);
    assert.ok(loadPlaylist(ctx));
    commitPick(ctx, "1080p-ja", { url: "/api/stream?ih=beef", provider: "TorrentClaw" });
    assert.equal(getCachedPick("kitsu", 10740, "opm-1")?.ih, "beef");
  });
});

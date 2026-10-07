import assert from "node:assert/strict";
import { test } from "node:test";
import type { Media, MediaKind } from "./media.ts";
import { Ok } from "./result.ts";
import type { SourceInfo, SourceManga } from "./sources/types.ts";

/* resolveSource reads and writes bindings, so this needs a database of its own. */
process.env.LACRIMA_DB = ":memory:";
const { getBinding, setBinding } = await import("./match.ts");
const { bindingForPlayback, pinBinding, resolveSource } = await import("./resolve.ts");
const { BACKENDS } = await import("./sources/index.ts");

const stremio = BACKENDS.anime; // movie and series share it

const src = (over: Partial<SourceInfo> = {}): SourceInfo => ({
  id: "tor", name: "Tor", lang: "all", iconUrl: null, kind: "anime", isLocal: false, ...over,
});
const media = (over: Partial<Media>): Media => ({
  id: 111161, via: "cinemeta", kind: "movie", title: "The Shawshank Redemption", cover: null, banner: null,
  color: null, description: null, genres: [], units: 1, unitLabel: "movie", score: null, imdb: "tt0111161", ...over,
});
const hit: SourceManga = {
  id: "cat::tt0111161", sourceId: "cat", sourceName: "Cat", title: "The Shawshank Redemption", thumbnailUrl: null, chapterCount: 1,
};

/** Installs `sources` as the pool and records what was searched; restores the real backend after. */
async function withSources<T>(sources: SourceInfo[], found: SourceManga[], run: (searched: MediaKind[]) => Promise<T>) {
  const real = [stremio.listSources, stremio.search] as const;
  const searched: MediaKind[] = [];
  stremio.listSources = async () => Ok(sources);
  stremio.search = async (_id, _q, kind) => {
    searched.push(kind ?? "anime");
    return Ok(found);
  };
  try {
    return await run(searched);
  } finally {
    [stremio.listSources, stremio.search] = real;
  }
}

test("with no source installed a movie has no binding: the empty state stays", async () => {
  await withSources([], [], async (searched) => {
    const r = await resolveSource(media({ id: 1 }));
    assert.ok(r.ok);
    assert.equal(r.value.binding, null);
    assert.equal(r.value.tier, "none");
    assert.equal(searched.length, 0);
  });
});

test("a movie with an IMDb id binds without searching, and the binding is not stored", async () => {
  await withSources([src({ types: ["movie", "series"] })], [hit], async (searched) => {
    const r = await resolveSource(media({ id: 2 }));
    assert.ok(r.ok);
    assert.equal(r.value.binding?.source_id, "imdb");
    assert.equal(r.value.binding?.confidence, 1);
    assert.equal(r.value.tier, "confident");
    assert.deepEqual(r.value.candidates, []);
    assert.equal(searched.length, 0);
    assert.equal(getBinding("cinemeta", 2, "movie"), undefined);
  });
});

test("an addon that does not serve the kind leaves the title unbound and is never searched", async () => {
  await withSources([src({ types: ["anime"] })], [hit], async (searched) => {
    const r = await resolveSource(media({ id: 3, kind: "series", imdb: "tt0944947" }));
    assert.ok(r.ok);
    assert.equal(r.value.binding, null);
    assert.equal(r.value.tier, "none");
    assert.equal(searched.length, 0);
  });
});

test("a pinned binding wins over the synthesised one", async () => {
  pinBinding({
    via: "cinemeta", media_id: 4, source_id: "cat", source_title: "The Shawshank Redemption",
    source_manga_id: "cat::tt0111161", confidence: 0.9, backend: "stremio", kind: "movie",
  });
  await withSources([src()], [hit], async (searched) => {
    const r = await resolveSource(media({ id: 4 }));
    assert.ok(r.ok);
    assert.equal(r.value.binding?.source_id, "cat");
    assert.equal(r.value.tier, "confident");
    // Even a deliberate change request keeps the pin.
    const again = await resolveSource(media({ id: 4 }), true);
    assert.ok(again.ok);
    assert.equal(again.value.binding?.source_id, "cat");
    assert.deepEqual(searched, ["movie"]);
  });
});

test("asking to change searches with the kind, offers candidates, and keeps the default unstored", async () => {
  await withSources([src({ types: ["movie"] }), src({ id: "ani", types: ["anime"] })], [hit], async (searched) => {
    const r = await resolveSource(media({ id: 5 }), true);
    assert.ok(r.ok);
    assert.equal(r.value.binding?.source_id, "imdb");
    assert.equal(r.value.candidates.length, 1);
    // One searchable addon (the anime-only one is skipped), searched once per query as a movie.
    assert.ok(searched.length >= 1 && searched.every((k) => k === "movie"));
    assert.equal(getBinding("cinemeta", 5, "movie"), undefined);
  });
});

test("anime is untouched: no synthesised binding, and it is searched as anime", async () => {
  await withSources([src({ types: ["movie"] })], [], async (searched) => {
    const r = await resolveSource(media({ id: 6, via: "kitsu", kind: "anime", title: "Frieren", imdb: "tt22248376" }));
    assert.ok(r.ok);
    assert.equal(r.value.binding, null);
    assert.equal(r.value.tier, "none");
    assert.ok(searched.length >= 1 && searched.every((k) => k === "anime"));
  });
});

/* An earlier build searched movies and stored the winner. That unpinned row must not shadow the IMDb id. */
const stale = (id: number, over: { pinned?: boolean; kind?: "movie" | "anime" } = {}) => {
  const kind = over.kind ?? "movie";
  const b = {
    via: "cinemeta" as const, media_id: id, source_id: "cat", source_title: "The Shawshank Redemption",
    source_manga_id: "cat::tt0111161", confidence: 1, backend: "stremio", kind,
  };
  if (over.pinned) pinBinding(b);
  else setBinding(b);
};

test("a stored unpinned movie binding is outranked by the IMDb one, on the page and in the player", async () => {
  stale(7);
  await withSources([src({ types: ["movie"] })], [hit], async () => {
    const r = await resolveSource(media({ id: 7 }));
    assert.ok(r.ok);
    assert.equal(r.value.binding?.source_id, "imdb");
    assert.equal((await bindingForPlayback(media({ id: 7 })))?.source_id, "imdb");
    // The stale row is left alone (never deleted), just no longer read in preference to the id.
    assert.equal(getBinding("cinemeta", 7, "movie")?.source_id, "cat");
    const again = await resolveSource(media({ id: 7 }), true);
    assert.ok(again.ok);
    assert.equal(again.value.binding?.source_id, "imdb");
  });
});

test("with no addon serving movies the stored unpinned binding still stands", async () => {
  stale(8);
  await withSources([src({ types: ["anime"] })], [], async () => {
    const r = await resolveSource(media({ id: 8 }));
    assert.ok(r.ok);
    assert.equal(r.value.binding?.source_id, "cat");
    assert.equal((await bindingForPlayback(media({ id: 8 })))?.source_id, "cat");
  });
});

test("a pinned movie binding beats the IMDb one for playback too", async () => {
  stale(9, { pinned: true });
  await withSources([src({ types: ["movie"] })], [], async () => {
    assert.equal((await bindingForPlayback(media({ id: 9 })))?.source_id, "cat");
  });
});

test("a movie without an IMDb id keeps its stored binding", async () => {
  stale(10);
  await withSources([src({ types: ["movie"] })], [], async () => {
    const r = await resolveSource(media({ id: 10, imdb: null }));
    assert.ok(r.ok);
    assert.equal(r.value.binding?.source_id, "cat");
    assert.equal((await bindingForPlayback(media({ id: 10, imdb: null })))?.source_id, "cat");
  });
});

test("playback for anime reads only the stored binding", async () => {
  assert.equal(await bindingForPlayback(media({ id: 11, via: "kitsu", kind: "anime" })), null);
});

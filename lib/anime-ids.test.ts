import assert from "node:assert/strict";
import { test } from "node:test";
import { animeIds, nativeIds } from "./anime-ids.ts";

test("each provider mints its own namespace, for free", () => {
  assert.deepEqual(nativeIds("kitsu", 7442), { kitsu: 7442 });
  assert.deepEqual(nativeIds("anilist", 16498), { anilist: 16498 });
  // Jikan *is* MyAnimeList.
  assert.deepEqual(nativeIds("jikan", 16498), { mal: 16498 });
});

test("no id, or an unknown provider, yields no namespaces", () => {
  assert.deepEqual(nativeIds("kitsu", undefined), {});
  assert.deepEqual(nativeIds("kitsu", Number.NaN), {});
  assert.deepEqual(nativeIds("tmdb", 123), {});
  assert.deepEqual(nativeIds(undefined, 7442), {});
});

test("a title with no provider id never reaches the network", async () => {
  /* animeIds must be safe to call unconditionally on the render path: with
     nothing to map, it answers immediately rather than asking ani.zip. */
  const fetched: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((u: string) => {
    fetched.push(String(u));
    return Promise.reject(new Error("should not be called"));
  }) as typeof fetch;
  try {
    assert.deepEqual(await animeIds("kitsu", undefined), {});
    assert.deepEqual(fetched, []);
  } finally {
    globalThis.fetch = real;
  }
});

test("a mapping outage degrades to the id we already hold, never to a failure", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("ani.zip is down"))) as typeof fetch;
  try {
    // Playing must not depend on a third party being up.
    assert.deepEqual(await animeIds("kitsu", 999_001), { kitsu: 999_001 });
  } finally {
    globalThis.fetch = real;
  }
});

test("the id we hold always wins over the one a mapping reports", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ mappings: { kitsu_id: 1, mal_id: 52991, anilist_id: 154587 } }),
      ),
    )) as typeof fetch;
  try {
    const ids = await animeIds("kitsu", 999_002);
    assert.equal(ids.kitsu, 999_002, "our own id must not be overwritten");
    assert.equal(ids.mal, 52991);
    assert.equal(ids.anilist, 154587);
  } finally {
    globalThis.fetch = real;
  }
});

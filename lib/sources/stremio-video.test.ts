import assert from "node:assert/strict";
import { test } from "node:test";
import { json, withFetch } from "../providers/fetch-mock.ts";

/* These go through the real store, so they need a database of their own. */
process.env.LACRIMA_DB = ":memory:";
const { upsertPlugin } = await import("./store.ts");
const { resolveStreams, stremio } = await import("./stremio.ts");
const { imdbBinding } = await import("../resolve.ts");

const TOR = "https://tor.test/manifest.json";
const ANI = "https://ani.test/manifest.json";
const CAT = "https://cat.test/manifest.json";

const search = [{ name: "search" }];
const MANIFESTS: Record<string, unknown> = {
  "tor.test": { id: "tor", name: "Tor", resources: ["stream"], types: ["movie", "series"], idPrefixes: ["tt"] },
  // An anime-only addon that would also accept an IMDb id: it must still not be asked about a film.
  "ani.test": { id: "ani", name: "Ani", resources: ["stream"], types: ["anime"], idPrefixes: ["tt", "kitsu"] },
  "cat.test": {
    id: "cat",
    name: "Cat",
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    catalogs: [
      { type: "movie", id: "top", extra: search },
      { type: "series", id: "top", extra: search },
    ],
  },
};

for (const [id, url, name] of [["tor", TOR, "Tor"], ["ani", ANI, "Ani"], ["cat", CAT, "Cat"]]) {
  upsertPlugin({ id, kind: "anime", repo_url: url, name, lang: "all", version: "1", icon_url: null, plugin_url: url, installed: 1 });
}

const STREAM = { streams: [{ title: "1080p WEB-DL H264 AAC", url: "https://cdn.test/v.mp4" }] };

/** Serves manifests and one stream answer; everything else (ani.zip, the anime addon's streams) is a 599. */
const handler = (url: URL) => {
  if (url.pathname === "/manifest.json") return json(MANIFESTS[url.host]);
  if (url.host === "tor.test" && url.pathname.startsWith("/stream/")) return json(STREAM);
  if (url.host === "cat.test" && url.pathname.startsWith("/catalog/")) return json({ metas: [{ id: "tt0133093", name: "The Matrix" }] });
  return undefined;
};

const asked = (calls: URL[]) => calls.map((u) => `${u.host}${u.pathname}`);

test("a movie is asked for by its bare IMDb id, under the movie type, of addons that serve it", async () => {
  await withFetch(handler, async (calls) => {
    const r = await resolveStreams("imdb::tt0111161", { kind: "movie", via: "cinemeta", mediaId: 111161, title: "The Shawshank Redemption" });
    assert.ok(r.ok, r.ok ? "" : r.reason);
    const streams = asked(calls).filter((c) => c.includes("/stream/"));
    assert.deepEqual(streams, ["tor.test/stream/movie/tt0111161.json"]);
    assert.equal(calls.some((u) => u.host === "api.ani.zip"), false);
  });
});

test("a series episode is asked for as tt:season:episode and never through the anime id mapping", async () => {
  await withFetch(handler, async (calls) => {
    // Hostile on purpose: a Kitsu id here would normally synthesise `kitsu:7442:3` and call ani.zip.
    const r = await resolveStreams("imdb::tt0944947:2:3", { kind: "series", via: "kitsu", mediaId: 7442 });
    assert.ok(r.ok, r.ok ? "" : r.reason);
    assert.deepEqual(
      asked(calls).filter((c) => c.includes("/stream/")),
      ["tor.test/stream/series/tt0944947:2:3.json"],
    );
    assert.equal(calls.some((u) => u.host === "api.ani.zip"), false);
  });
});

test("without a kind the anime path is untouched: the mapping service is still asked", async () => {
  await withFetch(handler, async (calls) => {
    await resolveStreams("imdb::tt0944947:1:1", { via: "kitsu", mediaId: 7443 });
    assert.equal(calls.some((u) => u.host === "api.ani.zip"), true);
  });
});

test("a catalog search for a movie or series reads only that type's catalog", async () => {
  await withFetch(handler, async (calls) => {
    assert.ok((await stremio.search("cat", "matrix", "movie")).ok);
    assert.deepEqual(asked(calls).filter((c) => c.includes("/catalog/")), ["cat.test/catalog/movie/top/search=matrix.json"]);
  });
  await withFetch(handler, async (calls) => {
    assert.ok((await stremio.search("cat", "matrix", "series")).ok);
    assert.deepEqual(asked(calls).filter((c) => c.includes("/catalog/")), ["cat.test/catalog/series/top/search=matrix.json"]);
  });
  await withFetch(handler, async (calls) => {
    await stremio.search("cat", "matrix");
    assert.equal(asked(calls).filter((c) => c.includes("/catalog/")).length, 2);
  });
});

test("listed sources carry what their manifest declared, so a movie only binds to one that serves it", async () => {
  // The resolves above cached every manifest, so the listing can read them without waiting on a fetch.
  const listed = await stremio.listSources();
  assert.ok(listed.ok);
  const by = Object.fromEntries(listed.value.map((s) => [s.id, s]));
  assert.deepEqual(by.tor.types, ["movie", "series"]);
  assert.equal(by.tor.streams, true);
  assert.deepEqual(by.ani.types, ["anime"]);
  assert.equal(by.cat.streams, false);

  const film = { via: "cinemeta" as const, id: 111161, kind: "movie" as const, imdb: "tt0111161", title: "The Shawshank Redemption" };
  assert.equal(imdbBinding(film, listed.value)?.source_id, "imdb");
  // With only the anime-only and catalog-only addons there is no one to ask.
  assert.equal(imdbBinding(film, [by.ani, by.cat]), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { cinemeta, fetchSeriesEpisodes, idToImdb, imdbToId, parseSeriesVideos } from "./cinemeta.ts";
import { json, withFetch } from "./fetch-mock.ts";

// Trimmed from the live /meta/movie/tt0111161.json
const SHAWSHANK = {
  imdb_id: "tt0111161",
  id: "tt0111161",
  name: "The Shawshank Redemption",
  description: "After a banker is sentenced to life in Shawshank Prison, he forms an unlikely friendship.",
  genres: ["Drama"],
  imdbRating: "9.3",
  runtime: "142 min",
  year: "1994",
  poster: "https://images.metahub.space/poster/small/tt0111161/img",
  background: "https://images.metahub.space/background/medium/tt0111161/img",
  videos: [],
};

// Trimmed from the live /meta/series/tt0944947.json: specials are season 0.
const GOT = {
  imdb_id: "tt0944947",
  name: "Game of Thrones",
  genres: ["Drama", "Fantasy"],
  imdbRating: "9.2",
  runtime: "57 min",
  year: "2011–2019",
  poster: "https://images.metahub.space/poster/small/tt0944947/img",
  videos: [
    { name: "Inside Game of Thrones", season: 0, number: 1, episode: 1, released: "2010-12-06T05:00:00.000Z", thumbnail: "https://episodes.metahub.space/tt0944947/0/1/w780.jpg" },
    { name: "Winter Is Coming", season: 1, number: 1, episode: 1, released: "2011-04-17T01:00:00.000Z", thumbnail: "https://episodes.metahub.space/tt0944947/1/1/w780.jpg", overview: "Eddard Stark is torn." },
    { name: "The Kingsroad", season: 1, number: 2, episode: 2, released: "2011-04-24T01:00:00.000Z" },
    { name: "Valar Dohaeris", season: 3, number: 1, episode: 1, released: "2013-03-31T01:00:00.000Z" },
  ],
};

test("imdb id <-> numeric id round-trips, for 7- and 8-digit ids", () => {
  for (const imdb of ["tt0111161", "tt0000001", "tt1375666", "tt10838180", "tt21097264"]) {
    const id = imdbToId(imdb);
    assert.ok(id != null, imdb);
    assert.equal(idToImdb(id), imdb);
  }
  assert.equal(imdbToId("tt0111161"), 111161);
  assert.equal(idToImdb(111161), "tt0111161");
  assert.equal(idToImdb(10838180), "tt10838180");
});

test("anything that isn't an imdb title id yields no id", () => {
  for (const bad of ["", "0111161", "nm0000093", "tt", "tt0", "tt12345678901", "tt01x"]) {
    assert.equal(imdbToId(bad), null, bad);
  }
});

test("parseSeriesVideos sorts by season then episode and drops bad and duplicate entries", () => {
  const eps = parseSeriesVideos([
    { season: 2, episode: 1, name: "B" },
    { season: 1, number: 2, name: "A2" },
    { season: 1, episode: 1, title: "A1", firstAired: "2011-04-17T00:00:00.000Z" },
    { season: 1, episode: 1, name: "duplicate" },
    { season: "x", episode: 1 },
    { season: 1 },
    null,
    "nope",
  ]);
  assert.deepEqual(
    eps.map((e) => [e.season, e.episode, e.title]),
    [[1, 1, "A1"], [1, 2, "A2"], [2, 1, "B"]],
  );
  assert.equal(eps[0].released, "2011-04-17T00:00:00.000Z");
  assert.deepEqual(parseSeriesVideos(undefined), []);
  assert.deepEqual(parseSeriesVideos({}), []);
});

test("a movie maps runtime, rating, year, imdb id and a medium poster", async () => {
  await withFetch(
    (url) => (url.pathname === "/meta/movie/tt0111161.json" ? json({ meta: SHAWSHANK }) : undefined),
    async () => {
      const r = await cinemeta.fetchTitle("movie", 111161);
      assert.ok(r.ok);
      const m = r.value;
      assert.equal(m.via, "cinemeta");
      assert.equal(m.kind, "movie");
      assert.equal(m.id, 111161);
      assert.equal(m.imdb, "tt0111161");
      assert.equal(m.title, "The Shawshank Redemption");
      assert.equal(m.unitMinutes, 142);
      assert.equal(m.score, 93);
      assert.equal(m.year, 1994);
      assert.equal(m.units, 1);
      assert.deepEqual(m.genres, ["Drama"]);
      assert.equal(m.cover, "https://images.metahub.space/poster/medium/tt0111161/img");
      assert.ok(m.banner?.includes("/background/"));
    },
  );
});

test("a series counts episodes outside the specials season, and reads an ongoing year range", async () => {
  await withFetch(
    (url) => (url.pathname === "/meta/series/tt0944947.json" ? json({ meta: GOT }) : undefined),
    async () => {
      const r = await cinemeta.fetchTitle("series", 944947);
      assert.ok(r.ok);
      assert.equal(r.value.kind, "series");
      assert.equal(r.value.units, 3);
      assert.equal(r.value.unitLabel, "episodes");
      assert.equal(r.value.year, 2011);
      assert.equal(r.value.unitMinutes, 57);
    },
  );
});

test("an id Cinemeta doesn't know is an Err, not a blank title", async () => {
  await withFetch(
    () => json({ meta: { id: "tt0000000", type: "movie", behaviorHints: {} } }),
    async () => {
      const r = await cinemeta.fetchTitle("movie", 0);
      assert.equal(r.ok, false);
    },
  );
  await withFetch(
    () => new Response("", { status: 503 }),
    async () => {
      const r = await cinemeta.fetchTitle("movie", 111161);
      assert.ok(!r.ok && r.reason.includes("503"));
    },
  );
});

test("it refuses kinds it doesn't serve without a request", async () => {
  await withFetch(
    () => undefined,
    async (calls) => {
      assert.equal((await cinemeta.fetchTitle("anime", 1)).ok, false);
      assert.deepEqual(calls, []);
    },
  );
});

test("episodes come from the series meta by full imdb id", async () => {
  await withFetch(
    (url) => (url.pathname === "/meta/series/tt0944947.json" ? json({ meta: GOT }) : undefined),
    async () => {
      const r = await fetchSeriesEpisodes("tt0944947");
      assert.ok(r.ok);
      assert.deepEqual(
        r.value.map((e) => `${e.season}x${e.episode}`),
        ["0x1", "1x1", "1x2", "3x1"],
      );
      assert.equal(r.value[1].overview, "Eddard Stark is torn.");
      assert.equal((await fetchSeriesEpisodes("not-an-id")).ok, false);
    },
  );
});

const card = (imdb: string, name: string, genres: string[]) => ({
  id: imdb,
  imdb_id: imdb,
  name,
  genres,
  poster: `https://images.metahub.space/poster/small/${imdb}/img`,
});

test("browse maps Sports to Cinemeta's Sport, pages by skip, and keeps animated series", async () => {
  await withFetch(
    (url) => {
      if (url.pathname.startsWith("/catalog/series/top"))
        return json({
          hasMore: true,
          metas: [card("tt1", "Reality Drama", ["Drama"]), card("tt2", "Cartoon", ["Animation", "Comedy"])],
        });
      if (url.pathname.startsWith("/catalog/series/year")) return json({ metas: [] });
      return undefined;
    },
    async (calls) => {
      const r = await cinemeta.browse("series", "Sports", 2, []);
      assert.ok(r.ok);
      assert.deepEqual(r.value.grid.map((m) => m.title), ["Reality Drama", "Cartoon"]);
      assert.equal(r.value.hasMore, true);
      const top = calls.map((u) => u.pathname).filter((p) => p.includes("/top/"));
      assert.ok(top.every((p) => p.includes("genre=Sport")), top.join());
      assert.ok(top.some((p) => p.includes("skip=50")), top.join());
    },
  );
});

test("a genre Cinemeta can't filter by is an empty page with no request", async () => {
  await withFetch(
    () => undefined,
    async (calls) => {
      const r = await cinemeta.browse("movie", "Slice of Life", 1, []);
      assert.ok(r.ok);
      assert.deepEqual(r.value.grid, []);
      assert.deepEqual(calls, []);
    },
  );
});

test("browse reuses one request for the popular rail and the first grid page", async () => {
  await withFetch(
    (url) => {
      if (url.pathname.includes("/top")) return json({ metas: [card("tt0111161", "A", ["Drama"])] });
      if (url.pathname.includes("/year")) return json({ metas: [card("tt0133093", "B", ["Action"])] });
      return undefined;
    },
    async (calls) => {
      const r = await cinemeta.browse("movie", null, 1, []);
      assert.ok(r.ok);
      assert.equal(calls.length, 2);
      assert.equal(r.value.popular[0].title, "A");
      assert.equal(r.value.recent[0].title, "B");
      assert.equal(r.value.recommended[0].title, "A");
    },
  );
});

test("search fills movies and series; either half failing fails the search", async () => {
  const metas = (imdb: string, name: string) => ({ metas: [{ id: imdb, imdb_id: imdb, name, releaseInfo: "1999", poster: "https://example.test/p.jpg" }] });
  await withFetch(
    (url) =>
      url.pathname.startsWith("/catalog/movie/top/search=")
        ? json(metas("tt0133093", "The Matrix"))
        : url.pathname.startsWith("/catalog/series/top/search=")
          ? json(metas("tt0903747", "Breaking Bad"))
          : undefined,
    async () => {
      const r = await cinemeta.search("matrix");
      assert.ok(r.ok);
      assert.equal(r.value.movies[0].id, 133093);
      assert.equal(r.value.series[0].kind, "series");
      assert.deepEqual(r.value.anime, []);
    },
  );
  await withFetch(
    (url) => (url.pathname.includes("/movie/") ? json({ metas: [] }) : new Response("", { status: 500 })),
    async () => {
      const r = await cinemeta.search("matrix");
      assert.equal(r.ok, false);
    },
  );
});

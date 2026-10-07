import assert from "node:assert/strict";
import { test } from "node:test";
import { dramaCountries, tmdbMovie, tmdbTv } from "./tmdb.ts";
import { json, withFetch, withTmdbKey } from "./fetch-mock.ts";

const V3 = "0123456789abcdef0123456789abcdef";
const V4 = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.sig";

// Trimmed from a real /movie/603 response.
const MATRIX = {
  id: 603,
  imdb_id: "tt0133093",
  title: "The Matrix",
  original_title: "The Matrix",
  overview: "A computer hacker learns about the true nature of reality.",
  poster_path: "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
  backdrop_path: "/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg",
  genres: [
    { id: 28, name: "Action" },
    { id: 878, name: "Science Fiction" },
  ],
  runtime: 136,
  release_date: "1999-03-30",
  vote_average: 8.2,
};

// Trimmed from a real /tv/{id}?append_to_response=external_ids response.
const KDRAMA = {
  id: 95396,
  name: "Crash Landing on You",
  original_name: "사랑의 불시착",
  overview: "A paragliding mishap drops a South Korean heiress in North Korea.",
  poster_path: "/p.jpg",
  backdrop_path: "/b.jpg",
  genres: [
    { id: 10765, name: "Sci-Fi & Fantasy" },
    { id: 18, name: "Drama" },
  ],
  episode_run_time: [],
  number_of_episodes: 16,
  first_air_date: "2019-12-14",
  vote_average: 8.7,
  external_ids: { imdb_id: "tt10850932" },
};

const page = (results: unknown[], total_pages = 3) => json({ page: 1, results, total_pages, total_results: 60 });

test("it is switched off without a key, and on with one", async () => {
  await withTmdbKey(undefined, async () => {
    assert.equal(tmdbMovie.enabled?.(), false);
    assert.equal(tmdbTv.enabled?.(), false);
  });
  await withTmdbKey("   ", async () => assert.equal(tmdbMovie.enabled?.(), false));
  await withTmdbKey(V3, async () => assert.equal(tmdbMovie.enabled?.(), true));
});

test("the two TMDB slugs serve one kind each", () => {
  assert.deepEqual([tmdbMovie.slug, tmdbMovie.kinds], ["tmdb-movie", ["movie"]]);
  assert.deepEqual([tmdbTv.slug, tmdbTv.kinds], ["tmdb-tv", ["series"]]);
});

test("a v3 key rides as api_key; a v4 JWT rides as a Bearer header", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      (url, init) => {
        const h = new Headers(init?.headers);
        assert.equal(url.searchParams.get("api_key"), V3);
        assert.equal(h.get("authorization"), null);
        return json(MATRIX);
      },
      async () => assert.ok((await tmdbMovie.fetchTitle("movie", 603)).ok),
    ),
  );
  await withTmdbKey(V4, () =>
    withFetch(
      (url, init) => {
        const h = new Headers(init?.headers);
        assert.equal(url.searchParams.get("api_key"), null);
        assert.equal(h.get("authorization"), `Bearer ${V4}`);
        return json(MATRIX);
      },
      async () => assert.ok((await tmdbMovie.fetchTitle("movie", 603)).ok),
    ),
  );
});

test("a rejected key says which setting is wrong and never echoes the key", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      () => json({ status_code: 7, status_message: "Invalid API key", success: false }, 401),
      async () => {
        const r = await tmdbMovie.fetchTitle("movie", 603);
        assert.ok(!r.ok);
        assert.ok(r.reason.startsWith("TMDB rejected LACRIMA_TMDB_KEY"), r.reason);
        assert.ok(!r.reason.includes(V3));
        const b = await tmdbTv.browse("series", null, 1, []);
        assert.ok(!b.ok && b.reason.startsWith("TMDB rejected LACRIMA_TMDB_KEY"));
      },
    ),
  );
});

test("without a key a lookup fails clearly and makes no request", async () => {
  await withTmdbKey(undefined, () =>
    withFetch(
      () => undefined,
      async (calls) => {
        const r = await tmdbTv.fetchTitle("series", 1);
        assert.ok(!r.ok && r.reason.includes("LACRIMA_TMDB_KEY"));
        assert.deepEqual(calls, []);
      },
    ),
  );
});

test("a movie maps poster, backdrop, runtime, genres, imdb id and rating", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      (url) => (url.pathname === "/3/movie/603" ? json(MATRIX) : undefined),
      async () => {
        const r = await tmdbMovie.fetchTitle("movie", 603);
        assert.ok(r.ok);
        const m = r.value;
        assert.equal(m.via, "tmdb-movie");
        assert.equal(m.kind, "movie");
        assert.equal(m.id, 603);
        assert.equal(m.imdb, "tt0133093");
        assert.equal(m.cover, "https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg");
        assert.equal(m.banner, "https://image.tmdb.org/t/p/w1280/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg");
        assert.equal(m.unitMinutes, 136);
        assert.equal(m.units, 1);
        assert.equal(m.score, 82);
        assert.equal(m.year, 1999);
        assert.deepEqual(m.genres, ["Action", "Sci-Fi"]);
      },
    ),
  );
});

test("a series takes its imdb id from external_ids and splits TMDB's combined genres", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      (url) =>
        url.pathname === "/3/tv/95396" && url.searchParams.get("append_to_response") === "external_ids"
          ? json(KDRAMA)
          : undefined,
      async () => {
        const r = await tmdbTv.fetchTitle("series", 95396);
        assert.ok(r.ok);
        const m = r.value;
        assert.equal(m.via, "tmdb-tv");
        assert.equal(m.kind, "series");
        assert.equal(m.imdb, "tt10850932");
        assert.equal(m.units, 16);
        assert.equal(m.unitLabel, "episodes");
        assert.equal(m.year, 2019);
        assert.equal(m.unitMinutes, null);
        assert.deepEqual(m.genres, ["Sci-Fi", "Fantasy", "Drama"]);
        assert.deepEqual(m.aliases, ["사랑의 불시착"]);
      },
    ),
  );
});

test("a TMDB 404 is 'no such title', not a crash", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      () => json({ status_code: 34 }, 404),
      async () => {
        const r = await tmdbMovie.fetchTitle("movie", 1);
        assert.ok(!r.ok && r.reason.includes("no title"));
      },
    ),
  );
});

test("the plain Series feed has no country or animation filter", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      (url) => (url.pathname === "/3/discover/tv" ? page([{ id: 1, name: "X", genre_ids: [18, 10759] }]) : undefined),
      async (calls) => {
        const r = await tmdbTv.browse("series", null, 1, []);
        assert.ok(r.ok);
        assert.equal(r.value.popular[0].via, "tmdb-tv");
        assert.equal(r.value.popular[0].kind, "series");
        assert.deepEqual(r.value.popular[0].genres, ["Drama", "Action", "Adventure"]);
        assert.ok(calls.length > 0);
        for (const u of calls) {
          assert.equal(u.searchParams.get("with_origin_country"), null);
          assert.equal(u.searchParams.get("without_genres"), null);
          assert.equal(u.searchParams.get("with_genres"), null);
        }
      },
    ),
  );
});

test("the Drama chip is TMDB's Drama genre, with no country filter", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      (url) => (url.pathname === "/3/discover/tv" ? page([{ id: 1, name: "X" }]) : undefined),
      async (calls) => {
        const r = await tmdbTv.browse("series", "Drama", 1, []);
        assert.ok(r.ok);
        for (const u of calls) {
          assert.equal(u.searchParams.get("with_genres"), "18");
          assert.equal(u.searchParams.get("with_origin_country"), null);
        }
      },
    ),
  );
});

test("the Asian drama chip asks for Asian live action only, and excludes animation", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      (url) => (url.pathname === "/3/discover/tv" ? page([{ id: 1, name: "X", genre_ids: [18] }]) : undefined),
      async (calls) => {
        const r = await tmdbTv.browse("series", "Asian drama", 1, []);
        assert.ok(r.ok);
        assert.equal(r.value.grid.length, 1);
        assert.ok(calls.length > 0);
        for (const u of calls) {
          assert.equal(u.searchParams.get("with_origin_country"), "KR|JP|CN|TW|TH");
          assert.equal(u.searchParams.get("without_genres"), "16");
          assert.equal(u.searchParams.get("with_genres"), null);
          assert.equal(u.searchParams.get("with_keywords"), null);
        }
      },
    ),
  );
  // It is a TV chip; the movie side has no such thing and answers an empty page without a request.
  await withTmdbKey(V3, () =>
    withFetch(
      () => undefined,
      async (calls) => {
        const r = await tmdbMovie.browse("movie", "Asian drama", 1, []);
        assert.ok(r.ok && r.value.grid.length === 0);
        assert.deepEqual(calls, []);
      },
    ),
  );
});

test("LACRIMA_DRAMA_COUNTRIES overrides the list, and garbage falls back to the default", () => {
  assert.deepEqual(dramaCountries("kr, ph|VN"), ["KR", "PH", "VN"]);
  assert.deepEqual(dramaCountries(""), ["KR", "JP", "CN", "TW", "TH"]);
  assert.deepEqual(dramaCountries("Korea,1"), ["KR", "JP", "CN", "TW", "TH"]);
});

test("movie browse doesn't filter by country and pages the grid", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      (url) => (url.pathname === "/3/discover/movie" ? page([{ id: 603, title: "The Matrix", genre_ids: [28, 878] }], 3) : undefined),
      async (calls) => {
        const r = await tmdbMovie.browse("movie", "Action", 2, []);
        assert.ok(r.ok);
        assert.equal(r.value.hasMore, true);
        assert.deepEqual(r.value.grid[0].genres, ["Action", "Sci-Fi"]);
        const grid = calls.find((u) => u.searchParams.get("page") === "2");
        assert.ok(grid);
        for (const u of calls) {
          assert.equal(u.searchParams.get("with_genres"), "28");
          assert.equal(u.searchParams.get("with_origin_country"), null);
        }
      },
    ),
  );
  await withTmdbKey(V3, () =>
    withFetch(
      () => page([{ id: 1, title: "Last" }], 1),
      async () => {
        const r = await tmdbMovie.browse("movie", null, 1, []);
        assert.ok(r.ok && r.value.hasMore === false);
      },
    ),
  );
});

test("genres TMDB has no id for resolve through a keyword, once", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      (url) =>
        url.pathname === "/3/search/keyword"
          ? json({ results: [{ id: 111, name: "sport documentary" }, { id: 6075, name: "sport" }] })
          : url.pathname === "/3/discover/tv"
            ? page([{ id: 1, name: "Sports Drama" }])
            : undefined,
      async (calls) => {
        const r = await tmdbTv.browse("series", "Sports", 1, []);
        assert.ok(r.ok);
        assert.equal(r.value.grid.length, 1);
        const discover = calls.filter((u) => u.pathname === "/3/discover/tv");
        assert.ok(discover.length > 0 && discover.every((u) => u.searchParams.get("with_keywords") === "6075"));
        assert.equal(calls.filter((u) => u.pathname === "/3/search/keyword").length, 1);
      },
    ),
  );
});

test("a genre TMDB can't filter by is an empty page, not an unfiltered list", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      () => undefined,
      async (calls) => {
        const r = await tmdbTv.browse("series", "Slice of Life", 1, []);
        assert.ok(r.ok && r.value.grid.length === 0 && r.value.hasMore === false);
        assert.deepEqual(calls, []);
      },
    ),
  );
});

test("series and movie search both keep animation", async () => {
  await withTmdbKey(V3, () =>
    withFetch(
      (url) =>
        url.pathname === "/3/search/tv"
          ? page([
              { id: 1, name: "Live action", genre_ids: [18] },
              { id: 2, name: "Cartoon", genre_ids: [16, 35] },
            ])
          : url.pathname === "/3/search/movie"
            ? page([{ id: 3, title: "Toy Story", genre_ids: [16] }])
            : undefined,
      async () => {
        const tv = await tmdbTv.search("x");
        assert.ok(tv.ok);
        assert.deepEqual(tv.value.series.map((m) => m.title), ["Live action", "Cartoon"]);
        assert.deepEqual(tv.value.movies, []);
        const mv = await tmdbMovie.search("x");
        assert.ok(mv.ok);
        assert.deepEqual(mv.value.movies.map((m) => m.title), ["Toy Story"]);
        assert.deepEqual(mv.value.series, []);
      },
    ),
  );
});

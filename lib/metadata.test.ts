import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  browseGenres,
  chain,
  fetchBrowse,
  fetchHome,
  fetchSearch,
  fetchTitle,
  parseTitleRoute,
  providersFor,
  resetMetadataCache,
  walk,
} from "./metadata.ts";
import { Err, Ok } from "./result.ts";
import type { HomeData, Media, Provider, SearchData } from "./media.ts";
import { fetchSeries, collapseSeries } from "./series.ts";
import { json, withFetch, withTmdbKey } from "./providers/fetch-mock.ts";

const EMPTY: HomeData = {
  hero: null,
  popularAnime: [],
  popularManga: [],
  novels: [],
  forYou: [],
};

const EMPTY_SEARCH: SearchData = { anime: [], manga: [], novels: [], movies: [], series: [] };

const stub: Omit<Provider, "name" | "fetchHome"> = {
  slug: "kitsu",
  kinds: ["anime", "manga", "novel"],
  fetchTitle: async () => Err("unused"),
  search: async () => Err("unused"),
  browse: async () => Err("unused"),
};

const good = (name: string): Provider => ({
  ...stub,
  name,
  fetchHome: async () => Ok(EMPTY),
  search: async () => Ok(EMPTY_SEARCH),
});

const bad = (name: string, why = "down"): Provider => ({
  ...stub,
  name,
  fetchHome: async () => Err(why),
  search: async () => Err(why),
});

test("first healthy provider serves, and is not marked degraded", async () => {
  const r = await chain([good("A"), good("B")], "Adventure");
  assert.ok(r.ok);
  assert.equal(r.value.via, "A");
  assert.equal(r.value.degraded, false);
});

test("falls through to the next provider and flags it as degraded", async () => {
  const r = await chain([bad("A"), good("B")], "Adventure");
  assert.ok(r.ok);
  assert.equal(r.value.via, "B");
  assert.equal(r.value.degraded, true);
});

test("total failure is an Err naming every provider, never an empty success", async () => {
  const r = await chain([bad("A", "403"), bad("B", "504")], "Adventure");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason.includes("A: 403"));
  assert.ok(!r.ok && r.reason.includes("B: 504"));
});

test("no providers configured fails loudly rather than returning empty rows", async () => {
  const r = await chain([], "Adventure");
  assert.equal(r.ok, false);
});

test("search uses the same fallback chain as home", async () => {
  const r = await walk([bad("A"), good("B")], (p) => p.search("frieren"));
  assert.ok(r.ok);
  assert.equal(r.value.via, "B");
  assert.equal(r.value.degraded, true);
});

beforeEach(resetMetadataCache);

const KEY = "0123456789abcdef0123456789abcdef";
const slugs = (kind: Parameters<typeof providersFor>[0]) => providersFor(kind).map((p) => p.slug);
const down = (hosts: string[]) => (u: URL) =>
  hosts.includes(u.hostname) ? new Response("", { status: 500 }) : undefined;
const ANIME_HOSTS = ["graphql.anilist.co", "api.jikan.moe", "kitsu.app"];
const first = (...hs: ((u: URL) => Response | undefined)[]) => (u: URL) => {
  for (const h of hs) {
    const r = h(u);
    if (r) return r;
  }
  return undefined;
};

const card = (imdb: string, name: string) => ({
  id: imdb,
  imdb_id: imdb,
  name,
  genres: ["Drama"],
  poster: `https://images.metahub.space/poster/small/${imdb}/img`,
});
const cinemeta = (u: URL) => {
  if (u.hostname !== "v3-cinemeta.strem.io") return undefined;
  const series = u.pathname.includes("/series/");
  const metas = [card(series ? "tt0903747" : "tt0111161", series ? "Breaking Bad" : "The Shawshank Redemption")];
  return json({ metas, hasMore: false });
};
const tmdbDown = (u: URL) => (u.hostname === "api.themoviedb.org" ? new Response("", { status: 500 }) : undefined);
const tmdbMovies = (u: URL) =>
  u.hostname === "api.themoviedb.org"
    ? json({ results: [{ id: 603, title: "The Matrix", genre_ids: [28] }], total_pages: 1 })
    : undefined;
const anilistEmpty = (u: URL) => {
  if (u.hostname !== "graphql.anilist.co") return undefined;
  const none = { media: [] };
  return json({
    data: { heroRow: none, popularAnime: none, popularManga: none, novels: none, forYou: none, anime: none, manga: none },
  });
};

test("providersFor keeps the anime-family order for anime, manga and novels", () => {
  for (const kind of ["anime", "manga", "novel"] as const) {
    assert.deepEqual(slugs(kind), ["anilist", "jikan", "kitsu"]);
  }
});

test("providersFor leaves TMDB out without a key and puts it first with one", async () => {
  await withTmdbKey(undefined, async () => {
    assert.deepEqual(slugs("movie"), ["cinemeta"]);
    assert.deepEqual(slugs("series"), ["cinemeta"]);
  });
  await withTmdbKey(KEY, async () => {
    assert.deepEqual(slugs("movie"), ["tmdb-movie", "cinemeta"]);
    assert.deepEqual(slugs("series"), ["tmdb-tv", "cinemeta"]);
  });
});

test("Series offers Drama always, and Asian drama only while TMDB is on", async () => {
  await withTmdbKey(undefined, async () => {
    const chips = browseGenres("series");
    assert.equal(chips[0], "Drama");
    assert.ok(!chips.includes("Asian drama"));
  });
  await withTmdbKey(KEY, async () => {
    const chips = browseGenres("series");
    assert.deepEqual(chips.slice(0, 3), ["Drama", "Asian drama", "Action"]);
    assert.equal(chips.filter((g) => g === "Drama").length, 1);
    // No other category grows a country chip.
    assert.ok(!browseGenres("movie").includes("Asian drama"));
    assert.ok(!browseGenres("anime").includes("Asian drama"));
  });
});

test("providersFor drops anything that reports itself disabled", () => {
  const on = { ...stub, name: "On" };
  const off = { ...stub, name: "Off", enabled: () => false };
  assert.deepEqual(providersFor("anime", [off, on]).map((p) => p.name), ["On"]);
  assert.deepEqual(providersFor("movie", [on]), []);
});

test("unkeyed, Cinemeta is the chain head: not degraded, and TMDB is never contacted", async () => {
  await withTmdbKey(undefined, () =>
    withFetch(first(cinemeta, tmdbDown), async (calls) => {
      const r = await fetchBrowse("movie", null, 1, []);
      assert.ok(r.ok);
      assert.equal(r.value.via, "Cinemeta");
      assert.equal(r.value.degraded, false);
      assert.equal(r.value.data.grid[0].via, "cinemeta");
      assert.ok(!calls.some((u) => u.hostname === "api.themoviedb.org"));
    }),
  );
});

test("keyed and healthy, TMDB leads without being flagged", async () => {
  await withTmdbKey(KEY, () =>
    withFetch(first(tmdbMovies, cinemeta), async () => {
      const r = await fetchBrowse("movie", null, 1, []);
      assert.ok(r.ok);
      assert.equal(r.value.via, "TMDB");
      assert.equal(r.value.degraded, false);
      assert.equal(r.value.data.grid[0].via, "tmdb-movie");
    }),
  );
});

test("keyed but failing, TMDB falls through to Cinemeta flagged degraded", async () => {
  await withTmdbKey(KEY, () =>
    withFetch(first(tmdbDown, cinemeta), async () => {
      const r = await fetchBrowse("series", null, 1, []);
      assert.ok(r.ok);
      assert.equal(r.value.via, "Cinemeta");
      assert.equal(r.value.degraded, true);
    }),
  );
});

test("an invalid key degrades to Cinemeta too, rather than emptying the page", async () => {
  await withTmdbKey(KEY, () =>
    withFetch(
      first((u) => (u.hostname === "api.themoviedb.org" ? json({ status_code: 7 }, 401) : undefined), cinemeta),
      async () => {
        const r = await fetchBrowse("movie", null, 1, []);
        assert.ok(r.ok && r.value.degraded && r.value.via === "Cinemeta");
      },
    ),
  );
});

test("every video provider failing is an Err naming each, never an empty success", async () => {
  await withTmdbKey(KEY, () =>
    withFetch(down(["api.themoviedb.org", "v3-cinemeta.strem.io"]), async () => {
      const r = await fetchBrowse("movie", null, 1, []);
      assert.ok(!r.ok);
      assert.ok(r.reason.includes("TMDB:") && r.reason.includes("Cinemeta:"), r.reason);
    }),
  );
});

test("search with one chain dead is served and names the dead kinds in failed", async () => {
  await withTmdbKey(undefined, () =>
    withFetch(first(down(ANIME_HOSTS), cinemeta), async () => {
      const r = await fetchSearch("breaking");
      assert.ok(r.ok);
      assert.deepEqual(r.value.failed, ["anime", "manga", "novel"]);
      assert.equal(r.value.data.movies[0]?.title, "The Shawshank Redemption");
      assert.equal(r.value.data.series[0]?.title, "Breaking Bad");
      // The banner would name a stand-in provider; nothing stood in here.
      assert.equal(r.value.degraded, false);
    }),
  );
  await withTmdbKey(undefined, () =>
    withFetch(first(anilistEmpty, down(["v3-cinemeta.strem.io"])), async () => {
      const r = await fetchSearch("breaking");
      assert.ok(r.ok);
      assert.deepEqual(r.value.failed, ["movie", "series"]);
      assert.deepEqual(r.value.data.anime, []);
    }),
  );
});

test("search with every chain dead is an Err", async () => {
  await withTmdbKey(undefined, () =>
    withFetch(down([...ANIME_HOSTS, "v3-cinemeta.strem.io"]), async () => {
      const r = await fetchSearch("breaking");
      assert.ok(!r.ok);
    }),
  );
});

test("search only walks the chains of the kinds asked for", async () => {
  await withTmdbKey(undefined, () =>
    withFetch(cinemeta, async (calls) => {
      const r = await fetchSearch("breaking", ["movie"]);
      assert.ok(r.ok);
      assert.equal(r.value.failed, undefined);
      assert.deepEqual(r.value.data.series, []);
      assert.ok(calls.length > 0 && calls.every((u) => u.hostname === "v3-cinemeta.strem.io"));
    }),
  );
});

test("home keeps the anime feed and adds movie and series rails from their own chains", async () => {
  await withTmdbKey(undefined, () =>
    withFetch(first(anilistEmpty, cinemeta), async () => {
      const r = await fetchHome("Adventure");
      assert.ok(r.ok);
      assert.equal(r.value.via, "AniList");
      assert.equal(r.value.data.popularMovies[0]?.title, "The Shawshank Redemption");
      assert.equal(r.value.data.popularSeries[0]?.title, "Breaking Bad");
      assert.equal(r.value.failed, undefined);
    }),
  );
});

test("hidden categories are never requested: no movie search, no anime feed, no dead-feed failure", async () => {
  await withTmdbKey(undefined, () =>
    withFetch(cinemeta, async (calls) => {
      const s = await fetchSearch("breaking", ["series"]);
      assert.ok(s.ok);
      assert.ok(calls.length > 0 && calls.every((u) => u.pathname.includes("/series/")));
    }),
  );
  // Only series visible: the anime-family feed is skipped, even with every anime host down.
  await withTmdbKey(undefined, () =>
    withFetch(first(down(ANIME_HOSTS), cinemeta), async (calls) => {
      const r = await fetchHome("Adventure", ["series"], false);
      assert.ok(r.ok);
      assert.equal(r.value.degraded, false);
      assert.equal(r.value.data.popularSeries[0]?.title, "Breaking Bad");
      assert.deepEqual(r.value.data.popularMovies, []);
      assert.ok(calls.length > 0 && calls.every((u) => u.hostname === "v3-cinemeta.strem.io" && u.pathname.includes("/series/")));
    }),
  );
});

test("with no feed, every requested rail dying is an Err, not an empty Home", async () => {
  await withTmdbKey(undefined, () =>
    withFetch(down(["v3-cinemeta.strem.io"]), async () => {
      const r = await fetchHome("Adventure", ["movie", "series"], false);
      assert.ok(!r.ok);
    }),
  );
});

test("a dead video chain never takes Home down, it just says so", async () => {
  await withTmdbKey(undefined, () =>
    withFetch(first(anilistEmpty, down(["v3-cinemeta.strem.io"])), async () => {
      const r = await fetchHome("Comedy");
      assert.ok(r.ok);
      assert.deepEqual(r.value.failed, ["movie", "series"]);
      assert.deepEqual(r.value.data.popularMovies, []);
    }),
  );
});

test("Home with AniList down is still served by Kitsu, flagged degraded", async () => {
  const kitsu = (u: URL) =>
    u.hostname === "kitsu.app"
      ? json({ data: [{ id: "7442", attributes: { canonicalTitle: "Attack on Titan", posterImage: { large: "https://x/p.jpg" } } }] })
      : undefined;
  await withTmdbKey(undefined, () =>
    withFetch(first(down(["graphql.anilist.co", "api.jikan.moe"]), kitsu, cinemeta), async () => {
      const r = await fetchHome("Sports", []);
      assert.ok(r.ok);
      assert.equal(r.value.degraded, true);
      assert.equal(r.value.data.popularAnime[0]?.via, "kitsu");
      assert.deepEqual(r.value.data.popularMovies, []);
    }),
  );
});

test("fetchTitle rejects a (provider, kind) pair the provider doesn't serve, without a request", async () => {
  await withFetch(
    () => undefined,
    async (calls) => {
      for (const [via, kind] of [
        ["cinemeta", "anime"],
        ["kitsu", "movie"],
        ["anilist", "series"],
        ["tmdb-movie", "series"],
        ["tmdb-tv", "movie"],
      ] as const) {
        const r = await fetchTitle(via, kind, 1);
        assert.ok(!r.ok && r.reason.includes("does not serve"), `${via}/${kind}`);
      }
      assert.deepEqual(calls, []);
    },
  );
});

test("fetchSeries is empty, without any network, for movies, dramas and the video providers", async () => {
  await withFetch(
    () => undefined,
    async (calls) => {
      for (const [via, kind, id] of [
        ["cinemeta", "movie", 111161],
        ["cinemeta", "series", 944947],
        ["tmdb-movie", "movie", 603],
        ["tmdb-tv", "series", 95396],
        ["kitsu", "movie", 1],
        ["cinemeta", "anime", 1],
      ] as const) {
        const r = await fetchSeries(via, kind, id);
        assert.ok(r.ok, `${via}/${kind}`);
        assert.deepEqual(r.value, { rootId: id, title: "", parts: [], specials: [] });
      }
      assert.deepEqual(calls, []);
    },
  );
});

test("collapseSeries folds anime parts but leaves movie and series titles alone", () => {
  const media = (title: string, kind: "anime" | "movie" | "series", id: number) =>
    ({
      id,
      via: kind === "anime" ? "kitsu" : "cinemeta",
      kind,
      title,
      cover: null,
      banner: null,
      color: null,
      description: null,
      genres: [],
      units: null,
      unitLabel: "",
      score: null,
    }) as Media;
  const out = collapseSeries([
    media("Frieren", "anime", 1),
    media("Frieren Season 2", "anime", 2),
    media("Dune: Part Two", "movie", 3),
    media("Dune", "movie", 4),
    media("Joker (2019)", "movie", 5),
    media("The Office Season 2", "series", 6),
  ]);
  assert.deepEqual(out.map((m) => m.title), ["Frieren", "Dune: Part Two", "Dune", "Joker (2019)", "The Office Season 2"]);
});

test("parseTitleRoute accepts only a provider that serves the kind and a positive integer id", () => {
  assert.deepEqual(parseTitleRoute("cinemeta", "movie", "111161"), { via: "cinemeta", kind: "movie", id: 111161 });
  assert.deepEqual(parseTitleRoute("cinemeta", "series", "903747"), { via: "cinemeta", kind: "series", id: 903747 });
  assert.deepEqual(parseTitleRoute("kitsu", "anime", "1"), { via: "kitsu", kind: "anime", id: 1 });
  assert.equal(parseTitleRoute("kitsu", "movie", "1"), null);
  assert.equal(parseTitleRoute("tmdb-movie", "series", "1"), null);
  assert.equal(parseTitleRoute("tmdb-tv", "movie", "1"), null);
  assert.equal(parseTitleRoute("nope", "anime", "1"), null);
  assert.equal(parseTitleRoute("kitsu", "books", "1"), null);
  for (const id of ["0", "-3", "1.5", "abc", "", "1e3", "99999999999999999999"]) {
    assert.equal(parseTitleRoute("kitsu", "anime", id), null, id);
  }
});

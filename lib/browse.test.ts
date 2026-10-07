import assert from "node:assert/strict";
import { test } from "node:test";
import { gateHome, homeNeeds, keepKinds, kindList, navEntries, pickHero, sameTitles, searchGroups, sourceSummary } from "./browse.ts";
import { visibleKinds } from "./kinds.ts";
import { MEDIA_KINDS, type HomePage, type Media, type SearchData } from "./media.ts";

const m = (id: number, kind: Media["kind"], over: Partial<Media> = {}): Media => ({
  id,
  via: "kitsu",
  kind,
  title: `t${id}`,
  cover: `c${id}`,
  banner: null,
  color: null,
  description: null,
  genres: [],
  units: null,
  unitLabel: "",
  score: null,
  ...over,
});

const home = (over: Partial<HomePage> = {}): HomePage => ({
  hero: null,
  popularAnime: [],
  popularManga: [],
  novels: [],
  forYou: [],
  popularMovies: [],
  popularSeries: [],
  ...over,
});

test("nav is Home, the five categories in order, Yours - and drops hidden ones", () => {
  assert.deepEqual(
    navEntries().map((e) => e.label),
    ["Home", "Anime", "Manga", "Novels", "Movies", "Series", "Yours"],
  );
  assert.deepEqual(
    navEntries().map((e) => e.href),
    ["/", "/anime", "/manga", "/novels", "/movies", "/series", "/yours"],
  );
  assert.deepEqual(
    navEntries(["series", "anime"]).map((e) => e.label),
    ["Home", "Anime", "Series", "Yours"],
  );
});

test("search groups follow the nav order, one per visible kind, empty ones included", () => {
  const data: SearchData = { anime: [m(1, "anime")], manga: [], novels: [], movies: [m(2, "movie")], series: [] };
  const all = searchGroups(data);
  assert.deepEqual(
    all.map((g) => g.title),
    ["Anime", "Manga", "Novels", "Movies", "Series"],
  );
  assert.equal(all[3].items[0].id, 2);
  assert.deepEqual(
    searchGroups(data, ["movie"]).map((g) => g.kind),
    ["movie"],
  );
});

test("kindList reads as a sentence", () => {
  assert.equal(kindList(["movie"]), "Movies");
  assert.equal(kindList(["movie", "series"]), "Movies and series");
  assert.equal(kindList(["anime", "manga", "novel"]), "Anime, manga and novels");
  assert.equal(kindList([]), "");
});

test("hero: the feed's own wins, else the first rail with art, honouring hidden kinds", () => {
  const hero = m(1, "anime", { banner: "b" });
  assert.equal(pickHero(home({ hero }))?.id, 1);
  const rails = home({
    popularMovies: [m(5, "movie", { cover: null }), m(6, "movie")],
    popularSeries: [m(7, "series")],
    popularManga: [m(8, "manga")],
  });
  assert.equal(pickHero(rails)?.id, 6);
  assert.equal(pickHero(rails, ["series", "manga"])?.id, 7);
  assert.equal(pickHero(rails, ["manga"])?.id, 8);
  assert.equal(pickHero(home({ hero }), ["movie"]), null);
  assert.equal(pickHero(home()), null);
});

test("home asks only for what is visible: hiding movies drops its rail, hiding the whole feed drops the feed", () => {
  assert.deepEqual(homeNeeds([...MEDIA_KINDS]), { feed: true, rails: ["movie", "series"] });
  assert.deepEqual(homeNeeds(visibleKinds(["movie"])), { feed: true, rails: ["series"] });
  assert.deepEqual(homeNeeds(["movie", "series"]), { feed: false, rails: ["movie", "series"] });
  assert.deepEqual(homeNeeds(["manga"]), { feed: true, rails: [] });
  // Hiding all five falls back to everything, so Home never has nothing to ask for.
  assert.deepEqual(homeNeeds(visibleKinds([...MEDIA_KINDS])), { feed: true, rails: ["movie", "series"] });
});

test("gateHome empties hidden rails and a hidden hero, leaves the rest alone", () => {
  const data = home({
    hero: m(1, "anime", { banner: "b" }),
    popularAnime: [m(1, "anime")],
    forYou: [m(2, "anime")],
    popularManga: [m(3, "manga")],
    novels: [m(4, "novel")],
    popularMovies: [m(5, "movie")],
    popularSeries: [m(6, "series")],
  });
  assert.deepEqual(gateHome(data, [...MEDIA_KINDS]), data);
  const noMovies = gateHome(data, visibleKinds(["movie"]));
  assert.deepEqual(noMovies.popularMovies, []);
  assert.equal(noMovies.popularSeries.length, 1);
  assert.equal(noMovies.hero?.id, 1);
  const noAnime = gateHome(data, visibleKinds(["anime"]));
  assert.deepEqual([noAnime.popularAnime, noAnime.forYou], [[], []]);
  assert.equal(noAnime.hero, null);
  // The hero then falls back to the first visible rail with art.
  assert.equal(pickHero(noAnime, visibleKinds(["anime"]))?.id, 5);
});

test("keepKinds filters rows by kind and never mutates", () => {
  const rows = [m(1, "manga"), m(2, "movie"), m(3, "anime")];
  assert.deepEqual(keepKinds(rows, visibleKinds(["movie"])).map((r) => r.id), [1, 3]);
  assert.equal(keepKinds(rows, [...MEDIA_KINDS]).length, 3);
  assert.equal(rows.length, 3);
});

test("source chip counts every video kind as video", () => {
  assert.equal(sourceSummary(["manga", "manga", "anime", "anime", "anime", "novel"]), "2 manga · 3 video · 1 novels");
  assert.equal(sourceSummary(["anime", "movie", "series"]), "3 video");
  assert.equal(sourceSummary([]), "");
});

test("sameTitles spots a recommended rail that is just the popular one", () => {
  const a = [m(1, "movie"), m(2, "movie")];
  assert.equal(sameTitles(a, [m(1, "movie"), m(2, "movie")]), true);
  assert.equal(sameTitles(a, [m(2, "movie"), m(1, "movie")]), false);
  assert.equal(sameTitles(a, [m(1, "movie"), m(2, "movie", { via: "cinemeta" })]), false);
  assert.equal(sameTitles([], []), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { isProviderSlug, MEDIA_KINDS, PROVIDER_SLUGS } from "./media.ts";
import { ASIAN_DRAMA, isVideoKind, KIND_INFO, normalizeHidden, parseHidden, parseKind, toggleKind, visibleKinds } from "./kinds.ts";

test("parseKind accepts the five kinds and nothing else", () => {
  for (const k of ["anime", "manga", "novel", "movie", "series"]) assert.equal(parseKind(k), k);
  assert.equal(MEDIA_KINDS.length, 5);
  for (const bad of ["book", "movies", "Anime", "", " anime", null, undefined, 3, ["anime"]]) {
    assert.equal(parseKind(bad), null, String(bad));
  }
});

test("KIND_INFO covers every kind with a distinct route and label", () => {
  assert.deepEqual(Object.keys(KIND_INFO).sort(), [...MEDIA_KINDS].sort());
  assert.equal(new Set(MEDIA_KINDS.map((k) => KIND_INFO[k].route)).size, MEDIA_KINDS.length);
  assert.equal(new Set(MEDIA_KINDS.map((k) => KIND_INFO[k].label)).size, MEDIA_KINDS.length);
  for (const k of MEDIA_KINDS) {
    assert.ok(KIND_INFO[k].route.startsWith("/"), k);
    assert.ok(KIND_INFO[k].genres.length > 0, k);
  }
  // Live action drops the genres that only make sense for anime and manga.
  assert.ok(!KIND_INFO.movie.genres.includes("Slice of Life"));
  assert.ok(KIND_INFO.anime.genres.includes("Slice of Life"));
});

test("Series is the show category, with Drama as its first chip", () => {
  assert.deepEqual(
    [KIND_INFO.series.label, KIND_INFO.series.route, KIND_INFO.series.unitWord, KIND_INFO.series.video],
    ["Series", "/series", "episode", true],
  );
  assert.equal(KIND_INFO.series.genres[0], "Drama");
  assert.equal(KIND_INFO.series.genres.filter((g) => g === "Drama").length, 1);
  // The country chip is not a static genre: it appears only while TMDB is on (see browseGenres).
  assert.ok(!KIND_INFO.series.genres.includes(ASIAN_DRAMA));
});

test("the retired drama kind is an alias for series wherever a kind is parsed", () => {
  assert.equal(parseKind("drama"), "series");
  assert.equal(isVideoKind("drama"), true);
  assert.deepEqual(parseHidden("drama"), ["series"]);
  assert.deepEqual(parseHidden("anime,drama"), ["anime", "series"]);
  assert.deepEqual(parseHidden(["drama", "series", "movie"]), ["movie", "series"]);
  assert.equal(parseKind("Drama"), null);
  assert.equal(parseKind("dramas"), null);
});

test("video kinds are the ones watched, and only anime has a franchise graph among them", () => {
  assert.deepEqual(MEDIA_KINDS.filter(isVideoKind), ["anime", "movie", "series"]);
  assert.equal(isVideoKind("book"), false);
  assert.deepEqual(MEDIA_KINDS.filter((k) => KIND_INFO[k].franchise), ["anime", "manga", "novel"]);
});

test("provider slugs include the video providers and reject lookalikes", () => {
  for (const s of PROVIDER_SLUGS) assert.equal(isProviderSlug(s), true);
  for (const s of ["tmdb-movie", "tmdb-tv", "cinemeta", "anilist", "jikan", "kitsu"]) assert.equal(isProviderSlug(s), true);
  for (const bad of ["tmdb", "imdb", "", null, undefined, 7]) assert.equal(isProviderSlug(bad), false);
});

test("parseHidden reads a comma list or an array and rejects unknown kinds", () => {
  assert.deepEqual(parseHidden(""), []);
  assert.deepEqual(parseHidden([]), []);
  assert.deepEqual(parseHidden("movie,drama"), ["movie", "series"]);
  assert.deepEqual(parseHidden(["series", "movie", "movie"]), ["movie", "series"]);
  assert.equal(parseHidden("movie,podcast"), null);
  assert.equal(parseHidden(["movie", 3]), null);
  assert.equal(parseHidden(null), null);
  assert.equal(parseHidden({}), null);
});

test("hiding every category is never stored; the read side falls back to all", () => {
  assert.deepEqual(normalizeHidden([...MEDIA_KINDS]), []);
  assert.deepEqual(parseHidden([...MEDIA_KINDS]), []);
  assert.deepEqual(normalizeHidden(["series", "anime", "anime"]), ["anime", "series"]);
  assert.deepEqual(visibleKinds([]), [...MEDIA_KINDS]);
  assert.deepEqual(visibleKinds(["movie", "series"]), ["anime", "manga", "novel"]);
  assert.deepEqual(visibleKinds([...MEDIA_KINDS]), [...MEDIA_KINDS]);
});

test("toggleKind flips one category, in nav order, and never hides the last visible one", () => {
  assert.deepEqual(toggleKind([], "movie"), ["movie"]);
  assert.deepEqual(toggleKind(["movie"], "anime"), ["anime", "movie"]);
  assert.deepEqual(toggleKind(["anime", "movie"], "movie"), ["anime"]);
  const allButManga = MEDIA_KINDS.filter((k) => k !== "manga");
  assert.deepEqual(toggleKind(allButManga, "manga"), allButManga, "last visible stays visible");
  assert.deepEqual(toggleKind(allButManga, "anime"), MEDIA_KINDS.filter((k) => k !== "manga" && k !== "anime"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIDENT, WEAK, confidence, countScore, dismissWeak, normalize, rank, searchTitles, titleScore, weakDismissKey, weakDismissed } from "./match.ts";
import type { SourceManga } from "./sources/types.ts";

const m = (title: string, chapterCount: number | null): SourceManga => ({
  id: "1",
  sourceId: "s",
  sourceName: "S",
  title,
  thumbnailUrl: null,
  chapterCount,
});

test("normalize strips punctuation, diacritics and filler words", () => {
  assert.equal(normalize("The Apothecary Diaries!"), "apothecary diaries");
  assert.equal(normalize("Sōsō no Furīren"), "soso no furiren");
});

test("titles that differ only by subtitle still score high", () => {
  assert.ok(titleScore("Frieren", "Frieren: Beyond Journey's End") >= 0.85);
});

test("unrelated titles score low", () => {
  assert.ok(titleScore("Berserk", "One Piece") < 0.2);
});

test("count agreement is scored independently and tolerates small drift", () => {
  assert.equal(countScore(200, 200), 1);
  assert.equal(countScore(200, 196), 1);
  assert.equal(countScore(200, 12), 0);
  assert.equal(countScore(null, 12), null, "unknown counts must not be scored");
});

// The rule from CLAUDE.md, encoded as a test.
test("exact title with wildly wrong chapter count is NOT confident", () => {
  const c = confidence("Vinland Saga", 12, "Vinland Saga", 200);
  assert.ok(c < CONFIDENT, `expected weak, got ${c}`);
});

test("fuzzy title with matching chapter count beats exact title with wrong count", () => {
  const fuzzyRight = confidence("Vinland Saga: Slave Arc", 200, "Vinland Saga", 200);
  const exactWrong = confidence("Vinland Saga", 12, "Vinland Saga", 200);
  assert.ok(fuzzyRight > exactWrong);
});

test("title-only matches are capped below certainty", () => {
  const c = confidence("Berserk", null, "Berserk", null);
  assert.ok(c < 1 && c >= WEAK, `expected capped-but-usable, got ${c}`);
});

test("rank orders candidates and surfaces the count-corroborated one first", () => {
  const ranked = rank(
    [m("Vinland Saga", 12), m("Vinland Saga", 199), m("Something Else", 200)],
    "Vinland Saga",
    200,
  );
  assert.equal(ranked[0].manga.chapterCount, 199);
  assert.ok(ranked[0].confidence >= CONFIDENT);
});

test("nothing plausible stays under the weak floor", () => {
  const ranked = rank([m("One Piece", 1100)], "Berserk", 374);
  assert.ok(ranked[0].confidence < WEAK, `got ${ranked[0].confidence}`);
});

test("for a one-shot film, an explicit movie title beats a shorter homonym", () => {
  const ranked = rank(
    [m("Silent Voice", 1), m("A Silent Voice: The Movie", 1)],
    "A Silent Voice",
    1,
  );
  assert.equal(ranked[0].manga.title, "A Silent Voice: The Movie");
});

test("with no expected count, the entry that actually has chapters wins the tie", () => {
  // Kitsu reports no chapterCount for an ongoing series, so both of MangaDex's
  // One Piece entries score identically on title alone. Binding to the one
  // holding 2 chapters instead of 764 is the failure this guards.
  const ranked = rank(
    [m("One Piece", 2), m("One Piece (Official Colored)", 764)],
    "One Piece",
    null,
  );
  assert.equal(ranked[0].manga.chapterCount, 764);
});

test("searchTitles keeps a distinct english/romaji pair and drops dupes", () => {
  assert.deepEqual(
    searchTitles("Haimiya Senpai wa Kowakute Kawaii", [
      "Haimiya Senpai wa Kowakute Kawaii!",
      "Haimiya-senpai is Scary and Cute",
    ]),
    ["Haimiya Senpai wa Kowakute Kawaii", "Haimiya-senpai is Scary and Cute"],
  );
});

test("rank uses the best of several expected titles", () => {
  const ranked = rank(
    [m("Haimiya-senpai is Scary and Cute", 12)],
    ["Haimiya Senpai wa Kowakute Kawaii", "Haimiya-senpai is Scary and Cute"],
    12,
  );
  assert.ok(ranked[0].confidence >= CONFIDENT, `got ${ranked[0].confidence}`);
});

test("weak match dismiss is per title and survives junk storage", () => {
  const aot = weakDismissKey("kitsu", "anime", 7442);
  const op = weakDismissKey("anilist", "anime", 21);
  assert.equal(aot, "kitsu:anime:7442");
  assert.equal(weakDismissed(null, aot), false);
  assert.equal(weakDismissed("{nope", aot), false);
  const once = dismissWeak(null, aot);
  assert.equal(weakDismissed(once, aot), true);
  assert.equal(weakDismissed(once, op), false);
  const twice = dismissWeak(once, aot);
  assert.equal(JSON.parse(twice).length, 1);
  assert.equal(weakDismissed(dismissWeak(once, op), op), true);
});

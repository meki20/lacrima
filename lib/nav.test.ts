import assert from "node:assert/strict";
import { test } from "node:test";
import { firstPlay, navTabForKind, playHref, playLabel, titleBackHref } from "./nav.ts";

test("navTabForKind follows browse tabs, never Yours", () => {
  assert.equal(navTabForKind("anime"), "Anime");
  assert.equal(navTabForKind("manga"), "Manga");
  assert.equal(navTabForKind("novel"), "Novels");
  assert.equal(navTabForKind("mystery"), "Home");
});

test("titleBackHref skips the season redirect when the watched id is not the root", () => {
  assert.equal(titleBackHref("kitsu", "anime", 1, { rootId: 1 }), "/title/kitsu/anime/1");
  assert.equal(
    titleBackHref("kitsu", "anime", 3, { rootId: 1 }),
    "/title/kitsu/anime/1?part=3",
  );
  assert.equal(titleBackHref("anilist", "manga", 9, null), "/title/anilist/manga/9");
});

test("firstPlay is the first episode of this season window, not franchise E1", () => {
  const s1 = Array.from({ length: 25 }, (_, i) => ({
    id: `s1e${i + 1}`,
    number: i + 1,
    season: 1,
  }));
  const chapters = [...s1, { id: "s2e1", number: 1, season: 2 }, { id: "s2e2", number: 2, season: 2 }];
  const s2 = firstPlay("anime", chapters, { offset: 25, count: 12, seasonHint: 2 });
  assert.deepEqual(s2, { id: "s2e1", number: 1, season: 2 });
  const manga = firstPlay("manga", [
    { id: "c1", number: 1 },
    { id: "c2", number: 2 },
  ]);
  assert.equal(manga?.id, "c1");
  assert.equal(firstPlay("anime", []), null);
});

test("firstPlay on a single-season list is episode 1, not a window slice", () => {
  const deathNote = Array.from({ length: 37 }, (_, i) => ({
    id: `e${i + 1}`,
    number: i + 1,
    season: 1,
  }));
  assert.equal(firstPlay("anime", deathNote, { offset: 0, count: 37, seasonHint: 1 })?.id, "e1");
  const frieren = [
    { id: "f1", number: 1, season: 1 },
    { id: "f2", number: 2, season: 1 },
  ];
  assert.equal(firstPlay("anime", frieren, { offset: 0, count: 28, seasonHint: 1 })?.id, "f1");
});

test("playHref encodes source ids; playLabel is sentence case", () => {
  assert.equal(playHref("kitsu", "anime", 7, "tt:1:2"), "/read/kitsu/anime/7/tt%3A1%3A2");
  assert.equal(playLabel("anime", 1), "Play episode 1");
  assert.equal(playLabel("manga", 12), "Read chapter 12");
});

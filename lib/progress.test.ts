import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProgressRow } from "./progress.ts";
import {
  continueDetail,
  continueRatio,
  heroAction,
  pickContinue,
  toContinueItem,
  unitPip,
} from "./progress.ts";
import { heldUnit, holdStickerToasts, isChapterRead, keepsResumeAnchor, skipWatchSeconds, spanWatchSeconds, usesSeriesTree } from "./progress-write.ts";

const row = (over: Partial<ProgressRow> & { title: string; media_id: number }): ProgressRow => ({
  profile_id: 1,
  via: "kitsu",
  media_type: "anime",
  unit: 1,
  anchor: null,
  cover: null,
  updated_at: 1,
  watched_seconds: 0,
  ...over,
});

test("manga, novels, and anime keep the farthest unit", () => {
  assert.equal(heldUnit("manga", 14, 3), 14);
  assert.equal(heldUnit("novel", 4, 10), 10);
  assert.equal(heldUnit("anime", 12, 3), 12);
  assert.equal(heldUnit("anime", 3, 12), 12);
});

test("franchise writes only run on skip-ahead or mark-up-to-here", () => {
  const parts = [{ mediaId: 1 }, { mediaId: 2 }];
  assert.equal(usesSeriesTree({ seriesParts: parts, partIndex: 1 }), false);
  assert.equal(usesSeriesTree({ seriesParts: parts, partIndex: 1, skipAhead: true }), true);
  assert.equal(usesSeriesTree({ seriesParts: parts, partIndex: 1, exact: true }), true);
  assert.equal(usesSeriesTree({ seriesParts: parts, partIndex: -1, skipAhead: true }), false);
  assert.equal(usesSeriesTree({ seriesParts: parts, partIndex: 0, skipAhead: true }), true);
});

test("skipping ahead credits every episode before the one you opened", () => {
  assert.equal(skipWatchSeconds(0, 15, 1440), 14 * 1440);
  assert.equal(skipWatchSeconds(5, 15, 1440), 10 * 1440);
  assert.equal(skipWatchSeconds(14, 15, 1440), 1440);
  assert.equal(skipWatchSeconds(15, 15, 1440), 0);
  assert.equal(skipWatchSeconds(0, 1, 1440), 0);
  assert.equal(skipWatchSeconds(0, 15, 0), 0);
  assert.equal(spanWatchSeconds(0, 15, 1440), 15 * 1440);
  assert.equal(spanWatchSeconds(15, 5, 1440), 10 * 1440);
});

test("chapters before the farthest reached one are read, current is not", () => {
  assert.equal(isChapterRead(0, 14, 15), true);
  assert.equal(isChapterRead(13, 14, 15), true);
  assert.equal(isChapterRead(14, 14, 15), false);
  assert.equal(isChapterRead(15, 14, 15), false);
  assert.equal(isChapterRead(0, -1, 14), true);
  assert.equal(isChapterRead(13, -1, 14), true);
  assert.equal(isChapterRead(14, -1, 14), false);
  assert.equal(isChapterRead(0, 14, 5), true);
  assert.equal(isChapterRead(10, 14, 5), false);
  assert.equal(isChapterRead(2, 2, 5), true);
});

test("revisiting read units keeps the real resume anchor", () => {
  assert.equal(keepsResumeAnchor(5, 3, "chapter-5"), true);
  assert.equal(keepsResumeAnchor(5, 5, "-"), true);
  assert.equal(keepsResumeAnchor(5, 5, "chapter-5"), false);
  assert.equal(keepsResumeAnchor(5, 3, "chapter-5", true), false);
});

test("sticker toasts wait until the anime player is left", () => {
  assert.equal(holdStickerToasts("/read/kitsu/anime/12/ep-1"), true);
  assert.equal(holdStickerToasts("/read/kitsu/manga/76925/2865"), false);
  assert.equal(holdStickerToasts("/title/kitsu/manga/76925"), false);
});

test("unitPip uses season when the player stored one", () => {
  assert.equal(unitPip("anime", 19, 2), "S2·E19");
  assert.equal(unitPip("anime", 27, 2, 3), "S2·E3");
  assert.equal(unitPip("anime", 12, 0), "Ep. 12");
  assert.equal(unitPip("anime", 12, null), "Ep. 12");
  assert.equal(unitPip("manga", 158, 1), "Ch. 158");
  assert.equal(unitPip("novel", 9), "Ch. 9");
});

test("continueDetail prefers remaining time, then page of pages", () => {
  assert.equal(
    continueDetail("anime", { kind: "seconds", at: 600, chapterId: "e", chapterName: "E", duration: 1440 }),
    "14 min left",
  );
  assert.equal(
    continueDetail("anime", { kind: "seconds", at: 1410, chapterId: "e", chapterName: "E", duration: 1440 }),
    "1 min left",
  );
  assert.equal(continueDetail("anime", { kind: "seconds", at: 600, chapterId: "e", chapterName: "E" }), "");
  assert.equal(
    continueDetail("manga", { kind: "page", index: 8, chapterId: 1, chapterName: "C", pages: 21 }),
    "page 9 of 21",
  );
  assert.equal(continueDetail("manga", { kind: "page", index: 2, chapterId: 1, chapterName: "C" }), "page 3");
  assert.equal(continueDetail("novel", { kind: "paragraph", cfi: "x" }), "");
});

test("continueRatio is null without a known length, never outside 0–1", () => {
  assert.equal(continueRatio({ kind: "seconds", at: 720, chapterId: "e", chapterName: "E", duration: 1440 }), 0.5);
  assert.equal(continueRatio({ kind: "seconds", at: 720, chapterId: "e", chapterName: "E" }), null);
  assert.equal(continueRatio({ kind: "page", index: 9, chapterId: 1, chapterName: "C", pages: 20 }), 0.5);
  assert.equal(continueRatio({ kind: "seconds", at: 2000, chapterId: "e", chapterName: "E", duration: 1440 }), 1);
  assert.equal(continueRatio(null), null);
});

test("toContinueItem keeps provider ids, resume href, and season pip", () => {
  const item = toContinueItem(
    row({
      media_id: 7442,
      via: "anilist",
      title: "Vinland Saga Season 2",
      unit: 19,
      cover: "https://img/v.png",
      anchor: JSON.stringify({
        kind: "seconds",
        at: 600,
        chapterId: "tt:s2e19",
        chapterName: "The Hunter and the Hunted",
        duration: 1440,
        season: 2,
      }),
    }),
  );
  assert.equal(item.via, "anilist");
  assert.equal(item.id, 7442);
  assert.equal(item.title, "Vinland Saga");
  assert.equal(item.pip, "S2·E19");
  assert.equal(item.detail, "14 min left");
  assert.equal(item.ratio, 600 / 1440);
  assert.equal(item.href, "/read/anilist/anime/7442/tt%3As2e19");
});

test("toContinueItem for manga uses page detail and chapter href", () => {
  const item = toContinueItem(
    row({
      media_id: 11,
      media_type: "manga",
      title: "Chainsaw Man",
      unit: 158,
      anchor: JSON.stringify({
        kind: "page",
        index: 8,
        chapterId: "ch-158",
        chapterName: "Chainsaw Man vs. Chainsaw Man",
        pages: 21,
      }),
    }),
  );
  assert.equal(item.pip, "Ch. 158");
  assert.equal(item.detail, "page 9 of 21");
  assert.equal(item.href, "/read/kitsu/manga/11/ch-158");
});

test("pickContinue keeps the newest franchise row and drops the older season", () => {
  const items = pickContinue(
    [
      row({ media_id: 2, title: "Attack on Titan Season 3", unit: 12, updated_at: 200, anchor: JSON.stringify({ kind: "seconds", at: 10, chapterId: "e12", chapterName: "E" }) }),
      row({ media_id: 1, title: "Attack on Titan", unit: 25, updated_at: 100, anchor: JSON.stringify({ kind: "seconds", at: 10, chapterId: "e25", chapterName: "E" }) }),
      row({ media_id: 9, title: "Frieren: Beyond Journey's End", unit: 4, updated_at: 90 }),
    ],
    14,
  );
  assert.deepEqual(
    items.map((i) => `${i.id}:${i.title}`),
    ["2:Attack on Titan", "9:Frieren: Beyond Journey's End"],
  );
  assert.equal(items[0].href, "/read/kitsu/anime/2/e12");
});

test("pickContinue folds Dr. Stone subtitle seasons into one card", () => {
  const items = pickContinue(
    [
      row({ media_id: 4, title: "Dr. STONE: Science Future", unit: 1, updated_at: 400, anchor: JSON.stringify({ kind: "seconds", at: 10, chapterId: "e1", chapterName: "E", season: 4, episode: 1 }) }),
      row({ media_id: 2, title: "Dr. STONE: Stone Wars", unit: 11, updated_at: 300 }),
      row({ media_id: 1, title: "Dr. STONE", unit: 24, updated_at: 200 }),
    ],
    14,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Dr. STONE");
  assert.equal(items[0].id, 4);
  assert.equal(items[0].href, "/read/kitsu/anime/4/e1");
});

test("pickContinue folds progress titles that have no colon between name and season", () => {
  const items = pickContinue(
    [
      row({
        media_id: 4,
        title: "Dr. STONE SCIENCE FUTURE",
        unit: 25,
        updated_at: 400,
        anchor: JSON.stringify({
          kind: "seconds",
          at: 10,
          chapterId: "e25",
          chapterName: "E",
          season: 4,
          episode: 25,
          duration: 1400,
        }),
      }),
      row({ media_id: 3, title: "Dr. STONE New World", unit: 11, updated_at: 300 }),
      row({ media_id: 1, title: "Dr. STONE", unit: 24, updated_at: 200 }),
      row({ media_id: 9, title: "Frieren: Beyond Journey's End", unit: 4, updated_at: 90 }),
    ],
    14,
  );
  assert.deepEqual(
    items.map((i) => `${i.id}:${i.title}`),
    ["4:Dr. STONE", "9:Frieren: Beyond Journey's End"],
  );
  assert.equal(items[0].pip, "S4·E25");
});

test("pickContinue still folds two seasons when the root title is missing", () => {
  const items = pickContinue(
    [
      row({ media_id: 4, title: "Dr. STONE SCIENCE FUTURE", unit: 25, updated_at: 400 }),
      row({ media_id: 3, title: "Dr. STONE New World", unit: 11, updated_at: 300 }),
    ],
    14,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Dr. STONE");
  assert.equal(items[0].id, 4);
});

test("pickContinue does not collapse same title across kinds or providers", () => {
  const items = pickContinue(
    [
      row({ media_id: 1, via: "kitsu", title: "Berserk", media_type: "manga", unit: 1 }),
      row({ media_id: 1, via: "anilist", title: "Berserk", media_type: "manga", unit: 2 }),
      row({ media_id: 3, via: "kitsu", title: "Berserk", media_type: "anime", unit: 1 }),
    ],
    14,
  );
  assert.equal(items.length, 3);
});

test("broken anchor JSON still produces a title-page href", () => {
  const item = toContinueItem(row({ media_id: 5, title: "Dandadan", anchor: "{nope" }));
  assert.equal(item.href, "/title/kitsu/anime/5");
  assert.equal(item.detail, "");
  assert.equal(item.ratio, null);
});

test("heroAction continues a show already in progress, including another season of the franchise", () => {
  const watching = toContinueItem(
    row({
      media_id: 2,
      title: "Attack on Titan Season 3",
      unit: 12,
      anchor: JSON.stringify({ kind: "seconds", at: 10, chapterId: "e12", chapterName: "E" }),
    }),
  );
  const root = heroAction(
    { via: "kitsu", kind: "anime", id: 1, title: "Attack on Titan" },
    [watching],
  );
  assert.equal(root.primary.label, "Continue");
  assert.equal(root.primary.href, watching.href);
  assert.equal(root.secondary?.label, "Details");
  assert.equal(root.secondary?.href, "/title/kitsu/anime/1");
  const fresh = heroAction(
    { via: "kitsu", kind: "anime", id: 9, title: "Frieren: Beyond Journey's End" },
    [watching],
  );
  assert.equal(fresh.primary.label, "Details");
  assert.equal(fresh.secondary, undefined);
  const otherProvider = heroAction(
    { via: "anilist", kind: "anime", id: 1, title: "Attack on Titan" },
    [watching],
  );
  assert.equal(otherProvider.primary.label, "Details");
});

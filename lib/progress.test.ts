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

const row = (over: Partial<ProgressRow> & { title: string; media_id: number }): ProgressRow => ({
  profile_id: 1,
  via: "kitsu",
  media_type: "anime",
  unit: 1,
  anchor: null,
  cover: null,
  updated_at: 1,
  ...over,
});

test("unitPip uses season when the player stored one", () => {
  assert.equal(unitPip("anime", 19, 2), "S2·E19");
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

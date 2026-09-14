import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAPTERS_PER_STICKER,
  CHAR_CAP,
  SECONDS_PER_STICKER,
  SERIES_CHAR_MAX,
  dueCount,
  groupEarnedStickers,
  mergeSeriesChars,
  pickNext,
  remapPoolIds,
  stickerTail,
  type CastChar,
  type StickerDef,
} from "./stickers.ts";
import { filterStickerGroups } from "./sticker-catalog.ts";

const def = (id: string, secret = false): StickerDef => ({
  id,
  name: id,
  image: null,
  secret,
});

test("anime unlocks every 15 minutes, manga and novels every 5 chapters", () => {
  assert.equal(SECONDS_PER_STICKER, 15 * 60);
  assert.equal(CHAPTERS_PER_STICKER, 5);
  assert.equal(dueCount("anime", { seconds: 899, unit: 0 }, 10), 0);
  assert.equal(dueCount("anime", { seconds: 900, unit: 0 }, 10), 1);
  assert.equal(dueCount("anime", { seconds: 0, unit: 5 }, 10), 8);
  assert.equal(dueCount("manga", { seconds: 10_000, unit: 4 }, 10), 0);
  assert.equal(dueCount("manga", { seconds: 0, unit: 5 }, 10), 1);
  assert.equal(dueCount("manga", { seconds: 0, unit: 50 }, 8), 8);
  assert.equal(dueCount("novel", { seconds: 10_000, unit: 4 }, 10), 0);
  assert.equal(dueCount("novel", { seconds: 0, unit: 10 }, 10), 2);
  assert.equal(dueCount("manga", { seconds: 0, unit: 20 }, 20), 4);
  assert.equal(dueCount("manga", { seconds: 0, unit: 15 }, 20), 3);
  assert.equal(dueCount("manga", { seconds: 0, unit: 180 }, 10), 10);
  assert.equal(dueCount("manga", { seconds: 0, unit: 175 }, 10), 10);
});

test("random pick stays in the regular pool until those are gone, then secrets", () => {
  const defs = [def("a"), def("b"), def("c"), def("s1", true), def("s2", true)];
  const first = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const n = pickNext(defs, new Set(), () => i / 8);
    assert.ok(n && !n.secret);
    first.add(n.id);
  }
  assert.deepEqual([...first].sort(), ["a", "b", "c"]);
  const secret = pickNext(defs, new Set(["a", "b", "c"]), () => 0);
  assert.equal(secret?.secret, true);
  assert.equal(pickNext(defs, new Set(["a", "b", "c", "s1", "s2"])), null);
});

test("revoked stickers stay out of the random pool", () => {
  const defs = [def("a"), def("b"), def("s1", true)];
  assert.equal(pickNext(defs, new Set(["a"]), () => 0)?.id, "b");
  assert.equal(pickNext(defs, new Set(["a", "b"]), () => 0)?.secret, true);
  assert.equal(pickNext(defs, new Set(["a", "b", "s1"])), null);
});

test("trimmed stickers can fill due again once unused faces are gone", () => {
  const defs = [def("a"), def("b"), def("c")];
  const have = new Set(["a"]);
  const blocked = new Set(["b", "c"]);
  assert.equal(pickNext(defs, new Set([...have, ...blocked])), null);
  assert.ok(pickNext(defs, have));
});

const ch = (id: string, extra: Partial<CastChar> = {}): CastChar => ({
  id,
  name: id,
  image: `${id}.png`,
  ...extra,
});

test("stickerTail strips the title id so seasons share a character", () => {
  assert.equal(stickerTail("kitsu:1:c:99"), "c:99");
  assert.equal(stickerTail("kitsu:2:c:99"), "c:99");
  assert.equal(stickerTail("kitsu:1:c:99:r2"), "c:99:r2");
  assert.equal(stickerTail("kitsu:1:x:1"), "x:1");
  assert.equal(stickerTail("nope"), null);
});

test("series sticker pools keep season 1 and add new faces from later parts", () => {
  const s1 = [ch("senku", { main: true }), ch("chrome", { main: true }), ch("kohaku"), ch("ginro")];
  const s2 = [ch("senku", { main: true }), ch("ryusui"), ch("francois")];
  const merged = mergeSeriesChars([s1, s2], 4, 3, 10);
  assert.deepEqual(
    merged.map((c) => String(c.id)),
    ["senku", "chrome", "kohaku", "ginro", "ryusui", "francois"],
  );
});

test("later seasons can repeat a main character when the art changed", () => {
  const s1 = [ch("senku", { main: true, image: "s1.png" }), ch("kohaku")];
  const s2 = [ch("senku", { main: true, image: "s2.png" }), ch("kohaku")];
  const merged = mergeSeriesChars([s1, s2], 2, 3, 10);
  assert.equal(merged.length, 3);
  assert.equal(String(merged[2].id), "senku:r1");
  assert.equal(merged[2].image, "s2.png");
});

test("one franchise pool stays capped instead of stacking a set per season", () => {
  const s1 = Array.from({ length: CHAR_CAP }, (_, i) => ch(`c${i}`, { main: i < 3 }));
  const later = Array.from({ length: 6 }, (_, s) =>
    Array.from({ length: CHAR_CAP }, (_, i) => ch(`s${s + 2}-${i}`)),
  );
  const merged = mergeSeriesChars([s1, ...later]);
  assert.equal(merged.length, SERIES_CHAR_MAX);
  assert.equal(String(merged[0].id), "c0");
});

test("mergeSeriesChars uses the first season that actually returned a cast", () => {
  const s2 = [ch("ryusui"), ch("francois"), ch("ukyo")];
  const merged = mergeSeriesChars([[], s2], 16, 3, 28);
  assert.deepEqual(
    merged.map((c) => String(c.id)),
    ["ryusui", "francois", "ukyo"],
  );
});

test("remapPoolIds moves a season pool onto the series root", () => {
  const defs = [
    def("kitsu:99:c:1"),
    def("kitsu:99:x:1", true),
  ];
  assert.deepEqual(
    remapPoolIds(defs, "kitsu", 1).map((d) => d.id),
    ["kitsu:1:c:1", "kitsu:1:x:1"],
  );
});

test("groupEarnedStickers folds Dr. Stone seasons and leaves other series alone", () => {
  const groups = groupEarnedStickers([
    { id: "kitsu:4:c:1", name: "Senku", src: "s.png", title: "Dr. STONE SCIENCE FUTURE" },
    { id: "kitsu:3:c:2", name: "Kohaku", src: "k.png", title: "Dr. STONE New World" },
    { id: "kitsu:1:c:1", name: "Chrome", src: "c.png", title: "Dr. STONE" },
    { id: "kitsu:9:c:1", name: "Frieren", src: "f.png", title: "Frieren: Beyond Journey's End" },
  ]);
  assert.deepEqual(
    groups.map((g) => `${g.title}:${g.stickers.map((s) => s.name).join(",")}`),
    ["Dr. STONE:Senku,Kohaku,Chrome", "Frieren: Beyond Journey's End:Frieren"],
  );
});

test("filterStickerGroups matches series name or character name", () => {
  const groups = [
    {
      title: "Dr. STONE",
      stickers: [
        { id: "a", name: "Senku", src: "s.png" },
        { id: "b", name: "Kohaku", src: "k.png" },
      ],
    },
    {
      title: "Frieren: Beyond Journey's End",
      stickers: [{ id: "c", name: "Frieren", src: "f.png" }],
    },
  ];
  assert.equal(filterStickerGroups(groups, "stone")[0]?.stickers.length, 2);
  assert.deepEqual(
    filterStickerGroups(groups, "senku").map((g) => `${g.title}:${g.stickers.map((s) => s.name).join(",")}`),
    ["Dr. STONE:Senku"],
  );
  assert.equal(filterStickerGroups(groups, "nope").length, 0);
});

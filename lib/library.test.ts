import assert from "node:assert/strict";
import { test } from "node:test";
import type { LibraryItem } from "./library.ts";
import {
  collapseLibrary,
  filterLibrary,
  parseGenres,
  parseSort,
  parseStatus,
  progressLabel,
  progressRatio,
  shelfItems,
  sortLibrary,
} from "./library.ts";

const item = (over: Partial<LibraryItem> & { id: number; title: string }): LibraryItem => ({
  via: "anilist",
  kind: "manga",
  status: "reading",
  score: null,
  added_at: 1,
  cover: null,
  color: null,
  units: 10,
  genres: ["Drama"],
  pin: 0,
  unit: 3,
  href: "/title/anilist/manga/1",
  ...over,
});

test("library parsers reject unknown status and default sort to recently added", () => {
  assert.equal(parseStatus("reading"), "reading");
  assert.equal(parseStatus("watching"), null);
  assert.equal(parseSort("title"), "title");
  assert.equal(parseSort("nope"), "added");
  assert.deepEqual(parseGenres('["Drama","Fantasy"]'), ["Drama", "Fantasy"]);
  assert.deepEqual(parseGenres("not-json"), []);
});

test("filterLibrary is kind, status, genre and title, never a silent empty for unknown filters", () => {
  const rows = [
    item({ id: 1, title: "Vinland Saga", kind: "anime", status: "reading", genres: ["Adventure"] }),
    item({ id: 2, title: "Berserk", kind: "manga", status: "completed", genres: ["Drama"] }),
    item({ id: 3, title: "Mushoku Tensei", kind: "novel", status: "planned", genres: ["Fantasy"] }),
  ];
  assert.equal(filterLibrary(rows, { kind: "manga" }).length, 1);
  assert.equal(filterLibrary(rows, { status: "planned" })[0].title, "Mushoku Tensei");
  assert.equal(filterLibrary(rows, { genre: "Adventure" })[0].id, 1);
  assert.equal(filterLibrary(rows, { q: "vin" })[0].title, "Vinland Saga");
  assert.equal(filterLibrary(rows, { kind: "anime", status: "completed" }).length, 0);
});

test("sortLibrary and shelf keep pin order and cap at 10", () => {
  const rows = [
    item({ id: 1, title: "B", added_at: 2, score: 8, unit: 1, units: 10, pin: 2 }),
    item({ id: 2, title: "A", added_at: 3, score: null, unit: 9, units: 10, pin: 1 }),
    item({ id: 3, title: "C", added_at: 1, score: 10, unit: 5, units: 10, pin: 0 }),
  ];
  assert.deepEqual(sortLibrary(rows, "title").map((m) => m.title), ["A", "B", "C"]);
  assert.equal(sortLibrary(rows, "score")[0].id, 3);
  assert.equal(sortLibrary(rows, "progress")[0].id, 2);
  assert.equal(sortLibrary(rows, "added")[0].id, 2);
  assert.deepEqual(shelfItems(rows).map((m) => m.id), [2, 1]);
});

test("progressLabel matches the mockup's kind-aware counts", () => {
  assert.equal(progressLabel({ kind: "anime", unit: 19, units: 48 }), "19 / 48");
  assert.equal(progressLabel({ kind: "manga", unit: 158, units: 195 }), "158 / 195");
  assert.equal(progressLabel({ kind: "novel", unit: 9, units: 26 }), "vol 9 / 26");
  assert.equal(progressRatio({ unit: 5, units: 10 }), 0.5);
  assert.equal(progressRatio({ unit: null, units: 10 }), 0);
});

test("collapseLibrary folds Dr. Stone seasons into one card", () => {
  const rows = [
    item({
      id: 4,
      via: "kitsu",
      kind: "anime",
      title: "Dr. STONE SCIENCE FUTURE",
      status: "reading",
      added_at: 400,
      href: "/title/kitsu/anime/4",
    }),
    item({
      id: 3,
      via: "kitsu",
      kind: "anime",
      title: "Dr. STONE New World",
      status: "completed",
      added_at: 300,
      pin: 1,
      href: "/title/kitsu/anime/3",
    }),
    item({
      id: 1,
      via: "kitsu",
      kind: "anime",
      title: "Dr. STONE",
      status: "completed",
      added_at: 200,
      href: "/title/kitsu/anime/1",
    }),
    item({ id: 9, via: "kitsu", kind: "anime", title: "Frieren: Beyond Journey's End", added_at: 90 }),
    item({ id: 11, via: "kitsu", kind: "manga", title: "Dr. STONE", added_at: 80 }),
  ];
  const out = collapseLibrary(rows);
  assert.deepEqual(
    out.map((m) => `${m.kind}-${m.id}:${m.title}`),
    ["anime-4:Dr. STONE", "anime-9:Frieren: Beyond Journey's End", "manga-11:Dr. STONE"],
  );
  assert.equal(out[0]!.status, "reading");
  assert.equal(out[0]!.pin, 1);
});

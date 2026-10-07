import assert from "node:assert/strict";
import { test } from "node:test";
import { imdbBinding, sourceQueries } from "./resolve.ts";
import type { SourceInfo } from "./sources/types.ts";

test("a typed query replaces metadata names", () => {
  assert.deepEqual(
    sourceQueries(
      { title: "Haimiya Senpai wa Kowakute Kawaii", aliases: ["Haimiya-senpai is Scary and Cute"] },
      "fan english title",
    ),
    ["fan english title"],
  );
});

test("source search tries the display title and one distinct alias", () => {
  assert.deepEqual(
    sourceQueries({
      title: "Haimiya Senpai wa Kowakute Kawaii",
      aliases: ["Haimiya-senpai is Scary and Cute"],
    }),
    ["Haimiya Senpai wa Kowakute Kawaii", "Haimiya-senpai is Scary and Cute"],
  );
});

test("whitespace-only query is ignored", () => {
  assert.deepEqual(
    sourceQueries({ title: "Berserk", aliases: [] }, "   "),
    ["Berserk"],
  );
});

const src = (over: Partial<SourceInfo> = {}): SourceInfo => ({
  id: "a", name: "A", lang: "all", iconUrl: null, kind: "anime", isLocal: false, ...over,
});
const film = { via: "cinemeta" as const, id: 111161, kind: "movie" as const, imdb: "tt0111161", title: "The Shawshank Redemption" };
const show = { via: "cinemeta" as const, id: 944947, kind: "series" as const, imdb: "tt0944947", title: "Game of Thrones" };

test("a movie or series with an IMDb id binds to the installed addons without searching", () => {
  const m = imdbBinding(film, [src({ types: ["movie"] })]);
  assert.deepEqual(
    m && { ...m, bound_at: 0 },
    {
      via: "cinemeta", media_id: 111161, source_id: "imdb", source_title: "The Shawshank Redemption",
      source_manga_id: "imdb::movie:tt0111161", confidence: 1, bound_at: 0, pinned: 0, backend: "stremio", kind: "movie",
    },
  );
  const d = imdbBinding(show, [src({ types: ["series"] })]);
  assert.equal(d?.source_manga_id, "imdb::series:tt0944947");
  assert.equal(d?.kind, "series");
});

test("no installed source means no binding, so the page can say nothing has this yet", () => {
  assert.equal(imdbBinding(film, []), null);
  assert.equal(imdbBinding(show, []), null);
});

test("an addon that cannot serve the kind does not make a binding", () => {
  assert.equal(imdbBinding(film, [src({ types: ["anime"] }), src({ id: "b", types: ["series"] })]), null);
  assert.equal(imdbBinding(show, [src({ types: ["movie"] })]), null);
  // Known to have no stream resource, or the built-in local source: nothing to play with.
  assert.equal(imdbBinding(film, [src({ streams: false }), src({ id: "l", isLocal: true })]), null);
  // Not yet read (no types, no streams flag) is not a "no".
  assert.ok(imdbBinding(film, [src()]));
  // One capable addon among useless ones is enough.
  assert.ok(imdbBinding(film, [src({ types: ["anime"] }), src({ id: "b", types: ["movie", "series"] })]));
});

test("only movies and series that carry an IMDb id are synthesised", () => {
  const any = [src()];
  assert.equal(imdbBinding({ ...film, imdb: null }, any), null);
  assert.equal(imdbBinding({ ...film, imdb: undefined }, any), null);
  for (const kind of ["anime", "manga", "novel"] as const) {
    assert.equal(imdbBinding({ ...film, kind, imdb: "tt0111161" }, any), null, kind);
  }
});

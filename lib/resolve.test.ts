import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceQueries } from "./resolve.ts";

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

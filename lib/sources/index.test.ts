import assert from "node:assert/strict";
import { test } from "node:test";
import { langMatches, pickSearchable } from "./index.ts";

test("en matches English plugin langs and not Japanese", () => {
  const langs = ["en"];
  assert.equal(langMatches("en", langs), true);
  assert.equal(langMatches("English", langs), true);
  assert.equal(langMatches("en,all", langs), true);
  assert.equal(langMatches("日本語", langs), false);
});

test("default en,all matches English and all-language sources, not every language", () => {
  const langs = ["en", "all"];
  assert.equal(langMatches("en", langs), true);
  assert.equal(langMatches("all", langs), true);
  assert.equal(langMatches("ja", langs), false);
  assert.equal(langMatches("es", langs), false);
  assert.equal(langMatches("*", ["*"]), true);
});

test("search caps remote sources without excluding the eighth eligible addon", () => {
  const sources = Array.from({ length: 9 }, (_, i) => ({
    id: String(i),
    lang: "all",
    kind: "anime" as const,
    isLocal: false,
  }));
  assert.deepEqual(pickSearchable(sources).map((source) => source.id), ["0", "1", "2", "3", "4", "5", "6", "7"]);
});

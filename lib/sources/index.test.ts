import assert from "node:assert/strict";
import { test } from "node:test";
import { langMatches } from "./index.ts";

test("en matches English plugin langs and not Japanese", () => {
  const langs = ["en"];
  assert.equal(langMatches("en", langs), true);
  assert.equal(langMatches("English", langs), true);
  assert.equal(langMatches("en,all", langs), true);
  assert.equal(langMatches("日本語", langs), false);
});

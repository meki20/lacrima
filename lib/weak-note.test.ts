import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dismissWeak, weakDismissKey, weakDismissed } from "./weak-note.ts";

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

test("the client note never imports sqlite-backed modules", () => {
  const src = readFileSync(new URL("../components/WeakMatchNote.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /lib\/match/);
  assert.doesNotMatch(src, /lib\/db/);
  assert.match(src, /lib\/weak-note/);
});

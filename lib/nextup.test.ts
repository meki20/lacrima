import assert from "node:assert/strict";
import { test } from "node:test";
import { NEXT_UP_SECONDS, nextUpCountdown, toggleSubChoice } from "./nextup.ts";

test("next-up waits for a credible end, never a catalog-runtime estimate", () => {
  const base = {
    position: 1425,
    duration: 1440,
    ended: false,
    watchedSeconds: 200,
    cancelled: false,
    hasNext: true,
  };
  assert.equal(nextUpCountdown(base), null);
  assert.equal(nextUpCountdown({ ...base, position: 1432.2 }), null);
  assert.equal(nextUpCountdown({ ...base, position: 1440 }), null);
  assert.equal(nextUpCountdown({ ...base, ended: true }), 0);
  assert.equal(nextUpCountdown({ ...base, ended: true, position: 1200 }), null);
  assert.equal(nextUpCountdown({ ...base, position: 1200 }), null);
  assert.equal(nextUpCountdown({ ...base, watchedSeconds: 10 }), null);
  assert.equal(nextUpCountdown({ ...base, duration: 40 }), null);
  assert.equal(nextUpCountdown({ ...base, duration: null }), null);
  assert.equal(nextUpCountdown({ ...base, hasNext: false }), null);
  assert.equal(nextUpCountdown({ ...base, cancelled: true }), null);
  assert.equal(nextUpCountdown({ ...base, ended: true, watchedSeconds: 5 }), null);
});

test("toggleSubChoice restores the last file, not a random language", () => {
  assert.equal(toggleSubChoice("en:https://x/a.srt", "en:https://x/a.srt"), "off");
  assert.equal(toggleSubChoice("off", "ja:https://x/b.ass"), "ja:https://x/b.ass");
  assert.equal(toggleSubChoice("off", null), "off");
});

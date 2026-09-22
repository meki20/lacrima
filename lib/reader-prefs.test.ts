import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_READER, parseReaderPrefs, tapZone, wheelZoom } from "./reader-prefs.ts";

test("manga defaults to rtl when nothing is saved", () => {
  assert.equal(DEFAULT_READER.rtl, true);
  assert.equal(parseReaderPrefs(null).rtl, true);
  assert.equal(parseReaderPrefs("{}").rtl, true);
  assert.equal(parseReaderPrefs("{nope").rtl, true);
});

test("an explicit direction is kept", () => {
  assert.equal(parseReaderPrefs('{"rtl":false}').rtl, false);
  assert.equal(parseReaderPrefs('{"rtl":true,"mode":"webtoon"}').mode, "webtoon");
});

test("tap zones cover the page, not just empty gutters", () => {
  assert.equal(tapZone(10, 10, 390, 844), "top");
  assert.equal(tapZone(40, 400, 390, 844), "left");
  assert.equal(tapZone(350, 400, 390, 844), "right");
  assert.equal(tapZone(195, 400, 390, 844), "mid");
});

test("reader wheel zoom follows scroll direction and stays bounded", () => {
  assert.equal(wheelZoom(1, -1), 1.25);
  assert.equal(wheelZoom(1.25, 1), 1);
  assert.equal(wheelZoom(4, -1), 4);
  assert.equal(wheelZoom(1, 1), 1);
});

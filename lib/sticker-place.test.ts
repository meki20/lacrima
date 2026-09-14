import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHROME,
  SCALE_MAX,
  SCALE_MIN,
  chromeKind,
  clampCoord,
  clampRot,
  clampScale,
  pagePath,
  placeBlocked,
  parseSurface,
  rectFrac,
  surfaceForWidth,
} from "./sticker-place.ts";

test("blocked pages reject stickers, sources, and settings", () => {
  assert.equal(placeBlocked("/stickers"), true);
  assert.equal(placeBlocked("/stickers/"), true);
  assert.equal(placeBlocked("/sources"), true);
  assert.equal(placeBlocked("/settings"), true);
  assert.equal(placeBlocked("/settings/playback"), true);
  assert.equal(placeBlocked("/"), false);
  assert.equal(placeBlocked("/yours"), false);
  assert.equal(placeBlocked("/title/kitsu/manga/1"), false);
  assert.equal(placeBlocked("/read/kitsu/manga/1/c/9"), false);
});

test("pagePath drops query strings and trailing slashes", () => {
  assert.equal(pagePath("/yours?sort=title"), "/yours");
  assert.equal(pagePath("/anime/"), "/anime");
  assert.equal(pagePath("/"), "/");
  assert.equal(pagePath("../etc"), "");
});

test("scale and coords clamp both ways", () => {
  assert.equal(clampScale(SCALE_MIN - 1), SCALE_MIN);
  assert.equal(clampScale(SCALE_MAX + 4), SCALE_MAX);
  assert.equal(clampScale(1), 1);
  assert.equal(clampScale(Number.NaN), 1);
  assert.equal(clampCoord(-0.2), 0);
  assert.equal(clampCoord(1.4), 1);
  assert.equal(clampCoord(0.25), 0.25);
});

test("rotation wraps through a full turn", () => {
  assert.equal(clampRot(0), 0);
  assert.equal(clampRot(90), 90);
  assert.equal(clampRot(360), 0);
  assert.equal(clampRot(-45), 315);
  assert.equal(clampRot(Number.NaN), 0);
});

test("chrome paths are global and not blocked", () => {
  assert.equal(chromeKind(CHROME.sidebar), "sidebar");
  assert.equal(chromeKind(CHROME.topbar), "topbar");
  assert.equal(chromeKind("/"), null);
  assert.equal(pagePath(CHROME.sidebar), CHROME.sidebar);
  assert.equal(placeBlocked(CHROME.sidebar), false);
  assert.equal(placeBlocked(CHROME.topbar), false);
});

test("rectFrac is local to the box", () => {
  const r = { left: 100, top: 50, width: 200, height: 100 };
  assert.deepEqual(rectFrac(200, 100, r), { x: 0.5, y: 0.5 });
  assert.deepEqual(rectFrac(100, 50, r), { x: 0, y: 0 });
  assert.deepEqual(rectFrac(0, 0, r), { x: 0, y: 0 });
});

test("phone and desktop surfaces stay distinct", () => {
  assert.equal(parseSurface("mobile"), "mobile");
  assert.equal(parseSurface("desktop"), "desktop");
  assert.equal(parseSurface("nope"), "desktop");
  assert.equal(surfaceForWidth(900), "mobile");
  assert.equal(surfaceForWidth(901), "desktop");
});

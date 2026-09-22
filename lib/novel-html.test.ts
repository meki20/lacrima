import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlParagraphs, paragraphCfi, paragraphIndex } from "./novel-html.ts";
import {
  chapterHasText,
  collectNovelChapters,
  normalizeChapters,
  type PluginInstance,
} from "./sources/plugin-host.ts";
import {
  DEFAULT_NOVEL_READER,
  clampNovelFontSize,
  parseNovelReaderPrefs,
} from "./reader-prefs.ts";

test("normalizeChapters drops empty paths and accepts url fallback", () => {
  const rows = normalizeChapters([
    { name: "One", path: "/c/1" },
    { name: "Bad", path: "" },
    { name: "Two", url: "/c/2" },
    null,
    "nope",
  ]);
  assert.deepEqual(
    rows.map((c) => c.path),
    ["/c/1", "/c/2"],
  );
});

test("chapterHasText rejects tag-only and blank HTML", () => {
  assert.equal(chapterHasText(""), false);
  assert.equal(chapterHasText("   "), false);
  assert.equal(chapterHasText("<div><p></p></div>"), false);
  assert.equal(chapterHasText("<p>Hello</p>"), true);
  assert.equal(chapterHasText(null), false);
});

test("collectNovelChapters walks PagePlugin pages", async () => {
  const plugin = {
    id: "t",
    name: "T",
    searchNovels: async () => [],
    parseNovel: async () => ({
      name: "N",
      path: "/n",
      totalPages: 3,
      chapters: [{ name: "1", path: "/1", page: "1" }],
    }),
    parseChapter: async () => "x",
    parsePage: async (_path: string, page: string) => ({
      chapters: [{ name: page, path: `/${page}` }],
    }),
  } as PluginInstance;
  const chapters = await collectNovelChapters(plugin, "/n");
  assert.deepEqual(
    chapters.map((c) => c.path),
    ["/1", "/2", "/3"],
  );
});

test("htmlParagraphs splits block tags", () => {
  const parts = htmlParagraphs("<p>One</p><div>Two</div><br/><p>Three</p>");
  assert.deepEqual(parts, ["One", "Two", "Three"]);
});

test("paragraph cfi round-trips like Android", () => {
  assert.equal(paragraphCfi(4), "p:4");
  assert.equal(paragraphIndex("p:4"), 4);
  assert.equal(paragraphIndex("0"), 0);
  assert.equal(paragraphIndex("p:12"), 12);
});

test("novel reader prefs default to continuous LTR", () => {
  assert.equal(DEFAULT_NOVEL_READER.mode, "continuous");
  assert.equal(DEFAULT_NOVEL_READER.rtl, false);
  assert.equal(parseNovelReaderPrefs(null).mode, "continuous");
  assert.equal(parseNovelReaderPrefs('{"mode":"paged","rtl":true,"fontSize":22}').fontSize, 22);
  assert.equal(parseNovelReaderPrefs('{"fontSize":99}').fontSize, 28);
  assert.equal(clampNovelFontSize(10), 14);
});

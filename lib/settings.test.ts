import assert from "node:assert/strict";
import { test } from "node:test";
import { readerSettings, type Settings } from "./settings.ts";

test("reader settings preserve the profile's saved defaults", () => {
  const settings: Settings = {
    audio_lang: "en", subtitle_lang: "auto", caption_scale: 1.2,
    reader_mode: "webtoon", reader_rtl: 0, reader_fit: "width", reader_spread: "double",
  };
  assert.deepEqual(readerSettings(settings), { mode: "webtoon", rtl: false, fit: "width", spread: "double" });
});

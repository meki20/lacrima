import assert from "node:assert/strict";
import { test } from "node:test";

process.env.LACRIMA_DB = ":memory:";
const { db } = await import("./db.ts");
const { profileSettings, readerSettings, updateProfileSettings } = await import("./settings.ts");
type Settings = import("./settings.ts").Settings;

test("reader settings preserve the profile's saved defaults", () => {
  const settings: Settings = {
    audio_lang: "en", subtitle_lang: "auto", caption_scale: 1.2,
    reader_mode: "webtoon", reader_rtl: 0, reader_fit: "width", reader_spread: "double", hidden_kinds: [],
  };
  assert.deepEqual(readerSettings(settings), { mode: "webtoon", rtl: false, fit: "width", spread: "double" });
});

test("hidden categories default to none and round trip per profile", () => {
  assert.deepEqual(profileSettings(1).hidden_kinds, []);
  updateProfileSettings(1, { hidden_kinds: ["movie", "series"] });
  assert.deepEqual(profileSettings(1).hidden_kinds, ["movie", "series"]);
  assert.equal((db().prepare("select hidden_kinds from profile_settings where profile_id = 1").get() as { hidden_kinds: string }).hidden_kinds, "movie,series");
  // Another profile is untouched, and an unrelated update leaves the choice alone.
  assert.deepEqual(profileSettings(2).hidden_kinds, []);
  updateProfileSettings(1, { caption_scale: 1.3 });
  assert.deepEqual(profileSettings(1).hidden_kinds, ["movie", "series"]);
  updateProfileSettings(1, { hidden_kinds: [] });
  assert.deepEqual(profileSettings(1).hidden_kinds, []);
});

test("hiding every category stores nothing hidden", () => {
  updateProfileSettings(1, { hidden_kinds: ["anime", "manga", "novel", "movie", "series"] });
  assert.deepEqual(profileSettings(1).hidden_kinds, []);
  assert.equal((db().prepare("select hidden_kinds from profile_settings where profile_id = 1").get() as { hidden_kinds: string }).hidden_kinds, "");
});

test("a stored or submitted drama is series, and the next write stores it as series", () => {
  updateProfileSettings(1, { caption_scale: 1 });
  db().prepare("update profile_settings set hidden_kinds = 'movie,drama' where profile_id = 1").run();
  assert.deepEqual(profileSettings(1).hidden_kinds, ["movie", "series"]);
  updateProfileSettings(1, { caption_scale: 1.1 });
  assert.equal((db().prepare("select hidden_kinds from profile_settings where profile_id = 1").get() as { hidden_kinds: string }).hidden_kinds, "movie,series");
  // The settings API accepts the old name too; the cast is for the type, which no longer has it.
  updateProfileSettings(1, { hidden_kinds: ["drama"] as never });
  assert.deepEqual(profileSettings(1).hidden_kinds, ["series"]);
  updateProfileSettings(1, { hidden_kinds: [] });
});

test("an unreadable stored value shows everything rather than throwing", () => {
  updateProfileSettings(1, { caption_scale: 1 });
  db().prepare("update profile_settings set hidden_kinds = 'movie,podcast' where profile_id = 1").run();
  assert.deepEqual(profileSettings(1).hidden_kinds, []);
});

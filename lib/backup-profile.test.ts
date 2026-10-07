import assert from "node:assert/strict";
import { test } from "node:test";

process.env.LACRIMA_DB = ":memory:";
const { db } = await import("./db.ts");
const { profileBackup, restoreProfile } = await import("./backup.ts");
const { profileSettings, subtitleChoice, updateProfileSettings, updateSubtitleChoice } = await import("./settings.ts");
const { stickerFace } = await import("./stickers.ts");
const { loadActivity, markActivity } = await import("./yours.ts");

test("profile backup restores sticker art definitions, positions, subtitles and caption size", () => {
  const d = db();
  const id = "anilist:42:c:7";
  const payload = JSON.stringify({ v: 2, defs: [{ id, name: "Hero", image: "https://example.com/hero.png", secret: false }] });
  d.prepare("insert into sticker_pools (via, media_id, payload, fetched_at) values (?, ?, ?, ?)")
    .run("anilist", 42, payload, 1);
  d.prepare("insert into stickers (profile_id, sticker_id, earned_at) values (?, ?, ?)").run(1, id, 2);
  d.prepare("insert into sticker_placements (profile_id, sticker_id, path, x, y, scale, rot, surface) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(1, id, "/yours", 0.42, 0.7, 1.2, 15, "desktop");
  updateProfileSettings(1, { caption_scale: 1.45 });
  updateSubtitleChoice(1, "anilist", 42, "episode-1", "https://example.com/sub.srt");

  const backup = profileBackup(1);
  assert.equal((backup.data.stickerPools as object[]).length, 1);
  assert.equal((backup.data.placements as object[]).length, 1);
  d.exec("delete from stickers; delete from sticker_placements; delete from sticker_pools; delete from subtitle_choices; delete from profile_settings;");
  restoreProfile(1, backup);

  assert.equal((d.prepare("select count(*) as n from stickers where profile_id = 1").get() as { n: number }).n, 1);
  assert.equal((d.prepare("select x from sticker_placements where profile_id = 1").get() as { x: number }).x, 0.42);
  assert.ok(stickerFace(id)?.src);
  assert.equal(subtitleChoice(1, "anilist", 42, "episode-1"), "https://example.com/sub.srt");
  assert.equal(profileSettings(1).caption_scale, 1.45);
});

const clearProfile = () => db().exec(
  "delete from library; delete from progress; delete from activity; delete from profile_settings;",
);

test("movie and series history, categories and activity survive a backup round trip", () => {
  const d = db();
  clearProfile();
  d.prepare("insert into library (profile_id, via, media_id, media_type, status, added_at, title) values (1, ?, ?, ?, 'planned', 1, 'Heat')")
    .run("tmdb-movie", 949, "movie");
  d.prepare("insert into progress (profile_id, via, media_id, media_type, unit, anchor, updated_at) values (1, ?, ?, ?, 1, null, 2)")
    .run("cinemeta", 111161, "movie");
  d.prepare("insert into progress (profile_id, via, media_id, media_type, unit, anchor, updated_at) values (1, ?, ?, ?, 4, null, 3)")
    .run("tmdb-tv", 1396, "series");
  markActivity(1, "movie", { unit: true, night: false });
  markActivity(1, "series", { unit: true, night: false });
  markActivity(1, "series", { unit: true, night: false });
  updateProfileSettings(1, { hidden_kinds: ["novel", "manga"] });

  const backup = profileBackup(1);
  assert.equal((backup.data.settings as { hidden_kinds: string }).hidden_kinds, "manga,novel");
  clearProfile();
  restoreProfile(1, backup);

  assert.deepEqual(profileSettings(1).hidden_kinds, ["manga", "novel"]);
  const day = loadActivity(1)[0];
  assert.equal(day.movie, 1);
  assert.equal(day.series, 2);
  const lib = d.prepare("select via, media_type from library where profile_id = 1").get() as { via: string; media_type: string };
  assert.deepEqual({ ...lib }, { via: "tmdb-movie", media_type: "movie" });
  const seen = d.prepare("select via, media_type, media_id from progress where profile_id = 1 order by media_id").all() as object[];
  assert.deepEqual(seen.map((r) => ({ ...r })), [
    { via: "tmdb-tv", media_type: "series", media_id: 1396 },
    { via: "cinemeta", media_type: "movie", media_id: 111161 },
  ]);
});

test("a backup made before movies and series still restores", () => {
  const d = db();
  clearProfile();
  d.prepare("insert into library (profile_id, via, media_id, media_type, status, added_at, title) values (1, 'anilist', 42, 'anime', 'planned', 1, 'Frieren')").run();
  markActivity(1, "anime", { unit: true, night: false });
  updateProfileSettings(1, { caption_scale: 1.2 });
  const backup = profileBackup(1);
  // Strip what an older server never wrote.
  delete (backup.data.settings as Record<string, unknown>).hidden_kinds;
  for (const row of backup.data.activity as Record<string, unknown>[]) { delete row.movie; delete row.series; }

  updateProfileSettings(1, { hidden_kinds: ["movie"] });
  clearProfile();
  restoreProfile(1, backup);

  assert.deepEqual(profileSettings(1).hidden_kinds, []);
  assert.equal(profileSettings(1).caption_scale, 1.2);
  const day = loadActivity(1)[0];
  assert.deepEqual({ anime: day.anime, movie: day.movie, series: day.series }, { anime: 1, movie: 0, series: 0 });
  assert.equal((d.prepare("select count(*) as n from library where profile_id = 1").get() as { n: number }).n, 1);
});

test("a drama-era backup restores its drama rows, settings and activity as series", () => {
  const d = db();
  clearProfile();
  d.prepare("insert into library (profile_id, via, media_id, media_type, status, added_at, title) values (1, 'cinemeta', 903747, 'series', 'planned', 1, 'Breaking Bad')").run();
  d.prepare("insert into progress (profile_id, via, media_id, media_type, unit, anchor, updated_at) values (1, 'tmdb-tv', 1396, 'series', 4, null, 3)").run();
  markActivity(1, "series", { unit: true, night: false });
  updateProfileSettings(1, { hidden_kinds: ["movie", "series"] });
  const backup = profileBackup(1);
  // Rewrite it as the previous release wrote it: the kind was "drama", and so was the activity column.
  (backup.data.settings as { hidden_kinds: string }).hidden_kinds = "movie,drama";
  for (const row of backup.data.library as Record<string, unknown>[]) row.media_type = "drama";
  for (const row of backup.data.progress as Record<string, unknown>[]) row.media_type = "drama";
  for (const row of backup.data.activity as Record<string, unknown>[]) { row.drama = row.series; delete row.series; }

  clearProfile();
  restoreProfile(1, backup);

  assert.deepEqual(profileSettings(1).hidden_kinds, ["movie", "series"]);
  assert.equal((d.prepare("select hidden_kinds from profile_settings where profile_id = 1").get() as { hidden_kinds: string }).hidden_kinds, "movie,series");
  assert.equal(loadActivity(1)[0].series, 1);
  const kinds = [
    ...d.prepare("select media_type from library where profile_id = 1").all(),
    ...d.prepare("select media_type from progress where profile_id = 1").all(),
  ].map((r) => (r as { media_type: string }).media_type);
  assert.deepEqual(kinds, ["series", "series"]);
});

test("a backup naming an unknown category or provider is refused, not half restored", () => {
  clearProfile();
  updateProfileSettings(1, { caption_scale: 1 });
  const backup = profileBackup(1);
  const bad = structuredClone(backup);
  (bad.data.settings as Record<string, unknown>) = { ...(backup.data.settings as object), hidden_kinds: "movie,podcast" };
  assert.throws(() => restoreProfile(1, bad), /hidden categories/);
  const badVia = structuredClone(backup);
  badVia.data.library = [{ via: "imdb", media_id: 1, media_type: "movie", status: "planned", score: null, added_at: 1, title: null, cover: null, color: null, units: null, genres: "[]", pin: 0 }];
  assert.throws(() => restoreProfile(1, badVia), /metadata provider/);
});

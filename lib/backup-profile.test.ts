import assert from "node:assert/strict";
import { test } from "node:test";

process.env.LACRIMA_DB = ":memory:";
const { db } = await import("./db.ts");
const { profileBackup, restoreProfile } = await import("./backup.ts");
const { profileSettings, subtitleChoice, updateProfileSettings, updateSubtitleChoice } = await import("./settings.ts");
const { stickerFace } = await import("./stickers.ts");

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

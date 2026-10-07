import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, migrate, plain, plainAll } from "./db.ts";

const columns = (d: DatabaseSync, table: string) =>
  (d.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const version = (d: DatabaseSync) => (d.prepare("pragma user_version").get() as { user_version: number }).user_version;

/**
 * node:sqlite rows have a null prototype. React refuses to serialise those into
 * a client component's props or a server action's closure, which took down the
 * whole title page once. This is the guard.
 */
test("rows leaving the db layer have a real prototype", () => {
  const row = Object.assign(Object.create(null), { a: 1, b: "x" });
  assert.equal(Object.getPrototypeOf(row), null);

  const p = plain(row);
  assert.equal(Object.getPrototypeOf(p), Object.prototype);
  assert.deepEqual({ ...p }, { a: 1, b: "x" });

  assert.ok(plainAll([row]).every((r) => Object.getPrototypeOf(r) === Object.prototype));
});

test("a fresh database migrates to the latest version with the category columns", () => {
  const d = new DatabaseSync(":memory:");
  migrate(d);
  assert.equal(version(d), MIGRATIONS.length);
  assert.ok(MIGRATIONS.length >= 19);
  assert.ok(columns(d, "profile_settings").includes("hidden_kinds"));
  assert.ok(columns(d, "activity").includes("movie") && columns(d, "activity").includes("series"));
});

test("a v17 database migrates to 18 keeping its rows, with nothing hidden", () => {
  const d = new DatabaseSync(":memory:");
  for (const sql of MIGRATIONS.slice(0, 17)) d.exec(sql);
  d.exec("pragma user_version = 17");
  d.exec("insert into profiles (id, name, avatar_color, accent, created_at) values (1, 'A', '#630E19', '#630E19', 1)");
  d.exec("insert into profile_settings (profile_id, caption_scale) values (1, 1.4)");
  d.exec("insert into activity (profile_id, day, anime, manga, novel, night) values (1, '2026-09-14', 5, 2, 1, 3)");
  assert.ok(!columns(d, "profile_settings").includes("hidden_kinds"));

  migrate(d);

  assert.equal(version(d), MIGRATIONS.length);
  assert.deepEqual({ ...(d.prepare("select caption_scale, hidden_kinds from profile_settings").get() as object) }, { caption_scale: 1.4, hidden_kinds: "" });
  assert.deepEqual(
    { ...(d.prepare("select anime, manga, novel, movie, drama, night from activity").get() as object) },
    { anime: 5, manga: 2, novel: 1, movie: 0, drama: 0, night: 3 },
  );
});

test("a v18 database with drama rows migrates to v19 as series", () => {
  const d = new DatabaseSync(":memory:");
  for (const sql of MIGRATIONS.slice(0, 18)) d.exec(sql);
  d.exec("pragma user_version = 18");
  for (const id of [1, 2, 3, 4]) d.exec(`insert into profiles (id, name, avatar_color, accent, created_at) values (${id}, 'P${id}', '#630E19', '#630E19', 1)`);
  const lib = d.prepare("insert into library (profile_id, via, media_id, media_type, status, added_at) values (1, ?, ?, ?, 'planned', 1)");
  lib.run("cinemeta", 903747, "drama");
  lib.run("tmdb-tv", 1396, "drama");
  lib.run("tmdb-movie", 949, "movie");
  lib.run("anilist", 42, "anime");
  const prog = d.prepare("insert into progress (profile_id, via, media_id, media_type, unit, updated_at) values (1, ?, ?, ?, 4, 2)");
  prog.run("cinemeta", 903747, "drama");
  prog.run("kitsu", 7442, "anime");
  const bind = d.prepare("insert into source_bindings (via, media_id, source_id, source_title, source_manga_id, confidence, bound_at, kind) values (?, ?, 'x', 'X', 'imdb::series:tt0903747', 1, 1, ?)");
  bind.run("cinemeta", 903747, "drama");
  bind.run("kitsu", 7442, "anime");
  const settings = d.prepare("insert into profile_settings (profile_id, hidden_kinds) values (?, ?)");
  settings.run(1, "movie,drama");
  settings.run(2, "drama");
  settings.run(3, "anime,movie");
  settings.run(4, "drama,series");
  d.exec("insert into activity (profile_id, day, anime, manga, novel, movie, drama, night) values (1, '2026-09-14', 5, 2, 1, 1, 7, 3)");

  migrate(d);

  assert.equal(version(d), MIGRATIONS.length);
  const col = (sql: string) => (d.prepare(sql).all() as { v: string }[]).map((r) => r.v);
  assert.deepEqual(col("select media_type as v from library order by id"), ["series", "series", "movie", "anime"]);
  assert.deepEqual(col("select media_type as v from progress order by id"), ["series", "anime"]);
  assert.deepEqual(col("select kind as v from source_bindings order by media_id"), ["anime", "series"]);
  assert.deepEqual(col("select hidden_kinds as v from profile_settings order by profile_id"), ["movie,series", "series", "anime,movie", "series"]);
  // The old column stays; its count moves to the new one.
  assert.deepEqual(
    { ...(d.prepare("select anime, manga, novel, movie, drama, series, night from activity").get() as object) },
    { anime: 5, manga: 2, novel: 1, movie: 1, drama: 7, series: 7, night: 3 },
  );
  // Running it again is a no-op: the version has moved past it.
  migrate(d);
  assert.deepEqual(col("select media_type as v from library order by id"), ["series", "series", "movie", "anime"]);
});

test("a migration that fails halfway leaves no trace and the version where it was", () => {
  const d = new DatabaseSync(":memory:");
  migrate(d);
  const at = version(d);
  // The second statement dies (profiles already has `name`) after the first has run.
  const broken = [...MIGRATIONS, "create table half_done (a integer); alter table profiles add column name text;"];
  assert.throws(() => migrate(d, broken), /duplicate column/);
  assert.equal(version(d), at);
  assert.equal(d.prepare("select count(*) as n from sqlite_master where name = 'half_done'").get()?.n, 0);
  // Not left inside the failed transaction: the connection is usable and migrates on retry.
  migrate(d, [...MIGRATIONS, "create table half_done (a integer);"]);
  assert.equal(version(d), at + 1);
});

test("two connections opening a database at the same version migrate once, in turn", () => {
  const dir = mkdtempSync(join(tmpdir(), "lacrima-db-"));
  const file = join(dir, "t.db");
  try {
    const a = new DatabaseSync(file);
    const b = new DatabaseSync(file);
    for (const d of [a, b]) d.exec("pragma busy_timeout = 2000");
    // Both opened before either migrated, as two server processes would be.
    migrate(a);
    migrate(b);
    assert.equal(version(b), MIGRATIONS.length);
    assert.equal(b.prepare("select count(*) as n from profiles").get()?.n, 2);
    a.close();
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

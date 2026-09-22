import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const FILE = process.env.LACRIMA_DB ?? "./data/lacrima.db";

// ponytail: one process-wide sync handle. Fine for a household-sized LAN app;
// move to a pool or WAL-aware wrapper if concurrent writes ever contend.
let handle: DatabaseSync | undefined;

export function db(): DatabaseSync {
  if (handle) return handle;
  mkdirSync(dirname(FILE), { recursive: true });
  handle = new DatabaseSync(FILE);
  handle.exec("pragma journal_mode = wal");
  handle.exec("pragma foreign_keys = on");
  migrate(handle);
  return handle;
}

/**
 * Ordered and append-only; `pragma user_version` records how far we've run.
 * Never edit a shipped migration — add a new one. The dev server holds the file
 * open, so "delete the database" is not an available fix.
 *
 * Data rule 1 (CLAUDE.md): profile_id on every row that belongs to a person.
 * source_bindings is deliberately NOT scoped to a profile — which source carries
 * a title is a fact about the world, not about a user.
 */
const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
    create table if not exists profiles (
      id            integer primary key autoincrement,
      name          text    not null,
      avatar_color  text    not null,
      accent        text    not null,
      wallpaper     text,
      created_at    integer not null
    );

    create table if not exists profile_genres (
      profile_id integer not null references profiles(id) on delete cascade,
      genre      text    not null,
      weight     real    not null default 1,
      primary key (profile_id, genre)
    );

    create table if not exists library (
      id         integer primary key autoincrement,
      profile_id integer not null references profiles(id) on delete cascade,
      media_id   integer not null,
      media_type text    not null,
      status     text    not null,
      score      integer,
      added_at   integer not null,
      unique (profile_id, media_id)
    );

    create table if not exists progress (
      id         integer primary key autoincrement,
      profile_id integer not null references profiles(id) on delete cascade,
      media_id   integer not null,
      media_type text    not null,
      unit       integer not null,
      anchor     text,
      updated_at integer not null,
      unique (profile_id, media_id)
    );

    create table if not exists source_bindings (
      media_id     integer primary key,
      source_id    text    not null,
      source_title text    not null,
      confidence   real    not null,
      bound_at     integer not null
    );
  `,

  // 2 — bindings need the backend-local manga id, plus a flag for hand-picked matches
  `
    alter table source_bindings add column source_manga_id integer not null default 0;
    alter table source_bindings add column pinned integer not null default 0;
  `,

  // 3 — media ids are only unique WITHIN a provider (Kitsu 7442 != AniList 7442),
  //     so every reference to one carries `via`. Rebuilt rather than altered
  //     because SQLite cannot change a key constraint in place.
  `
    create table library_new (
      id         integer primary key autoincrement,
      profile_id integer not null references profiles(id) on delete cascade,
      via        text    not null,
      media_id   integer not null,
      media_type text    not null,
      status     text    not null,
      score      integer,
      added_at   integer not null,
      unique (profile_id, via, media_id)
    );
    insert into library_new (id, profile_id, via, media_id, media_type, status, score, added_at)
      select id, profile_id, 'anilist', media_id, media_type, status, score, added_at from library;
    drop table library;
    alter table library_new rename to library;

    create table progress_new (
      id         integer primary key autoincrement,
      profile_id integer not null references profiles(id) on delete cascade,
      via        text    not null,
      media_id   integer not null,
      media_type text    not null,
      unit       integer not null,
      anchor     text,
      updated_at integer not null,
      unique (profile_id, via, media_id)
    );
    insert into progress_new (id, profile_id, via, media_id, media_type, unit, anchor, updated_at)
      select id, profile_id, 'anilist', media_id, media_type, unit, anchor, updated_at from progress;
    drop table progress;
    alter table progress_new rename to progress;

    create table source_bindings_new (
      via             text    not null,
      media_id        integer not null,
      source_id       text    not null,
      source_title    text    not null,
      source_manga_id integer not null,
      confidence      real    not null,
      bound_at        integer not null,
      pinned          integer not null default 0,
      primary key (via, media_id)
    );
    insert into source_bindings_new
      select 'anilist', media_id, source_id, source_title, source_manga_id, confidence, bound_at, pinned
      from source_bindings;
    drop table source_bindings;
    alter table source_bindings_new rename to source_bindings;
  `,

  // 4 — Continue is a rail on Home, so it must render from one local read.
  //     Denormalising the title and cover keeps it working while every metadata
  //     provider is down, which is the whole point of owning progress locally.
  `
    alter table progress add column title text;
    alter table progress add column cover text;
  `,

  // 5 — bindings must survive non-Suwayomi ids (plugin paths, addon ids) and
  //     remember which backend/kind minted them so anime never searches manga.
  `
    create table source_bindings_new (
      via             text    not null,
      media_id        integer not null,
      source_id       text    not null,
      source_title    text    not null,
      source_manga_id text    not null,
      confidence      real    not null,
      bound_at        integer not null,
      pinned          integer not null default 0,
      backend         text    not null default 'suwayomi',
      kind            text    not null default 'manga',
      primary key (via, media_id)
    );
    insert into source_bindings_new
      (via, media_id, source_id, source_title, source_manga_id, confidence, bound_at, pinned, backend, kind)
      select via, media_id, source_id, source_title, cast(source_manga_id as text),
             confidence, bound_at, pinned, 'suwayomi', 'manga'
      from source_bindings;
    drop table source_bindings;
    alter table source_bindings_new rename to source_bindings;

    create table source_repos (
      index_url text    primary key,
      kind      text    not null,
      name      text,
      added_at  integer not null
    );

    create table source_plugins (
      id         text    not null,
      kind       text    not null,
      repo_url   text    not null,
      name       text    not null,
      lang       text    not null,
      version    text    not null,
      icon_url   text,
      plugin_url text,
      installed  integer not null default 0,
      primary key (id, kind)
    );
  `,

  // 6 — a source can stay installed and still be switched off (MangaDex's 61
  //     language forks, a broken anime addon) without tearing the repo down.
  `
    create table source_disabled (
      kind text not null,
      id   text not null,
      primary key (kind, id)
    );
  `,

  // 7 — subtitle placement belongs to a profile and must follow it between devices.
  `
    alter table profiles add column caption_x real not null default 50;
    alter table profiles add column caption_y real not null default 90;
  `,

  // 8 — playback defaults and provider history are profile data, not browser data.
  `
    create table profile_settings (
      profile_id       integer primary key references profiles(id) on delete cascade,
      audio_lang       text not null default 'ja',
      subtitle_lang    text not null default 'auto',
      caption_scale    real not null default 1,
      reader_mode      text not null default 'paged',
      reader_rtl       integer not null default 1,
      reader_fit       text not null default 'height',
      reader_spread    text not null default 'single'
    );

    create table provider_choices (
      id         integer primary key autoincrement,
      profile_id integer not null references profiles(id) on delete cascade,
      provider   text not null,
      chosen_at  integer not null
    );
    create index provider_choices_profile_time on provider_choices(profile_id, chosen_at desc);
  `,

  // 9 — replace the old rust default without overwriting anyone's custom accent.
  `
    update profiles set accent = '#630E19' where accent = '#c44532';
  `,

  // 10 — Yours owns the library grid, so the row must render without metadata.
  //     Pins, characters, stickers and daily activity are per-profile identity.
  `
    alter table library add column title text;
    alter table library add column cover text;
    alter table library add column color text;
    alter table library add column units integer;
    alter table library add column genres text not null default '[]';
    alter table library add column pin integer not null default 0;

    create table if not exists activity (
      profile_id integer not null references profiles(id) on delete cascade,
      day        text    not null,
      anime      integer not null default 0,
      manga      integer not null default 0,
      novel      integer not null default 0,
      night      integer not null default 0,
      primary key (profile_id, day)
    );

    create table if not exists profile_characters (
      profile_id   integer not null references profiles(id) on delete cascade,
      via          text    not null,
      character_id integer not null,
      name         text    not null,
      image        text,
      sort         integer not null default 0,
      primary key (profile_id, via, character_id)
    );

    create table if not exists stickers (
      profile_id integer not null references profiles(id) on delete cascade,
      sticker_id text    not null,
      earned_at  integer,
      x          real,
      y          real,
      rot        real    not null default 0,
      surface    text,
      primary key (profile_id, sticker_id)
    );
  `,

  // 11 — placeholder emoji stickers and favourite-character rows were a first pass.
  //     Stickers are characters earned by watching; those rows are not that.
  `
    delete from stickers;
    delete from profile_characters;
  `,

  // 12 — watch time is accumulated seconds, not episode-count × 24 minutes.
  //     Sticker pools cache character/secret art URLs per title.
  `
    alter table progress add column watched_seconds integer not null default 0;

    create table if not exists sticker_pools (
      via        text    not null,
      media_id   integer not null,
      payload    text    not null,
      fetched_at integer not null,
      primary key (via, media_id)
    );

    create table if not exists sticker_art (
      hash text primary key,
      url  text not null,
      mime text
    );
  `,

  // 13 — page decorations: the same earned sticker can live on many routes.
  `
    create table if not exists sticker_placements (
      id         integer primary key autoincrement,
      profile_id integer not null references profiles(id) on delete cascade,
      sticker_id text    not null,
      path       text    not null,
      x          real    not null,
      y          real    not null,
      scale      real    not null default 1
    );
    create index if not exists sticker_placements_page on sticker_placements (profile_id, path);
  `,

  // 14 — rotation while a placed sticker is held in edit mode.
  `alter table sticker_placements add column rot real not null default 0;`,

  // 15 — phone and desktop decorations are separate; same breakpoint as the rail.
  `alter table sticker_placements add column surface text not null default 'desktop';`,

  // 16 — update policy is server-wide, not a profile preference. The companion
  //      updater is deliberately the only process that can pull and restart.
  `
    create table if not exists app_updates (
      singleton          integer primary key check (singleton = 1),
      auto_update        integer not null default 0,
      update_time        text not null default '03:00',
      requested_at       integer,
      last_checked_at    integer,
      latest_tag         text,
      latest_name        text,
      latest_url         text,
      latest_published_at integer,
      last_applied_tag   text,
      last_updated_at    integer,
      last_auto_day      text,
      last_status        text,
      updater_heartbeat  integer
    );
    insert or ignore into app_updates (singleton) values (1);
  `,
]

function migrate(d: DatabaseSync) {
  const { user_version: at } = d.prepare("pragma user_version").get() as {
    user_version: number;
  };

  for (let v = at; v < MIGRATIONS.length; v++) {
    d.exec(MIGRATIONS[v]);
    d.exec(`pragma user_version = ${v + 1}`);
  }

  const { n } = d.prepare("select count(*) as n from profiles").get() as { n: number };
  if (n === 0) seed(d);
}

/**
 * `node:sqlite` hands back null-prototype rows. React refuses to serialise those
 * — into client-component props OR into a server action's closure — with "Only
 * plain objects... can be passed to Client Components". Every row that leaves
 * this layer goes through here, so no caller has to remember.
 */
export const plain = <T extends object>(row: T): T => ({ ...row });
export const plainAll = <T extends object>(rows: T[]): T[] => rows.map(plain);

/** Data rule 3 (CLAUDE.md): anchors are portable across devices. */
export type Anchor =
  | {
      kind: "seconds";
      at: number;
      chapterId: string;
      chapterName: string;
      /** Episode length when known, so Continue can show time left. */
      duration?: number;
      season?: number;
      episode?: number;
    }
  /** `chapterId` is the source's, shared by every device pointing at this server. */
  | {
      kind: "page";
      index: number;
      chapterId: number | string;
      chapterName: string;
      pages?: number;
    }
  | { kind: "paragraph"; cfi: string; chapterId?: string | number; chapterName?: string };

function seed(d: DatabaseSync) {
  const now = Date.now();
  const insert = d.prepare(
    "insert into profiles (name, avatar_color, accent, created_at) values (?, ?, ?, ?)",
  );
  const genre = d.prepare(
    "insert into profile_genres (profile_id, genre, weight) values (?, ?, ?)",
  );

  const people: [string, string, string, string[]][] = [
    ["Luka", "#630E19", "#630E19", ["Adventure", "Drama", "Fantasy"]],
    ["Guest", "#e8c56b", "#630E19", ["Comedy", "Slice of Life"]],
  ];

  for (const [name, avatar, accent, genres] of people) {
    const id = Number(insert.run(name, avatar, accent, now).lastInsertRowid);
    genres.forEach((g, i) => genre.run(id, g, 1 - i * 0.1));
  }
}

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
];

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
    }
  /** `chapterId` is the source's, shared by every device pointing at this server. */
  | {
      kind: "page";
      index: number;
      chapterId: number | string;
      chapterName: string;
      pages?: number;
    }
  | { kind: "paragraph"; cfi: string };

function seed(d: DatabaseSync) {
  const now = Date.now();
  const insert = d.prepare(
    "insert into profiles (name, avatar_color, accent, created_at) values (?, ?, ?, ?)",
  );
  const genre = d.prepare(
    "insert into profile_genres (profile_id, genre, weight) values (?, ?, ?)",
  );

  const people: [string, string, string, string[]][] = [
    ["Luka", "#c44532", "#c44532", ["Adventure", "Drama", "Fantasy"]],
    ["Guest", "#e8c56b", "#c44532", ["Comedy", "Slice of Life"]],
  ];

  for (const [name, avatar, accent, genres] of people) {
    const id = Number(insert.run(name, avatar, accent, now).lastInsertRowid);
    genres.forEach((g, i) => genre.run(id, g, 1 - i * 0.1));
  }
}

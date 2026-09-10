import { db, plain, plainAll } from "../db.ts";
import type { MediaKind } from "../media.ts";

export type StoredRepo = {
  index_url: string;
  kind: MediaKind;
  name: string | null;
  added_at: number;
};

export type StoredPlugin = {
  id: string;
  kind: MediaKind;
  repo_url: string;
  name: string;
  lang: string;
  version: string;
  icon_url: string | null;
  plugin_url: string | null;
  installed: number;
};

export function listStoredRepos(kind: MediaKind): StoredRepo[] {
  return plainAll(
    db()
      .prepare("select * from source_repos where kind = ? order by added_at")
      .all(kind) as StoredRepo[],
  );
}

export function addStoredRepo(indexUrl: string, kind: MediaKind, name: string | null) {
  db()
    .prepare(
      "insert or replace into source_repos (index_url, kind, name, added_at) values (?, ?, ?, ?)",
    )
    .run(indexUrl, kind, name, Date.now());
}

export function removeStoredRepo(indexUrl: string, kind: MediaKind) {
  const d = db();
  d.prepare("delete from source_plugins where repo_url = ? and kind = ?").run(indexUrl, kind);
  d.prepare("delete from source_repos where index_url = ? and kind = ?").run(indexUrl, kind);
}

export function listStoredPlugins(kind: MediaKind): StoredPlugin[] {
  return plainAll(
    db().prepare("select * from source_plugins where kind = ?").all(kind) as StoredPlugin[],
  );
}

export function upsertPlugin(p: Omit<StoredPlugin, "installed"> & { installed?: number }) {
  db()
    .prepare(
      `insert into source_plugins
         (id, kind, repo_url, name, lang, version, icon_url, plugin_url, installed)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id, kind) do update set
         repo_url = excluded.repo_url,
         name = excluded.name,
         lang = excluded.lang,
         version = excluded.version,
         icon_url = excluded.icon_url,
         plugin_url = excluded.plugin_url,
         installed = source_plugins.installed`,
    )
    .run(
      p.id,
      p.kind,
      p.repo_url,
      p.name,
      p.lang,
      p.version,
      p.icon_url,
      p.plugin_url,
      p.installed ?? 0,
    );
}

export function setPluginInstalled(id: string, kind: MediaKind, installed: boolean) {
  db()
    .prepare("update source_plugins set installed = ? where id = ? and kind = ?")
    .run(installed ? 1 : 0, id, kind);
}

export function getPlugin(id: string, kind: MediaKind): StoredPlugin | undefined {
  const row = db()
    .prepare("select * from source_plugins where id = ? and kind = ?")
    .get(id, kind) as StoredPlugin | undefined;
  return row && plain(row);
}

export function isSourceDisabled(kind: MediaKind, id: string): boolean {
  return Boolean(
    db().prepare("select 1 from source_disabled where kind = ? and id = ?").get(kind, id),
  );
}

export function setSourceDisabled(kind: MediaKind, id: string, disabled: boolean) {
  const d = db();
  if (disabled) d.prepare("insert or ignore into source_disabled (kind, id) values (?, ?)").run(kind, id);
  else d.prepare("delete from source_disabled where kind = ? and id = ?").run(kind, id);
}

export function disabledIds(kind: MediaKind): Set<string> {
  return new Set(
    plainAll(
      db().prepare("select id from source_disabled where kind = ?").all(kind) as { id: string }[],
    ).map((r) => r.id),
  );
}

import { Err, Ok, type Result } from "../result.ts";
import type { Extension, Repo, SourceBackend, SourceChapter, SourceInfo, SourceManga } from "./types.ts";
import {
  addStoredRepo,
  getPlugin,
  listStoredPlugins,
  listStoredRepos,
  removeStoredRepo,
  setPluginInstalled,
  upsertPlugin,
} from "./store.ts";
import { chapterHasText, collectNovelChapters, dropPlugin, loadPlugin } from "./plugin-host.ts";

function split(id: string): [string, string] {
  const i = id.indexOf("::");
  return i < 0 ? ["", id] : [id.slice(0, i), id.slice(i + 2)];
}

type ManifestPlugin = {
  id: string;
  name: string;
  lang?: string;
  version?: string;
  url?: string;
  iconUrl?: string;
};

async function pull(indexUrl: string): Promise<Result<number>> {
  try {
    const res = await fetch(indexUrl, { cache: "no-store" });
    if (!res.ok) return Err(`Plugin repo returned ${res.status}.`);
    const json = (await res.json()) as ManifestPlugin[] | { plugins?: ManifestPlugin[] };
    const plugins = Array.isArray(json) ? json : (json.plugins ?? []);
    for (const p of plugins) {
      if (!p.id || !p.name) continue;
      upsertPlugin({
        id: p.id,
        kind: "novel",
        repo_url: indexUrl,
        name: p.name,
        lang: p.lang ?? "en",
        version: p.version ?? "0",
        icon_url: p.iconUrl ?? null,
        plugin_url: p.url ?? null,
      });
    }
    return Ok(plugins.length);
  } catch (e) {
    return Err(e instanceof Error ? e.message : "Could not read the plugin repository.");
  }
}

export const lnreader: SourceBackend = {
  name: "LNReader",
  kind: "novel",

  async listSources() {
    const installed = listStoredPlugins("novel").filter((p) => p.installed);
    return Ok(
      installed.map(
        (p): SourceInfo => ({
          id: p.id,
          name: p.name,
          lang: p.lang,
          iconUrl: p.icon_url,
          kind: "novel",
          isLocal: false,
        }),
      ),
    );
  },

  async search(sourceId, query) {
    const p = getPlugin(sourceId, "novel");
    if (!p?.plugin_url) return Err(`Plugin ${sourceId} is not installed.`);
    try {
      const plugin = await loadPlugin(p.id, p.plugin_url);
      const rows = await plugin.searchNovels(query, 1);
      return Ok(
        (rows ?? []).map(
          (n): SourceManga => ({
            id: `${sourceId}::${n.path}`,
            sourceId,
            sourceName: p.name,
            title: n.name,
            thumbnailUrl: n.cover ?? null,
            chapterCount: null,
          }),
        ),
      );
    } catch (e) {
      return Err(e instanceof Error ? e.message : `Plugin ${p.name} failed to search.`);
    }
  },

  async chapters(mangaId) {
    const [sourceId, path] = split(mangaId);
    const p = getPlugin(sourceId, "novel");
    if (!p?.plugin_url) return Err("That novel plugin is not installed.");
    if (!path) return Err("That novel binding has no source path.");
    try {
      const plugin = await loadPlugin(p.id, p.plugin_url);
      const rows = await collectNovelChapters(plugin, path);
      return Ok(
        rows.map(
          (c, i): SourceChapter => ({
            id: `${sourceId}::${c.path}`,
            number: c.chapterNumber ?? i + 1,
            name: c.name,
            scanlator: p.name,
            uploadDate: null,
            pageCount: 1,
          }),
        ),
      );
    } catch (e) {
      return Err(e instanceof Error ? e.message : `Plugin ${p.name} failed to list chapters.`);
    }
  },

  async pages(chapterId) {
    const [sourceId, path] = split(chapterId);
    const p = getPlugin(sourceId, "novel");
    if (!p?.plugin_url) return Err("That novel plugin is not installed.");
    if (!path) return Err("That chapter has no source path.");
    try {
      const plugin = await loadPlugin(p.id, p.plugin_url);
      const html = await plugin.parseChapter(path);
      if (!chapterHasText(html)) {
        return Err(
          "The plugin returned an empty chapter. The site may be blocking the request, or this chapter path is stale — try Refresh on the title page, or another source.",
        );
      }
      return Ok([typeof html === "string" ? html : String(html)]);
    } catch (e) {
      return Err(e instanceof Error ? e.message : `Plugin ${p.name} failed to fetch the chapter.`);
    }
  },

  async listRepos() {
    return Ok(
      listStoredRepos("novel").map(
        (r): Repo => ({
          indexUrl: r.index_url,
          name: r.name,
          kind: "novel",
          isLegacy: true,
          extensionCount: listStoredPlugins("novel").filter((p) => p.repo_url === r.index_url)
            .length,
        }),
      ),
    );
  },

  async addRepo(indexUrl) {
    addStoredRepo(indexUrl, "novel", "LNReader");
    const pulled = await pull(indexUrl);
    if (!pulled.ok) {
      removeStoredRepo(indexUrl, "novel");
      return pulled;
    }
    return Ok(true as const);
  },

  async removeRepo(indexUrl) {
    for (const p of listStoredPlugins("novel").filter((x) => x.repo_url === indexUrl)) {
      dropPlugin(p.id);
    }
    removeStoredRepo(indexUrl, "novel");
    return Ok(true as const);
  },

  async refreshExtensions() {
    const repos = listStoredRepos("novel");
    let n = 0;
    for (const r of repos) {
      const pulled = await pull(r.index_url);
      if (pulled.ok) n += pulled.value;
      else return pulled;
    }
    return Ok(n);
  },

  async listExtensions(query: string) {
    const q = query.toLowerCase();
    return Ok(
      listStoredPlugins("novel")
        .filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
        .map(
          (p): Extension => ({
            pkgName: p.id,
            name: p.name,
            lang: p.lang,
            version: p.version,
            iconUrl: p.icon_url,
            isInstalled: Boolean(p.installed),
            hasUpdate: false,
            kind: "novel",
          }),
        ),
    );
  },

  async setExtensionInstalled(pkgName, install) {
    setPluginInstalled(pkgName, "novel", install);
    if (!install) dropPlugin(pkgName);
    return Ok(true as const);
  },
};

import { Err, Ok, type Result } from "../result.ts";
import type {
  Extension,
  Repo,
  SourceBackend,
  SourceChapter,
  SourceInfo,
  SourceManga,
} from "./types.ts";

const BASE = process.env.SUWAYOMI_URL ?? "http://localhost:4567";

function tidy(msg: string): string {
  if (/no chapters found/i.test(msg)) return "This source has no chapters for that title.";
  if (msg.includes("java.lang") || msg.includes("\tat ")) {
    return "The manga source failed. Try another match, or refresh.";
  }
  return msg;
}

const ENDPOINT = `${BASE}/api/graphql`;

/** Suwayomi's built-in local-files source, present even with zero repos added. */
export const LOCAL_SOURCE_ID = "0";

export const suwayomiBase = () => BASE;

async function gql<T>(query: string, variables?: object, ms = 2_500): Promise<Result<T>> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: AbortSignal.timeout(ms),
    });
    if (!res.ok) return Err(`Suwayomi returned ${res.status}.`);

    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) return Err(tidy(json.errors[0].message));
    if (!json.data) return Err("Suwayomi returned no data.");
    return Ok(json.data);
  } catch {
    return Err(`Can't reach Suwayomi at ${BASE}. Is the container running?`);
  }
}

/** Suwayomi serves source images itself, already signed with the right headers. */
export const imageUrl = (path: string) =>
  path.startsWith("http") ? path : `${BASE}${path}`;

type RawChapter = {
  id: number;
  chapterNumber: number;
  name: string;
  scanlator: string | null;
  uploadDate: string | null;
  pageCount: number | null;
};

const shapeChapter = (c: RawChapter): SourceChapter => ({
  id: String(c.id),
  number: c.chapterNumber,
  name: c.name,
  scanlator: c.scanlator,
  uploadDate: c.uploadDate ? Number(c.uploadDate) : null,
  // Suwayomi reports -1 until the chapter's pages have been fetched.
  pageCount: c.pageCount && c.pageCount > 0 ? c.pageCount : null,
});

export const suwayomi: SourceBackend = {
  name: "Suwayomi",
  kind: "manga",

  async listSources() {
    const r = await gql<{
      sources: { nodes: Omit<SourceInfo, "isLocal" | "kind">[] };
    }>(`{ sources { nodes { id name lang iconUrl } } }`);
    if (!r.ok) return r;

    return Ok(
      r.value.sources.nodes.map(
        (s): SourceInfo => ({
          ...s,
          id: String(s.id),
          kind: "manga",
          isLocal: String(s.id) === LOCAL_SOURCE_ID,
        }),
      ),
    );
  },

  async search(sourceId, query) {
    const r = await gql<{
      fetchSourceManga: {
        mangas: {
          id: number;
          title: string;
          thumbnailUrl: string | null;
          source: { id: string; displayName: string } | null;
          chapters: { totalCount: number } | null;
        }[];
      };
    }>(
      `mutation Search($source: LongString!, $query: String!) {
         fetchSourceManga(input: { source: $source, type: SEARCH, query: $query, page: 1 }) {
           mangas {
             id title thumbnailUrl
             source { id displayName }
             chapters { totalCount }
           }
         }
       }`,
      { source: sourceId, query },
      60_000,
    );
    if (!r.ok) return r;

    return Ok(
      r.value.fetchSourceManga.mangas.map(
        (m): SourceManga => ({
          id: String(m.id),
          sourceId: m.source?.id ?? sourceId,
          sourceName: m.source?.displayName ?? "Unknown source",
          title: m.title,
          thumbnailUrl: m.thumbnailUrl,
          chapterCount: m.chapters?.totalCount ?? null,
        }),
      ),
    );
  },

  async chapters(mangaId, refresh = false) {
    const id = Number(mangaId);
    // `fetchChapters` is a mutation: it hits the source over the network every
    // time. Opening a chapter must not re-scrape the whole chapter list, so read
    // Suwayomi's cache first and only go out when there is nothing there.
    if (!refresh) {
      const cached = await gql<{ chapters: { nodes: RawChapter[] } }>(
        `query Cached($mangaId: Int!) {
           chapters(condition: { mangaId: $mangaId }, orderBy: SOURCE_ORDER) {
             nodes { id chapterNumber name scanlator uploadDate pageCount }
           }
         }`,
        { mangaId: id },
      );
      if (cached.ok && cached.value.chapters.nodes.length > 0) {
        return Ok(cached.value.chapters.nodes.map(shapeChapter));
      }
    }

    const r = await gql<{ fetchChapters: { chapters: RawChapter[] } }>(
      `mutation Chapters($mangaId: Int!) {
         fetchChapters(input: { mangaId: $mangaId }) {
           chapters { id chapterNumber name scanlator uploadDate pageCount }
         }
       }`,
      { mangaId: id },
      60_000,
    );
    return r.ok ? Ok(r.value.fetchChapters.chapters.map(shapeChapter)) : r;
  },

  async pages(chapterId) {
    const r = await gql<{ fetchChapterPages: { pages: string[] } }>(
      `mutation Pages($chapterId: Int!) {
         fetchChapterPages(input: { chapterId: $chapterId }) { pages }
       }`,
      { chapterId: Number(chapterId) },
      60_000,
    );
    return r.ok ? Ok(r.value.fetchChapterPages.pages.map(imageUrl)) : r;
  },

  async listRepos() {
    const r = await gql<{
      extensionStores: {
        nodes: {
          indexUrl: string;
          name: string | null;
          isLegacy: boolean;
          extensions: { totalCount: number };
        }[];
      };
    }>(`{ extensionStores { nodes { indexUrl name isLegacy extensions { totalCount } } } }`);
    if (!r.ok) return r;

    return Ok(
      r.value.extensionStores.nodes.map(
        (s): Repo => ({
          indexUrl: s.indexUrl,
          name: s.name,
          kind: "manga",
          isLegacy: s.isLegacy,
          extensionCount: s.extensions.totalCount,
        }),
      ),
    );
  },

  async refreshExtensions() {
    const r = await gql<{ fetchExtensions: { extensions: { pkgName: string }[] } }>(
      `mutation { fetchExtensions(input: {}) { extensions { pkgName } } }`,
      undefined,
      60_000,
    );
    return r.ok ? Ok(r.value.fetchExtensions.extensions.length) : r;
  },

  async listExtensions(query: string) {
    const r = await gql<{
      extensions: {
        nodes: {
          pkgName: string;
          name: string;
          lang: string;
          versionName: string;
          iconUrl: string | null;
          isInstalled: boolean;
          hasUpdate: boolean;
        }[];
      };
    }>(
      `query Ext($q: String!) {
         extensions(filter: { name: { likeInsensitive: $q } }, orderBy: NAME) {
           nodes { pkgName name lang versionName iconUrl isInstalled hasUpdate }
         }
       }`,
      { q: `%${query}%` },
    );
    if (!r.ok) return r;

    return Ok(
      r.value.extensions.nodes.map(
          (e): Extension => ({
            pkgName: e.pkgName,
            name: e.name,
            lang: e.lang,
            version: e.versionName,
            iconUrl: e.iconUrl ? imageUrl(e.iconUrl) : null,
            isInstalled: e.isInstalled,
            hasUpdate: e.hasUpdate,
            kind: "manga",
          }),
      ),
    );
  },

  async setExtensionInstalled(pkgName, install) {
    const r = await gql(
      `mutation Install($id: String!, $install: Boolean!, $uninstall: Boolean!) {
         updateExtension(input: { id: $id, patch: { install: $install, uninstall: $uninstall } }) {
           extension { pkgName isInstalled }
         }
       }`,
      { id: pkgName, install, uninstall: !install },
      15_000,
    );
    return r.ok ? Ok(true as const) : r;
  },

  async addRepo(indexUrl) {
    const r = await gql(
      `mutation AddRepo($indexUrl: String!) {
         addExtensionStore(input: { indexUrl: $indexUrl }) { clientMutationId }
       }`,
      { indexUrl },
      15_000,
    );
    return r.ok ? Ok(true as const) : r;
  },

  async removeRepo(indexUrl) {
    const r = await gql(
      `mutation RemoveRepo($indexUrl: String!) {
         removeExtensionStore(input: { indexUrl: $indexUrl }) { clientMutationId }
       }`,
      { indexUrl },
      15_000,
    );
    return r.ok ? Ok(true as const) : r;
  },
};

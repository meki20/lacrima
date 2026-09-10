import type { Lang } from "../audio.ts";
import type { Result } from "../result.ts";
import type { MediaKind } from "../media.ts";

export type SourceInfo = {
  id: string;
  name: string;
  lang: string;
  iconUrl: string | null;
  kind: MediaKind;
  /** Suwayomi always ships a built-in local-files source; it is not a remote source. */
  isLocal: boolean;
};

export type SourceManga = {
  /** Backend-local id, not a metadata id. String: Suwayomi uses digits, plugins use paths. */
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  thumbnailUrl: string | null;
  chapterCount: number | null;
};

export type SourceChapter = {
  id: string;
  number: number;
  name: string;
  scanlator: string | null;
  uploadDate: number | null;
  pageCount: number | null;
  /** Anime only. 0 is specials; missing means a flat chapter list. */
  season?: number | null;
  thumbnailUrl?: string | null;
  overview?: string | null;
};

export type Repo = {
  indexUrl: string;
  name: string | null;
  kind: MediaKind;
  /** Legacy manga repos publish index.min.json; newer ones a gzipped index.pb. */
  isLegacy: boolean;
  extensionCount: number;
};

export type Extension = {
  pkgName: string;
  name: string;
  lang: string;
  version: string;
  iconUrl: string | null;
  isInstalled: boolean;
  hasUpdate: boolean;
  kind: MediaKind;
};

/**
 * One interface for every fetch backend. Everything returns Result — a backend
 * being down must never be indistinguishable from "no results". Data rule 2.
 */
export type SourceBackend = {
  name: string;
  kind: MediaKind;

  listSources(): Promise<Result<SourceInfo[]>>;
  search(sourceId: string, query: string): Promise<Result<SourceManga[]>>;
  chapters(mangaId: string, refresh?: boolean): Promise<Result<SourceChapter[]>>;
  pages(
    chapterId: string,
    extras?: { via?: string; mediaId?: number; lang?: Lang },
  ): Promise<Result<string[]>>;

  listRepos(): Promise<Result<Repo[]>>;
  addRepo(indexUrl: string): Promise<Result<true>>;
  removeRepo(indexUrl: string): Promise<Result<true>>;
  refreshExtensions(): Promise<Result<number>>;
  listExtensions(query: string): Promise<Result<Extension[]>>;
  setExtensionInstalled(pkgName: string, install: boolean): Promise<Result<true>>;
};

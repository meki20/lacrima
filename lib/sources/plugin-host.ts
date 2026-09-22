import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import dayjs from "dayjs";

export type ChapterItem = {
  name: string;
  path: string;
  releaseTime?: string | null;
  chapterNumber?: number;
  page?: string;
  url?: string;
};

export type SourceNovel = {
  name?: string;
  path?: string;
  chapters?: ChapterItem[];
  cover?: string;
  totalPages?: number;
};

export type SourcePage = { chapters: ChapterItem[] };

export type PluginInstance = {
  id: string;
  name: string;
  site?: string;
  lang?: string;
  searchNovels: (term: string, page?: number) => Promise<NovelItem[]>;
  parseNovel: (path: string) => Promise<SourceNovel>;
  parseChapter: (path: string) => Promise<string>;
  /** Paginated chapter lists — LNReader PagePlugin. */
  parsePage?: (novelPath: string, page: string) => Promise<SourcePage>;
  resolveUrl?: (path: string, isNovel?: boolean) => string;
};

type NovelItem = { name: string; path: string; cover?: string };

type StorageItem<T = unknown> = { created: Date; value: T; expires?: number };

class PluginStorage {
  private db: Record<string, StorageItem> = {};

  set<T>(key: string, value: T, expires?: Date | number): void {
    this.db[key] = {
      created: new Date(),
      value,
      expires: expires instanceof Date ? expires.getTime() : expires,
    };
  }

  get<T = unknown>(key: string, raw?: boolean): T | StorageItem<T> | undefined {
    const item = this.db[key] as StorageItem<T> | undefined;
    if (item?.expires && Date.now() > item.expires) {
      delete this.db[key];
      return undefined;
    }
    return raw ? item : item?.value;
  }

  getAllKeys(): string[] {
    return Object.keys(this.db);
  }

  delete(key: string): void {
    delete this.db[key];
  }

  clearAll(): void {
    this.db = {};
  }
}

class SimpleLocalStorage {
  private db: Record<string, string> = {};
  get(): Record<string, string> {
    return this.db;
  }
}

const NovelStatus = {
  Unknown: "Unknown",
  Ongoing: "Ongoing",
  Completed: "Completed",
  Licensed: "Licensed",
  PublishingFinished: "Publishing Finished",
  Cancelled: "Cancelled",
  OnHiatus: "On Hiatus",
  STUB: "STUB",
  Inactive: "Inactive",
};

const defaultCover =
  "https://github.com/LNReader/lnreader-plugins/blob/main/icons/src/coverNotAvailable.jpg?raw=true";

const FilterInputs = {
  Text: "Text",
  TextInput: "TextInput",
  Picker: "Picker",
  Checkbox: "Checkbox",
  Switch: "Switch",
  CheckboxGroup: "CheckboxGroup",
  ExcludableCheckboxGroup: "ExcludableCheckboxGroup",
};

const headers: Record<string, string> = {
  connection: "keep-alive",
  accept: "*/*",
  "accept-language": "*",
  "sec-fetch-mode": "cors",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
};

async function fetchApi(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  });
}

async function fetchText(url: string, init?: RequestInit, encoding?: string) {
  try {
    const res = await fetchApi(url, init);
    if (!res.ok) return "";
    const buf = await res.arrayBuffer();
    return new TextDecoder(encoding).decode(buf);
  } catch {
    return "";
  }
}

async function fetchFile(url: string, init?: RequestInit) {
  try {
    const res = await fetchApi(url, init);
    if (!res.ok) return "";
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch {
    return "";
  }
}

function isAbsoluteUrl(u: string) {
  try {
    new URL(u);
    return true;
  } catch {
    return false;
  }
}

const urlencode = {
  encode: (s: string) => encodeURIComponent(s).replace(/%20/g, "+"),
  decode: (s: string) => {
    try {
      return decodeURIComponent(String(s).replace(/\+/g, "%20"));
    } catch {
      return s;
    }
  },
};

function makeStorageBundle() {
  const storage = new PluginStorage();
  const localStorage = new SimpleLocalStorage();
  const sessionStorage = new SimpleLocalStorage();
  return { storage, localStorage, sessionStorage, default: storage, ...storage };
}

/** Cheerio as both namespace and default — plugins use either shape. */
const cheerioLib = Object.assign({ load: cheerio.load }, cheerio, { default: cheerio });

const baseLibs: Record<string, unknown> = {
  cheerio: cheerioLib,
  htmlparser2,
  dayjs,
  urlencode,
  "@libs/fetch": { fetchApi, fetchText, fetchFile, fetchProto: async () => ({}) },
  "@libs/novelStatus": { NovelStatus },
  "@libs/filterInputs": { FilterInputs, FilterTypes: FilterInputs },
  "@libs/isAbsoluteUrl": { isAbsoluteUrl, isUrlAbsolute: isAbsoluteUrl, default: isAbsoluteUrl },
  "@libs/defaultCover": { defaultCover, default: defaultCover },
};

function requireLib(name: string, storageBundle: ReturnType<typeof makeStorageBundle>) {
  if (name === "@libs/storage") return storageBundle;
  const m = baseLibs[name];
  if (!m) throw new Error(`Plugin asked for "${name}", which Lacrima does not load.`);
  return m;
}

const cache = new Map<string, PluginInstance>();

export async function loadPlugin(id: string, url: string): Promise<PluginInstance> {
  const hit = cache.get(id);
  if (hit) return hit;

  let code = "";
  try {
    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Plugin download returned ${res.status}.`);
    code = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "download failed";
    throw new Error(`Could not download plugin ${id}: ${msg}`);
  }
  if (!code.trim()) throw new Error(`Could not download plugin ${id}: empty response.`);

  const storageBundle = makeStorageBundle();
  const module = { exports: {} as { default?: PluginInstance } & PluginInstance };
  const fn = new Function("require", "module", "exports", code);
  fn.call(globalThis, (name: string) => requireLib(name, storageBundle), module, module.exports);
  const plugin = (module.exports.default ?? module.exports) as PluginInstance;
  if (!plugin?.searchNovels || !plugin.parseNovel || !plugin.parseChapter) {
    throw new Error(`Plugin ${id} is missing search/parse methods.`);
  }
  cache.set(id, plugin);
  return plugin;
}

export function dropPlugin(id: string) {
  cache.delete(id);
}

/** Flatten + normalise chapter rows plugins hand back. */
export function normalizeChapters(raw: unknown): ChapterItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChapterItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const c = row as Record<string, unknown>;
    const path = String(c.path ?? c.url ?? "").trim();
    if (!path) continue;
    const name = String(c.name ?? c.title ?? path).trim() || path;
    const chapterNumber =
      typeof c.chapterNumber === "number" && Number.isFinite(c.chapterNumber)
        ? c.chapterNumber
        : undefined;
    const page = c.page != null && String(c.page).trim() ? String(c.page) : undefined;
    const releaseTime =
      c.releaseTime == null ? null : typeof c.releaseTime === "string" ? c.releaseTime : String(c.releaseTime);
    out.push({ name, path, chapterNumber, page, releaseTime });
  }
  return out;
}

/** Pull every page of a PagePlugin chapter list into one flat array. */
export async function collectNovelChapters(
  plugin: PluginInstance,
  novelPath: string,
): Promise<ChapterItem[]> {
  const novel = await plugin.parseNovel(novelPath);
  if (!novel || typeof novel !== "object") {
    throw new Error("Plugin returned an unreadable novel listing.");
  }
  const chapters = normalizeChapters(novel.chapters);
  const totalPages = Number(novel.totalPages) || 0;
  if (!plugin.parsePage || totalPages <= 1) return chapters;

  const seen = new Set(chapters.map((c) => c.path));
  const maxPages = Math.min(totalPages, 500);
  for (let i = 2; i <= maxPages; i++) {
    try {
      const page = await plugin.parsePage(novelPath, String(i));
      for (const c of normalizeChapters(page?.chapters)) {
        if (seen.has(c.path)) continue;
        seen.add(c.path);
        chapters.push(c);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "page fetch failed";
      throw new Error(`Chapter list page ${i} failed: ${msg}`);
    }
  }
  return chapters;
}

/** True when HTML has no readable prose (blank, tags-only, whitespace). */
export function chapterHasText(html: unknown): boolean {
  if (html == null) return false;
  const raw = typeof html === "string" ? html : String(html);
  if (!raw.trim()) return false;
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0;
}

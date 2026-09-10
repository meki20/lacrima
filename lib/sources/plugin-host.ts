import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import dayjs from "dayjs";

type PluginInstance = {
  id: string;
  name: string;
  site?: string;
  lang?: string;
  searchNovels: (term: string, page?: number) => Promise<NovelItem[]>;
  parseNovel: (path: string) => Promise<SourceNovel>;
  parseChapter: (path: string) => Promise<string>;
};

type NovelItem = { name: string; path: string; cover?: string };
type ChapterItem = { name: string; path: string; releaseTime?: string; chapterNumber?: number };
type SourceNovel = {
  name?: string;
  chapters?: ChapterItem[];
  cover?: string;
};

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
  accept: "*/*",
  "accept-language": "*",
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

const storage = {
  get: () => null,
  set: () => undefined,
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const libs: Record<string, unknown> = {
  cheerio,
  htmlparser2,
  dayjs,
  "@libs/fetch": { fetchApi, fetchText, fetchFile, fetchProto: async () => ({}) },
  "@libs/novelStatus": { NovelStatus },
  "@libs/filterInputs": { FilterInputs, FilterTypes: FilterInputs },
  "@libs/isAbsoluteUrl": { isAbsoluteUrl, isUrlAbsolute: isAbsoluteUrl, default: isAbsoluteUrl },
  "@libs/storage": { storage, default: storage, ...storage },
  "@libs/defaultCover": { defaultCover, default: defaultCover },
};

function requireLib(name: string) {
  const m = libs[name];
  if (!m) throw new Error(`Plugin asked for "${name}", which Lacrima does not load.`);
  return m;
}

const cache = new Map<string, PluginInstance>();

export async function loadPlugin(id: string, url: string): Promise<PluginInstance> {
  const hit = cache.get(id);
  if (hit) return hit;
  const code = await fetchText(url);
  if (!code) throw new Error(`Could not download plugin ${id}.`);
  const module = { exports: {} as { default?: PluginInstance } & PluginInstance };
  const fn = new Function("require", "module", "exports", code);
  fn.call(globalThis, requireLib, module, module.exports);
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

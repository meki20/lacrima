import { deflateRawSync, inflateRawSync } from "node:zlib";
import { db, plain, plainAll } from "./db.ts";
import { updateProfileSettings, type Settings } from "./settings.ts";
import { parseHex, parseName, parseWallpaper } from "./theme.ts";
import { clampCoord, clampRot, clampScale, chromeKind, pagePath, parseSurface, placeBlocked } from "./sticker-place.ts";
import type { MediaKind, ProviderSlug } from "./media.ts";
import { backend, clearSourceHealth } from "./sources/index.ts";

const ZIP_NAME = "backup.json";
const MAX_ZIP_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 50_000;

type Json = Record<string, unknown>;
type BackupType = "profile" | "sources";
export type Backup = { version: 1; type: BackupType; exportedAt: number; data: Json };

function crc32(data: Buffer): number {
  let crc = -1;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

/** A single compressed JSON file is enough for portable, inspectable backups. */
export function zipBackup(backup: Backup): Buffer {
  const name = Buffer.from(ZIP_NAME);
  const raw = Buffer.from(JSON.stringify(backup));
  const body = deflateRawSync(raw);
  const crc = crc32(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);

  const centralOffset = local.length + name.length + body.length;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}

export function unzipBackup(input: Buffer): Backup {
  if (input.length < 22 || input.length > MAX_ZIP_BYTES) throw new Error("Backup ZIP is too large or incomplete.");
  const endAt = input.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0 || endAt + 22 > input.length) throw new Error("That file is not a valid ZIP backup.");
  if (input.readUInt16LE(endAt + 8) !== 1 || input.readUInt16LE(endAt + 10) !== 1) {
    throw new Error("A Lacrima backup ZIP must contain exactly one file.");
  }
  const centralAt = input.readUInt32LE(endAt + 16);
  if (centralAt + 46 > input.length || input.readUInt32LE(centralAt) !== 0x02014b50) {
    throw new Error("That ZIP has no readable backup file.");
  }
  const flags = input.readUInt16LE(centralAt + 8);
  const method = input.readUInt16LE(centralAt + 10);
  const crc = input.readUInt32LE(centralAt + 16);
  const compressed = input.readUInt32LE(centralAt + 20);
  const rawLength = input.readUInt32LE(centralAt + 24);
  const nameLength = input.readUInt16LE(centralAt + 28);
  const extraLength = input.readUInt16LE(centralAt + 30);
  const localAt = input.readUInt32LE(centralAt + 42);
  if (flags || (method !== 0 && method !== 8) || rawLength > MAX_JSON_BYTES || compressed > MAX_ZIP_BYTES) {
    throw new Error("That ZIP uses an unsupported backup format.");
  }
  if (input.subarray(centralAt + 46, centralAt + 46 + nameLength).toString() !== ZIP_NAME) {
    throw new Error("That ZIP does not contain a Lacrima backup.");
  }
  if (localAt + 30 > input.length || input.readUInt32LE(localAt) !== 0x04034b50) {
    throw new Error("That ZIP has an invalid backup entry.");
  }
  const localName = input.readUInt16LE(localAt + 26);
  const localExtra = input.readUInt16LE(localAt + 28);
  const start = localAt + 30 + localName + localExtra;
  if (start + compressed > input.length) throw new Error("That ZIP backup is truncated.");
  const raw = method === 8
    ? inflateRawSync(input.subarray(start, start + compressed), { maxOutputLength: MAX_JSON_BYTES })
    : input.subarray(start, start + compressed);
  if (raw.length !== rawLength || crc32(raw) !== crc) throw new Error("That ZIP backup failed its integrity check.");
  let value: unknown;
  try { value = JSON.parse(raw.toString("utf8")); } catch { throw new Error("The backup JSON could not be read."); }
  const root = record(value, "backup");
  if (root.version !== 1 || (root.type !== "profile" && root.type !== "sources") || !Number.isFinite(root.exportedAt) || !isRecord(root.data)) {
    throw new Error("This is not a supported Lacrima backup.");
  }
  return root as Backup;
}

export function profileBackup(profileId: number): Backup {
  const d = db();
  const profile = d.prepare("select name, avatar_color, accent, wallpaper, created_at, caption_x, caption_y from profiles where id = ?").get(profileId) as Json | undefined;
  if (!profile) throw new Error("Profile not found.");
  const all = (sql: string) => plainAll(d.prepare(sql).all(profileId) as Json[]);
  const one = (sql: string) => {
    const row = d.prepare(sql).get(profileId) as Json | undefined;
    return row ? plain(row) : null;
  };
  return {
    version: 1, type: "profile", exportedAt: Date.now(), data: {
      profile: plain(profile),
      settings: one("select audio_lang, subtitle_lang, caption_scale, reader_mode, reader_rtl, reader_fit, reader_spread from profile_settings where profile_id = ?"),
      genres: all("select genre, weight from profile_genres where profile_id = ?"),
      library: all("select via, media_id, media_type, status, score, added_at, title, cover, color, units, genres, pin from library where profile_id = ?"),
      progress: all("select via, media_id, media_type, unit, anchor, title, cover, updated_at, watched_seconds from progress where profile_id = ?"),
      activity: all("select day, anime, manga, novel, night from activity where profile_id = ?"),
      providers: all("select provider, chosen_at from provider_choices where profile_id = ?"),
      stickers: all("select sticker_id, earned_at, x, y, rot, surface from stickers where profile_id = ?"),
      placements: all("select sticker_id, path, x, y, scale, rot, surface from sticker_placements where profile_id = ?"),
      stickerPools: all(`select via, media_id, payload, fetched_at from sticker_pools where exists
        (select 1 from stickers where profile_id = ? and sticker_id like sticker_pools.via || ':' || sticker_pools.media_id || ':%')`),
      subtitleChoices: all("select via, media_id, chapter_id, choice from subtitle_choices where profile_id = ?"),
    },
  };
}

export function restoreProfile(profileId: number, backup: Backup) {
  if (backup.type !== "profile") throw new Error("Choose a profile backup for this page.");
  const data = backup.data;
  const profile = restoreProfileRow(record(data.profile, "profile"));
  const settings = data.settings == null ? null : restoreSettings(record(data.settings, "settings"));
  const genres = rows(data.genres, "genres").map(restoreGenre);
  const library = rows(data.library, "library").map(restoreLibrary);
  const progress = rows(data.progress, "progress").map(restoreProgress);
  const activity = rows(data.activity, "activity").map(restoreActivity);
  const providers = rows(data.providers, "providers").map(restoreProvider);
  const stickers = rows(data.stickers, "stickers").map(restoreSticker);
  const placements = rows(data.placements, "placements").map(restorePlacement);
  const stickerPools = rows(data.stickerPools ?? [], "sticker pools").map(restoreStickerPool);
  const subtitleChoices = rows(data.subtitleChoices ?? [], "subtitle choices").map(restoreSubtitleChoice);
  const d = db();
  d.exec("begin");
  try {
    d.prepare("update profiles set name = ?, avatar_color = ?, accent = ?, wallpaper = ?, created_at = ?, caption_x = ?, caption_y = ? where id = ?")
      .run(profile.name, profile.avatar, profile.accent, profile.wallpaper, profile.createdAt, profile.captionX, profile.captionY, profileId);
    for (const table of ["profile_genres", "library", "progress", "activity", "provider_choices", "stickers", "sticker_placements", "subtitle_choices", "profile_settings"]) {
      d.prepare(`delete from ${table} where profile_id = ?`).run(profileId);
    }
    if (settings) updateProfileSettings(profileId, settings);
    const genre = d.prepare("insert into profile_genres (profile_id, genre, weight) values (?, ?, ?)");
    for (const row of unique(genres, (r) => r.genre)) genre.run(profileId, row.genre, row.weight);
    const lib = d.prepare("insert into library (profile_id, via, media_id, media_type, status, score, added_at, title, cover, color, units, genres, pin) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const row of unique(library, (r) => `${r.via}:${r.mediaId}`)) lib.run(profileId, row.via, row.mediaId, row.kind, row.status, row.score, row.addedAt, row.title, row.cover, row.color, row.units, row.genres, row.pin);
    const prog = d.prepare("insert into progress (profile_id, via, media_id, media_type, unit, anchor, title, cover, updated_at, watched_seconds) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const row of unique(progress, (r) => `${r.via}:${r.mediaId}`)) prog.run(profileId, row.via, row.mediaId, row.kind, row.unit, row.anchor, row.title, row.cover, row.updatedAt, row.watchedSeconds);
    const day = d.prepare("insert into activity (profile_id, day, anime, manga, novel, night) values (?, ?, ?, ?, ?, ?)");
    for (const row of unique(activity, (r) => r.day)) day.run(profileId, row.day, row.anime, row.manga, row.novel, row.night);
    const choice = d.prepare("insert into provider_choices (profile_id, provider, chosen_at) values (?, ?, ?)");
    for (const row of providers) choice.run(profileId, row.provider, row.chosenAt);
    const pool = d.prepare(`insert into sticker_pools (via, media_id, payload, fetched_at) values (?, ?, ?, ?)
      on conflict(via, media_id) do update set payload = excluded.payload, fetched_at = excluded.fetched_at`);
    for (const row of unique(stickerPools, (r) => `${r.via}:${r.mediaId}`)) pool.run(row.via, row.mediaId, row.payload, row.fetchedAt);
    const sticker = d.prepare("insert into stickers (profile_id, sticker_id, earned_at, x, y, rot, surface) values (?, ?, ?, ?, ?, ?, ?)");
    for (const row of unique(stickers, (r) => r.id)) sticker.run(profileId, row.id, row.earnedAt, row.x, row.y, row.rot, row.surface);
    const placement = d.prepare("insert into sticker_placements (profile_id, sticker_id, path, x, y, scale, rot, surface) values (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const row of placements) placement.run(profileId, row.id, row.path, row.x, row.y, row.scale, row.rot, row.surface);
    const subtitle = d.prepare("insert into subtitle_choices (profile_id, via, media_id, chapter_id, choice) values (?, ?, ?, ?, ?)");
    for (const row of unique(subtitleChoices, (r) => `${r.via}:${r.mediaId}:${r.chapterId}`)) subtitle.run(profileId, row.via, row.mediaId, row.chapterId, row.choice);
    d.exec("commit");
  } catch (error) {
    d.exec("rollback");
    throw error;
  }
}

export async function sourcesBackup(): Promise<Backup> {
  const manga = backend("manga");
  const [repos, extensions, sources] = await Promise.all([manga.listRepos(), manga.listExtensions(""), manga.listSources()]);
  if (!repos.ok) throw new Error(repos.reason);
  if (!extensions.ok) throw new Error(extensions.reason);
  if (!sources.ok) throw new Error(sources.reason);
  const d = db();
  return {
    version: 1, type: "sources", exportedAt: Date.now(), data: {
      repos: plainAll(d.prepare("select index_url, kind, name, added_at from source_repos").all() as Json[]),
      plugins: plainAll(d.prepare("select id, kind, repo_url, name, lang, version, icon_url, plugin_url, installed from source_plugins").all() as Json[]),
      disabled: plainAll(d.prepare("select kind, id from source_disabled").all() as Json[]),
      manga: {
        repos: repos.value.map((repo) => repo.indexUrl),
        installed: extensions.value.filter((extension) => extension.isInstalled).map((extension) => extension.pkgName),
        sourceIds: sources.value.filter((source) => !source.isLocal).map((source) => source.id),
      },
    },
  };
}

export async function restoreSources(backup: Backup): Promise<string> {
  if (backup.type !== "sources") throw new Error("Choose a sources backup for this page.");
  const repos = rows(backup.data.repos, "repositories").map(restoreRepo);
  const plugins = rows(backup.data.plugins, "extensions").map(restorePlugin);
  const disabled = rows(backup.data.disabled, "disabled sources").map(restoreDisabled);
  const manga = record(backup.data.manga, "manga sources");
  const mangaRepos = strings(manga.repos, "manga repositories", 2_000).map(sourceUrl);
  const installed = strings(manga.installed, "installed manga extensions", 20_000).map((id) => text(id, "extension id", 500));
  const sourceIds = strings(manga.sourceIds, "manga source ids", 20_000).map((id) => text(id, "source id", 500));
  const source = backend("manga");
  const current = await source.listRepos();
  if (!current.ok) throw new Error(current.reason);
  const have = new Set(current.value.map((repo) => repo.indexUrl));
  let added = 0;
  for (const url of mangaRepos) {
    if (have.has(url)) continue;
    const result = await source.addRepo(url);
    if (!result.ok) throw new Error(`Could not add ${url}: ${result.reason}`);
    added++;
  }
  if (added) {
    const result = await source.refreshExtensions();
    if (!result.ok) throw new Error(result.reason);
  }
  const available = await source.listExtensions("");
  if (!available.ok) throw new Error(available.reason);
  let missing = 0;
  for (const id of installed) {
    const extension = available.value.find((item) => item.pkgName === id);
    if (!extension) { missing++; continue; }
    if (!extension.isInstalled) {
      const result = await source.setExtensionInstalled(id, true);
      if (!result.ok) throw new Error(`Could not install ${id}: ${result.reason}`);
    }
  }
  const d = db();
  d.exec("begin");
  try {
    const repo = d.prepare(`insert into source_repos (index_url, kind, name, added_at) values (?, ?, ?, ?)
      on conflict(index_url) do update set kind = excluded.kind, name = excluded.name, added_at = excluded.added_at`);
    for (const row of unique(repos, (item) => item.url)) repo.run(row.url, row.kind, row.name, row.addedAt);
    const plugin = d.prepare(`insert into source_plugins (id, kind, repo_url, name, lang, version, icon_url, plugin_url, installed) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id, kind) do update set repo_url = excluded.repo_url, name = excluded.name, lang = excluded.lang, version = excluded.version, icon_url = excluded.icon_url, plugin_url = excluded.plugin_url, installed = excluded.installed`);
    for (const row of unique(plugins, (item) => `${item.kind}:${item.id}`)) plugin.run(row.id, row.kind, row.repoUrl, row.name, row.lang, row.version, row.iconUrl, row.pluginUrl, row.installed);
    const clear = d.prepare("delete from source_disabled where kind = 'manga' and id = ?");
    for (const id of sourceIds) clear.run(id);
    const off = d.prepare("insert or ignore into source_disabled (kind, id) values (?, ?)");
    for (const row of unique(disabled, (item) => `${item.kind}:${item.id}`)) off.run(row.kind, row.id);
    d.exec("commit");
  } catch (error) {
    d.exec("rollback");
    throw error;
  }
  clearSourceHealth();
  return missing ? `Imported sources; ${missing} archived manga extension${missing === 1 ? " is" : "s are"} no longer available.` : "Imported your sources.";
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Json {
  if (!isRecord(value)) throw new Error(`Backup ${label} is missing or invalid.`);
  return value;
}

function rows(value: unknown, label: string): Json[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new Error(`Backup ${label} is missing or too large.`);
  return value.map((item) => record(item, label));
}

function strings(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Backup ${label} is missing or too large.`);
  return value.map((item) => text(item, label, 2_000));
}

function text(value: unknown, label: string, max = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Backup ${label} is invalid.`);
  return value;
}

function nullableText(value: unknown, label: string, max = 2_000): string | null {
  if (value == null) return null;
  return text(value, label, max);
}

function finite(value: unknown, label: string, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Backup ${label} is invalid.`);
  return value;
}

function whole(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = finite(value, label, min, max);
  if (!Number.isInteger(n)) throw new Error(`Backup ${label} is invalid.`);
  return n;
}

function nullableNumber(value: unknown, label: string): number | null {
  return value == null ? null : finite(value, label);
}

function kind(value: unknown): MediaKind {
  if (value === "anime" || value === "manga" || value === "novel") return value;
  throw new Error("Backup media kind is invalid.");
}

function via(value: unknown): ProviderSlug {
  if (value === "anilist" || value === "jikan" || value === "kitsu") return value;
  throw new Error("Backup metadata provider is invalid.");
}

function sourceUrl(value: unknown): string {
  const raw = text(value, "source URL", 2_000);
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return raw;
  } catch { throw new Error("Backup source URL is invalid."); }
}

function unique<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

function restoreProfileRow(row: Json) {
  const name = parseName(text(row.name, "profile name", 24));
  const accent = parseHex(text(row.accent, "profile accent", 7));
  const avatar = parseHex(text(row.avatar_color, "profile avatar colour", 7));
  const wallpaper = parseWallpaper(nullableText(row.wallpaper, "profile wallpaper", 500));
  if (!name || !accent || !avatar || (row.wallpaper != null && wallpaper == null)) throw new Error("Backup profile details are invalid.");
  return { name, accent, avatar, wallpaper, createdAt: whole(row.created_at, "profile creation date"), captionX: finite(row.caption_x, "caption position", 0, 100), captionY: finite(row.caption_y, "caption position", 0, 100) };
}

function restoreSettings(row: Json): Partial<Settings> {
  return {
    audio_lang: text(row.audio_lang, "audio language", 10) as Settings["audio_lang"],
    subtitle_lang: text(row.subtitle_lang, "subtitle language", 10),
    caption_scale: finite(row.caption_scale, "caption scale", 0.5, 2),
    reader_mode: text(row.reader_mode, "reader mode", 20) as Settings["reader_mode"],
    reader_rtl: whole(row.reader_rtl, "reader direction", 0, 1),
    reader_fit: text(row.reader_fit, "reader fit", 20) as Settings["reader_fit"],
    reader_spread: text(row.reader_spread, "reader layout", 20) as Settings["reader_spread"],
  };
}

function restoreGenre(row: Json) { return { genre: text(row.genre, "genre", 80), weight: finite(row.weight, "genre weight", 0, 100) }; }
function restoreLibrary(row: Json) {
  const status = text(row.status, "library status", 20);
  if (!["reading", "planned", "completed", "hold", "dropped"].includes(status)) throw new Error("Backup library status is invalid.");
  const score = nullableNumber(row.score, "library score");
  if (score != null && (!Number.isInteger(score) || score < 1 || score > 10)) throw new Error("Backup library score is invalid.");
  return { via: via(row.via), mediaId: whole(row.media_id, "media id", 1), kind: kind(row.media_type), status, score, addedAt: whole(row.added_at, "library date"), title: nullableText(row.title, "library title", 1_000), cover: nullableText(row.cover, "cover URL", 2_000), color: nullableText(row.color, "cover colour", 20), units: row.units == null ? null : whole(row.units, "unit count"), genres: text(row.genres, "library genres", 10_000), pin: whole(row.pin, "pin", 0, 10) };
}
function restoreProgress(row: Json) {
  return { via: via(row.via), mediaId: whole(row.media_id, "media id", 1), kind: kind(row.media_type), unit: whole(row.unit, "progress unit"), anchor: nullableText(row.anchor, "progress anchor", 50_000), title: nullableText(row.title, "progress title", 1_000), cover: nullableText(row.cover, "progress cover", 2_000), updatedAt: whole(row.updated_at, "progress date"), watchedSeconds: whole(row.watched_seconds, "watched seconds") };
}
function restoreActivity(row: Json) { return { day: text(row.day, "activity day", 10), anime: whole(row.anime, "anime activity"), manga: whole(row.manga, "manga activity"), novel: whole(row.novel, "novel activity"), night: whole(row.night, "night activity") }; }
function restoreProvider(row: Json) { return { provider: text(row.provider, "provider", 160), chosenAt: whole(row.chosen_at, "provider date") }; }
function restoreSticker(row: Json) { return { id: text(row.sticker_id, "sticker", 500), earnedAt: row.earned_at == null ? null : whole(row.earned_at, "sticker date"), x: nullableNumber(row.x, "sticker position"), y: nullableNumber(row.y, "sticker position"), rot: finite(row.rot, "sticker rotation", -360_000, 360_000), surface: row.surface == null ? null : parseSurface(text(row.surface, "sticker surface", 10)) }; }
function restoreStickerPool(row: Json) {
  const provider = via(row.via);
  const mediaId = whole(row.media_id, "sticker title id", 1);
  const payload = text(row.payload, "sticker pool", 1_000_000);
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { throw new Error("Backup sticker pool is invalid."); }
  const defs = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.defs : null;
  if (!Array.isArray(defs) || defs.length > 100 || defs.some((item) =>
    !isRecord(item) || typeof item.id !== "string" || !item.id.startsWith(`${provider}:${mediaId}:`) ||
    typeof item.name !== "string" || item.name.length > 500 ||
    (item.image !== null && (typeof item.image !== "string" || item.image.length > 2_000)) ||
    typeof item.secret !== "boolean")) throw new Error("Backup sticker pool is invalid.");
  return { via: provider, mediaId, payload, fetchedAt: whole(row.fetched_at, "sticker pool date") };
}
function restoreSubtitleChoice(row: Json) {
  return { via: via(row.via), mediaId: whole(row.media_id, "subtitle title id", 1), chapterId: text(row.chapter_id, "subtitle episode", 500), choice: text(row.choice, "subtitle choice", 8_000) };
}
function restorePlacement(row: Json) {
  const path = pagePath(text(row.path, "sticker path", 400));
  if (!path || (!chromeKind(path) && placeBlocked(path))) throw new Error("Backup sticker path is invalid.");
  return { id: text(row.sticker_id, "sticker", 500), path, x: clampCoord(finite(row.x, "sticker position")), y: clampCoord(finite(row.y, "sticker position")), scale: clampScale(finite(row.scale, "sticker scale")), rot: clampRot(finite(row.rot, "sticker rotation")), surface: parseSurface(text(row.surface, "sticker surface", 10)) };
}

function restoreRepo(row: Json) { return { url: sourceUrl(row.index_url), kind: kind(row.kind), name: nullableText(row.name, "repository name", 500), addedAt: whole(row.added_at, "repository date") }; }
function restorePlugin(row: Json) { return { id: text(row.id, "extension id", 500), kind: kind(row.kind), repoUrl: sourceUrl(row.repo_url), name: text(row.name, "extension name", 500), lang: text(row.lang, "extension language", 100), version: text(row.version, "extension version", 100), iconUrl: nullableText(row.icon_url, "extension icon", 2_000), pluginUrl: row.plugin_url == null ? null : sourceUrl(row.plugin_url), installed: whole(row.installed, "extension state", 0, 1) }; }
function restoreDisabled(row: Json) { return { kind: kind(row.kind), id: text(row.id, "source id", 500) }; }

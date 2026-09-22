import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db, plain, plainAll } from "./db.ts";
import type { MediaKind, ProviderSlug } from "./media.ts";
import { ANIME_EPISODE_SECONDS } from "./progress-write.ts";
import { fetchSeries, franchiseKey, franchiseLabel } from "./series.ts";
import type { StickerGroup, StickerPick } from "./sticker-catalog.ts";

export type { StickerGroup, StickerPick } from "./sticker-catalog.ts";

export const SECONDS_PER_STICKER = 15 * 60;
export const CHAPTERS_PER_STICKER = 5;
export const CHAR_CAP = 16;
export const EXTRA_PER_SEASON = 3;
export const SERIES_CHAR_MAX = 28;
const SECRET_COUNT = 3;
const POOL_TTL = 7 * 24 * 60 * 60 * 1000;
const EMPTY_TTL = 6 * 60 * 60 * 1000;
const POOL_V = 2;

export type StickerDef = {
  id: string;
  name: string;
  image: string | null;
  secret: boolean;
};

export type StickerSlot = StickerDef & {
  earned: boolean;
  src: string | null;
};

type ToggleResult = Pick<StickerSlot, "id" | "name" | "secret" | "earned" | "src">;

export type TitleStickers = {
  via: ProviderSlug;
  id: number;
  kind: MediaKind;
  title: string;
  href: string;
  watched: number;
  earned: number;
  slots: StickerSlot[];
};

type PoolRow = { via: string; media_id: number; payload: string; fetched_at: number };

export function dueCount(
  kind: MediaKind,
  progress: { seconds: number; unit: number },
  total: number,
): number {
  if (total <= 0) return 0;
  const n =
    kind === "anime"
      ? Math.max(
          Math.floor(Math.max(0, progress.seconds) / SECONDS_PER_STICKER),
          Math.floor(Math.max(0, progress.unit) * ANIME_EPISODE_SECONDS / SECONDS_PER_STICKER),
        )
      : Math.floor(Math.max(0, progress.unit) / CHAPTERS_PER_STICKER);
  return Math.min(total, Math.max(0, n));
}

export type CastChar = {
  id: string | number;
  name: string;
  image: string | null;
  main?: boolean;
};

/** One franchise pool: season 1 fills the base, later seasons add new faces (and main-character art variants). */
export function mergeSeriesChars(
  seasons: CastChar[][],
  base = CHAR_CAP,
  extraPer = EXTRA_PER_SEASON,
  max = SERIES_CHAR_MAX,
): CastChar[] {
  const start = seasons.findIndex((s) => s.length > 0);
  if (start < 0) return [];
  seasons = seasons.slice(start);
  const key = (c: CastChar) => String(c.id);
  const out: CastChar[] = [];
  const seen = new Set<string>();
  for (const c of seasons[0] ?? []) {
    if (out.length >= base) break;
    const k = key(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  const mains = (seasons[0] ?? []).filter((c) => c.main).slice(0, 3);
  for (let i = 1; i < seasons.length && out.length < max; i++) {
    let added = 0;
    const later = seasons[i] ?? [];
    for (const c of later) {
      if (added >= extraPer || out.length >= max) break;
      const k = key(c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
      added++;
    }
    for (const m of mains) {
      if (added >= extraPer || out.length >= max) break;
      const hit = later.find((c) => key(c) === key(m) && c.image && c.image !== m.image);
      if (!hit) continue;
      const rid = `${key(m)}:r${i}`;
      if (seen.has(rid)) continue;
      seen.add(rid);
      out.push({ ...hit, id: rid });
      added++;
    }
  }
  return out;
}

export function stickerTail(id: string): string | null {
  const m = /^(?:anilist|jikan|kitsu):\d+:((?:c|x):.+)$/.exec(id);
  return m ? m[1] : null;
}

export function remapPoolIds(defs: StickerDef[], via: string, ownerId: number): StickerDef[] {
  return defs.map((d) => {
    const tail = stickerTail(d.id);
    return tail ? { ...d, id: `${via}:${ownerId}:${tail}` } : d;
  });
}

function hasRegular(defs: StickerDef[]): boolean {
  return defs.some((d) => !d.secret);
}

export function pickNext(
  defs: StickerDef[],
  earned: Set<string>,
  rand: () => number = Math.random,
): StickerDef | null {
  const regular = defs.filter((d) => !d.secret && !earned.has(d.id));
  const pool = regular.length ? regular : defs.filter((d) => d.secret && !earned.has(d.id));
  if (!pool.length) return null;
  return pool[Math.floor(rand() * pool.length)] ?? null;
}

export function earnedCount(profileId: number): number {
  const row = db()
    .prepare("select count(*) as n from stickers where profile_id = ? and earned_at is not null")
    .get(profileId) as { n: number };
  return row.n;
}

export function stickerEarned(profileId: number, stickerId: string): boolean {
  const row = db()
    .prepare(
      "select 1 as n from stickers where profile_id = ? and sticker_id = ? and earned_at is not null",
    )
    .get(profileId, stickerId) as { n: number } | undefined;
  return Boolean(row);
}

export function stickerFace(stickerId: string): { name: string; src: string | null } | null {
  const def = findDef(stickerId);
  if (!def) return null;
  return { name: def.name, src: artSrc(def.image) };
}

export function groupEarnedStickers(
  items: (StickerPick & { title: string })[],
): StickerGroup[] {
  type Row = { title: string; stickers: StickerPick[] };
  const byOwner = new Map<string, Row>();
  const order: string[] = [];
  for (const s of items) {
    const owner = /^(anilist|jikan|kitsu):(\d+):/.exec(s.id);
    const k = owner ? `${owner[1]}:${owner[2]}` : `t:${s.title.toLowerCase()}`;
    const face = { id: s.id, name: s.name, src: s.src };
    const cur = byOwner.get(k);
    if (cur) cur.stickers.push(face);
    else {
      byOwner.set(k, { title: s.title, stickers: [face] });
      order.push(k);
    }
  }
  const raw = order.map((k) => byOwner.get(k)!);
  const titles = raw.map((g) => g.title);
  const seen = new Set<string>();
  const out: StickerGroup[] = [];
  for (const g of raw) {
    const k = franchiseKey(g.title, titles);
    if (seen.has(k)) continue;
    seen.add(k);
    const bunch = raw.filter((x) => franchiseKey(x.title, titles) === k);
    out.push({
      title: franchiseLabel(g.title, titles),
      stickers: bunch.flatMap((x) => x.stickers),
    });
  }
  return out;
}

export function earnedCatalog(profileId: number): StickerGroup[] {
  const rows = db()
    .prepare(
      "select sticker_id as id from stickers where profile_id = ? and earned_at is not null order by earned_at, sticker_id",
    )
    .all(profileId) as { id: string }[];
  const titles = mediaTitles(profileId);
  const items: (StickerPick & { title: string })[] = [];
  for (const { id } of rows) {
    const face = stickerFace(id);
    if (!face?.src) continue;
    const owner = /^(anilist|jikan|kitsu):(\d+):/.exec(id);
    const title = (owner && titles.get(`${owner[1]}:${owner[2]}`)) || "Untitled";
    items.push({ id, name: face.name, src: face.src, title });
  }
  return groupEarnedStickers(items);
}

function mediaTitles(profileId: number): Map<string, string> {
  const out = new Map<string, string>();
  const put = (via: string, id: number, title: string | null) => {
    if (!title) return;
    out.set(`${via}:${id}`, title);
  };
  for (const r of plainAll(
    db()
      .prepare("select via, media_id, title from progress where profile_id = ?")
      .all(profileId) as { via: string; media_id: number; title: string | null }[],
  )) {
    put(r.via, r.media_id, r.title);
  }
  for (const r of plainAll(
    db()
      .prepare("select via, media_id, title from library where profile_id = ?")
      .all(profileId) as { via: string; media_id: number; title: string | null }[],
  )) {
    put(r.via, r.media_id, r.title);
  }
  return out;
}

export function watchedSeconds(profileId: number, via: string, mediaId: number): number {
  const row = db()
    .prepare("select watched_seconds as n from progress where profile_id = ? and via = ? and media_id = ?")
    .get(profileId, via, mediaId) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function totalWatchedSeconds(profileId: number): number {
  const row = db()
    .prepare("select coalesce(sum(watched_seconds), 0) as n from progress where profile_id = ?")
    .get(profileId) as { n: number };
  return row.n;
}

export async function awardForTitle(
  profileId: number,
  via: string,
  mediaId: number,
  kind: MediaKind,
  progress: { seconds: number; unit: number },
): Promise<ToggleResult[]> {
  if (via !== "anilist" && via !== "jikan" && via !== "kitsu") return [];
  const owner = await seriesOwner(via, kind, mediaId);
  const defs = await ensureOwnerPool(via, kind, owner);
  if (!defs.length) return [];
  const bits = seriesProgress(profileId, via, owner.partIds, progress);
  trimToDue(profileId, via, owner.ownerId, kind, bits, owner.partIds);
  const have = earnedForDefs(profileId, via, owner.partIds, defs);
  const due = dueCount(kind, bits, defs.length);
  const now = Date.now();
  const ins = db().prepare(
    `insert into stickers (profile_id, sticker_id, earned_at) values (?, ?, ?)
     on conflict(profile_id, sticker_id) do update set earned_at = excluded.earned_at`,
  );
  const blocked = blockedForDefs(profileId, via, owner.partIds, defs);
  const skip = new Set([...have, ...blocked]);
  const got: ToggleResult[] = [];
  while (have.size < due) {
    const next = pickNext(defs, skip) ?? pickNext(defs, have);
    if (!next) break;
    skip.add(next.id);
    ins.run(profileId, next.id, now);
    have.add(next.id);
    got.push({
      id: next.id,
      name: next.name,
      secret: next.secret,
      earned: true,
      src: artSrc(next.image),
    });
  }
  return got;
}

export function trimToDue(
  profileId: number,
  via: string,
  mediaId: number,
  kind: MediaKind,
  progress: { seconds: number; unit: number },
  partIds?: number[],
): number {
  const ids = partIds?.length ? partIds : [mediaId];
  const defs = readPool(via, mediaId).defs;
  if (!defs.length) return 0;
  const due = dueCount(kind, progress, defs.length);
  const prefixes = ids.flatMap((id) => [`${via}:${id}:c:`, `${via}:${id}:x:`]);
  const rows = db()
    .prepare(
      `select sticker_id as id from stickers
       where profile_id = ? and earned_at is not null
       order by earned_at desc, sticker_id desc`,
    )
    .all(profileId) as { id: string }[];
  const mine = rows.filter((r) => prefixes.some((p) => r.id.startsWith(p)));
  const seen = new Set<string>();
  const keep: string[] = [];
  const drop: string[] = [];
  for (const row of [...mine].reverse()) {
    const tail = stickerTail(row.id) ?? row.id;
    if (seen.has(tail)) {
      drop.push(row.id);
      continue;
    }
    seen.add(tail);
    keep.push(row.id);
  }
  if (keep.length > due) drop.push(...keep.slice(due));
  if (!drop.length) return 0;
  const upd = db().prepare(
    "update stickers set earned_at = null where profile_id = ? and sticker_id = ?",
  );
  let n = 0;
  for (const id of drop) {
    if (upd.run(profileId, id).changes) n++;
  }
  return n;
}

export function grantSticker(profileId: number, stickerId: string): ToggleResult | null {
  return writeSticker(profileId, stickerId, Date.now());
}

export function revokeSticker(profileId: number, stickerId: string): ToggleResult | null {
  // Null earned_at skips this id on the next roll; due still fills with others.
  return writeSticker(profileId, stickerId, null);
}

export function toggleSticker(profileId: number, stickerId: string): ToggleResult | null {
  const row = db()
    .prepare("select earned_at as t from stickers where profile_id = ? and sticker_id = ?")
    .get(profileId, stickerId) as { t: number | null } | undefined;
  return row?.t != null ? revokeSticker(profileId, stickerId) : grantSticker(profileId, stickerId);
}

export async function collectionFor(
  profileId: number,
  items: { via: ProviderSlug; id: number; kind: MediaKind; title: string; href: string }[],
): Promise<TitleStickers[]> {
  const unique: {
    item: (typeof items)[number];
    owner: Awaited<ReturnType<typeof seriesOwner>>;
  }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i += 3) {
    const owners = await Promise.all(items.slice(i, i + 3).map(async (item) => ({
      item,
      owner: await seriesOwner(item.via, item.kind, item.id),
    })));
    for (const { item, owner } of owners) {
      const k = `${item.via}:${item.kind}:${owner.ownerId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push({
        owner,
        item: {
          ...item,
          id: owner.ownerId,
          title: owner.title || item.title,
          href: `/title/${item.via}/${item.kind}/${owner.ownerId}`,
        },
      });
    }
  }
  const out: TitleStickers[] = [];
  for (let i = 0; i < unique.length; i += 3) {
    const chunk = unique.slice(i, i + 3);
    out.push(...(await Promise.all(chunk.map(({ item, owner }) => titleStickers(profileId, item, owner)))));
  }
  return out;
}

async function titleStickers(
  profileId: number,
  item: { via: ProviderSlug; id: number; kind: MediaKind; title: string; href: string },
  owner: Awaited<ReturnType<typeof seriesOwner>>,
): Promise<TitleStickers> {
  const bits = seriesProgress(profileId, item.via, owner.partIds);
  await awardForTitle(profileId, item.via, owner.ownerId, item.kind, bits);
  const defs = readPool(item.via, owner.ownerId).defs;
  const have = earnedForDefs(profileId, item.via, owner.partIds, defs);
  return {
    via: item.via,
    id: owner.ownerId,
    kind: item.kind,
    title: owner.title || item.title,
    href: item.href,
    watched: bits.seconds,
    earned: [...have].filter((id) => defs.some((d) => d.id === id)).length,
    slots: defs.map((d) => {
      const earned = have.has(d.id);
      return {
        ...d,
        earned,
        src: d.secret && !earned ? null : artSrc(d.image),
      };
    }),
  };
}

function progressBits(profileId: number, via: string, mediaId: number): { seconds: number; unit: number } {
  const row = db()
    .prepare(
      "select watched_seconds as seconds, unit from progress where profile_id = ? and via = ? and media_id = ?",
    )
    .get(profileId, via, mediaId) as { seconds: number; unit: number } | undefined;
  return { seconds: row?.seconds ?? 0, unit: row?.unit ?? 0 };
}

function seriesProgress(
  profileId: number,
  via: string,
  partIds: number[],
  fallback?: { seconds: number; unit: number },
): { seconds: number; unit: number } {
  const ids = partIds.filter((id) => id > 0);
  if (ids.length <= 1) return fallback ?? progressBits(profileId, via, ids[0] ?? 0);
  const qs = ids.map(() => "?").join(",");
  const row = db()
    .prepare(
      `select coalesce(sum(watched_seconds), 0) as seconds, coalesce(sum(unit), 0) as unit
       from progress where profile_id = ? and via = ? and media_id in (${qs})`,
    )
    .get(profileId, via, ...ids) as { seconds: number; unit: number };
  return { seconds: row.seconds, unit: row.unit };
}

async function seriesOwner(
  via: string,
  kind: MediaKind,
  id: number,
): Promise<{ ownerId: number; partIds: number[]; title?: string }> {
  if (kind !== "anime" || (via !== "anilist" && via !== "jikan" && via !== "kitsu")) {
    return { ownerId: id, partIds: [id] };
  }
  const s = await fetchSeries(via, kind, id);
  if (!s.ok || s.value.parts.length < 2) return { ownerId: id, partIds: [id] };
  const partIds = s.value.parts.map((p) => p.id).filter((n) => n > 0);
  if (partIds.length < 2) return { ownerId: id, partIds: [id] };
  const ownerId = s.value.rootId > 0 ? s.value.rootId : partIds[0];
  if (!partIds.includes(ownerId)) partIds.unshift(ownerId);
  return { ownerId, partIds, title: s.value.title };
}

function earnedForDefs(
  profileId: number,
  via: string,
  partIds: number[],
  defs: StickerDef[],
): Set<string> {
  return mapToDefs(idsForTitles(profileId, via, partIds, true), defs);
}

function blockedForDefs(
  profileId: number,
  via: string,
  partIds: number[],
  defs: StickerDef[],
): Set<string> {
  return mapToDefs(idsForTitles(profileId, via, partIds, false), defs);
}

function mapToDefs(raw: Set<string>, defs: StickerDef[]): Set<string> {
  const byTail = new Map<string, string>();
  for (const d of defs) {
    const tail = stickerTail(d.id);
    if (tail) byTail.set(tail, d.id);
  }
  const out = new Set<string>();
  for (const id of raw) {
    const tail = stickerTail(id);
    out.add((tail && byTail.get(tail)) || id);
  }
  return out;
}

function idsForTitles(profileId: number, via: string, mediaIds: number[], earned: boolean): Set<string> {
  const prefixes = mediaIds.flatMap((id) => [`${via}:${id}:c:`, `${via}:${id}:x:`]);
  if (!prefixes.length) return new Set();
  const rows = db()
    .prepare(
      earned
        ? "select sticker_id as id from stickers where profile_id = ? and earned_at is not null"
        : "select sticker_id as id from stickers where profile_id = ? and earned_at is null",
    )
    .all(profileId) as { id: string }[];
  return new Set(rows.map((r) => r.id).filter((id) => prefixes.some((p) => id.startsWith(p))));
}

function writeSticker(
  profileId: number,
  stickerId: string,
  earnedAt: number | null,
): ToggleResult | null {
  const def = findDef(stickerId);
  if (!def) return null;
  db()
    .prepare(
      `insert into stickers (profile_id, sticker_id, earned_at) values (?, ?, ?)
       on conflict(profile_id, sticker_id) do update set earned_at = excluded.earned_at`,
    )
    .run(profileId, def.id, earnedAt);
  const earned = earnedAt != null;
  return {
    id: def.id,
    name: def.name,
    secret: def.secret,
    earned,
    src: def.secret && !earned ? null : artSrc(def.image),
  };
}

function findDef(stickerId: string): StickerDef | null {
  const m = /^(anilist|jikan|kitsu):(\d+):[cx]:/.exec(stickerId);
  if (!m) return null;
  return readPool(m[1], Number(m[2])).defs.find((d) => d.id === stickerId) ?? null;
}

type PoolPayload = { v: number; defs: StickerDef[] };

function readPool(via: string, mediaId: number): { defs: StickerDef[]; v: number } {
  const row = db()
    .prepare("select payload from sticker_pools where via = ? and media_id = ?")
    .get(via, mediaId) as { payload: string } | undefined;
  if (!row) return { defs: [], v: 0 };
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    if (Array.isArray(parsed)) return { defs: parsed as StickerDef[], v: 0 };
    const p = parsed as PoolPayload;
    if (p?.v >= 1 && Array.isArray(p.defs)) return { defs: p.defs, v: p.v };
    return { defs: [], v: 0 };
  } catch {
    return { defs: [], v: 0 };
  }
}

async function ensureOwnerPool(
  via: ProviderSlug,
  kind: MediaKind,
  owner: { ownerId: number; partIds: number[] },
): Promise<StickerDef[]> {
  const id = owner.ownerId;
  const raw = db()
    .prepare("select via, media_id, payload, fetched_at from sticker_pools where via = ? and media_id = ?")
    .get(via, id) as PoolRow | undefined;
  const row = raw && plain(raw);
  const { defs: have, v } = row ? readPool(via, id) : { defs: [] as StickerDef[], v: 0 };
  const filled = hasRegular(have);
  if (v >= POOL_V && row && filled && Date.now() - row.fetched_at < POOL_TTL) return have;
  if (v >= POOL_V && row && !filled && have.length === 0 && Date.now() - row.fetched_at < EMPTY_TTL) {
    return have;
  }
  let defs = await fetchPool(via, kind, owner);
  if (!hasRegular(defs)) {
    const cached = reusePartPool(via, owner);
    if (hasRegular(cached)) defs = cached;
    else if (filled) return have;
    else return defs;
  }
  for (const d of defs) if (d.image) rememberArt(d.image);
  db()
    .prepare(
      `insert into sticker_pools (via, media_id, payload, fetched_at) values (?, ?, ?, ?)
       on conflict(via, media_id) do update set payload = excluded.payload, fetched_at = excluded.fetched_at`,
    )
    .run(via, id, JSON.stringify({ v: POOL_V, defs } satisfies PoolPayload), Date.now());
  return defs;
}

function reusePartPool(
  via: string,
  owner: { ownerId: number; partIds: number[] },
): StickerDef[] {
  for (const pid of [owner.ownerId, ...owner.partIds]) {
    const defs = remapPoolIds(readPool(via, pid).defs, via, owner.ownerId);
    if (hasRegular(defs)) return defs;
  }
  return [];
}

async function fetchPool(
  via: ProviderSlug,
  kind: MediaKind,
  owner: { ownerId: number; partIds: number[] },
): Promise<StickerDef[]> {
  if (kind !== "anime" || owner.partIds.length < 2) {
    const cast = await fetchCast(via, kind, owner.ownerId, true);
    return pack(via, owner.ownerId, cast.chars.slice(0, CHAR_CAP), cast.secrets);
  }
  const casts = await fetchSeriesCasts(via, kind, owner.partIds);
  let chars = mergeSeriesChars(casts.map((c) => c.chars));
  let secrets = casts.find((c) => c.secrets.some((s) => s.image))?.secrets ?? casts[0]?.secrets ?? [];
  if (!chars.length) {
    const lone = await fetchCast(via, kind, owner.ownerId, true);
    chars = lone.chars.slice(0, CHAR_CAP);
    if (lone.secrets.length) secrets = lone.secrets;
  }
  return pack(via, owner.ownerId, chars, secrets);
}

async function fetchSeriesCasts(
  via: ProviderSlug,
  kind: MediaKind,
  partIds: number[],
): Promise<Cast[]> {
  if (!partIds.length) return [];
  const first = await fetchCast(via, kind, partIds[0], true);
  const rest: Cast[] = [];
  const ids = partIds.slice(1);
  for (let i = 0; i < ids.length; i += 2) {
    rest.push(
      ...(await Promise.all(ids.slice(i, i + 2).map((pid) => fetchCast(via, kind, pid, false)))),
    );
  }
  return [first, ...rest];
}

async function fetchCast(
  via: ProviderSlug,
  kind: MediaKind,
  id: number,
  wantSecrets: boolean,
): Promise<Cast> {
  if (via === "anilist") return anilistCast(kind, id, wantSecrets);
  if (via === "kitsu") return kitsuCast(kind, id, wantSecrets);
  return jikanCast(kind, id, wantSecrets);
}

type Cast = {
  chars: CastChar[];
  secrets: { id: string | number; name: string; image: string | null }[];
};

function pack(
  via: ProviderSlug,
  mediaId: number,
  chars: { id: string | number; name: string; image: string | null }[],
  secrets: { id: string | number; name: string; image: string | null }[],
): StickerDef[] {
  const main = chars.slice(0, SERIES_CHAR_MAX).map((c) => ({
    id: `${via}:${mediaId}:c:${c.id}`,
    name: c.name,
    image: publicHttps(c.image),
    secret: false,
  }));
  const extra =
    main.length || secrets.some((s) => s.image)
      ? Array.from({ length: SECRET_COUNT }, (_, i) => {
          const s = secrets[i];
          return {
            id: `${via}:${mediaId}:x:${i + 1}`,
            name: s?.name ?? "Secret",
            image: publicHttps(s?.image ?? null),
            secret: true,
          };
        })
      : [];
  return [...main, ...extra];
}

async function anilistCast(kind: MediaKind, id: number, wantSecrets = true): Promise<Cast> {
  const type = kind === "anime" ? "ANIME" : "MANGA";
  const r = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "Lacrima/0.1 (self-hosted)",
    },
    body: JSON.stringify({
      query: `query ($id: Int!, $type: MediaType) {
        Media(id: $id, type: $type) {
          characters(sort: [ROLE, RELEVANCE], perPage: 25) {
            edges { role node { id name { full } image { large } } }
          }
          streamingEpisodes { title thumbnail }
        }
      }`,
      variables: { id, type },
    }),
    signal: AbortSignal.timeout(4_000),
  }).catch(() => null);
  if (!r?.ok) return { chars: [], secrets: [] };
  const json = (await r.json()) as {
    data?: {
      Media?: {
        characters?: {
          edges?: {
            role?: string;
            node?: { id: number; name?: { full?: string | null }; image?: { large?: string | null } };
          }[];
        };
        streamingEpisodes?: { title?: string | null; thumbnail?: string | null }[];
      };
    };
  };
  const media = json.data?.Media;
  const chars = (media?.characters?.edges ?? [])
    .map((e) => ({
      id: e.node?.id ?? 0,
      name: e.node?.name?.full ?? "Character",
      image: e.node?.image?.large ?? null,
      main: e.role === "MAIN",
    }))
    .filter((c) => c.id)
    .sort((a, b) => Number(b.main) - Number(a.main));
  const secrets = wantSecrets
    ? (media?.streamingEpisodes ?? [])
        .filter((e) => e.thumbnail)
        .map((e, i) => ({ id: i + 1, name: e.title?.trim() || "Episode", image: e.thumbnail ?? null }))
    : [];
  return { chars, secrets };
}

async function kitsuCast(kind: MediaKind, id: number, wantSecrets = true): Promise<Cast> {
  const type = kind === "anime" ? "anime" : "manga";
  const rel = kind === "anime" ? "anime-characters" : "manga-characters";
  const [cast, eps] = await Promise.all([
    kitsuJson(`/${type}/${id}/${rel}?include=character&page[limit]=20`),
    kind === "anime" && wantSecrets
      ? kitsuJson(`/anime/${id}/episodes?page[limit]=8&sort=number`)
      : Promise.resolve(null),
  ]);
  const included = new Map(
    (cast?.included ?? [])
      .filter((x) => x.type === "characters")
      .map((x) => [x.id, x]),
  );
  const chars = (cast?.data ?? [])
    .map((row) => {
      const cid = row.relationships?.character?.data?.id;
      const c = cid ? included.get(cid) : undefined;
      const img = c?.attributes?.image;
      return {
        id: cid ?? row.id,
        name: String(c?.attributes?.canonicalName || c?.attributes?.name || "Character"),
        image: img?.original ?? img?.large ?? null,
        main: row.attributes?.role === "main",
      };
    })
    .sort((a, b) => Number(b.main) - Number(a.main));
  const secrets = (eps?.data ?? [])
    .filter((e) => e.attributes?.thumbnail?.original)
    .map((e) => ({
      id: e.id,
      name: `Episode ${e.attributes?.number ?? e.id}`,
      image: e.attributes?.thumbnail?.original ?? null,
    }));
  if (chars.length) return { chars, secrets };
  const aid = await kitsuMappedAnilist(type, id);
  if (!aid) return { chars, secrets };
  return anilistCast(kind, aid, wantSecrets);
}

type KitsuDoc = {
  data?: {
    id: string;
    type: string;
    attributes?: {
      role?: string;
      number?: number;
      canonicalName?: string;
      name?: string;
      externalSite?: string;
      externalId?: string;
      thumbnail?: { original?: string; large?: string };
      image?: { original?: string; large?: string };
    };
    relationships?: { character?: { data?: { id: string } } };
  }[];
  included?: {
    id: string;
    type: string;
    attributes?: {
      canonicalName?: string;
      name?: string;
      image?: { original?: string; large?: string };
    };
  }[];
};

async function kitsuMappedAnilist(type: string, id: number): Promise<number | null> {
  const doc = await kitsuJson(`/${type}/${id}/mappings`);
  const site = `anilist/${type}`;
  const hit = (doc?.data ?? []).find((d) => d.attributes?.externalSite === site);
  const n = Number(hit?.attributes?.externalId);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function kitsuJson(path: string): Promise<KitsuDoc | null> {
  const r = await fetch(`https://kitsu.app/api/edge${path}`, {
    headers: { accept: "application/vnd.api+json" },
    signal: AbortSignal.timeout(4_000),
  }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json()) as KitsuDoc;
}

async function jikanCast(kind: MediaKind, id: number, wantSecrets = true): Promise<Cast> {
  const type = kind === "anime" ? "anime" : "manga";
  const [cast, pics] = await Promise.all([
    jikanJson(`/${type}/${id}/characters`),
    wantSecrets ? jikanJson(`/${type}/${id}/pictures`) : Promise.resolve(null),
  ]);
  const chars = (cast?.data ?? [])
    .map((row) => ({
      id: row.character?.mal_id ?? 0,
      name: row.character?.name ?? "Character",
      image: row.character?.images?.jpg?.image_url ?? null,
      main: row.role === "Main",
    }))
    .filter((c) => c.id)
    .sort((a, b) => Number(b.main) - Number(a.main));
  const secrets = (pics?.data ?? [])
    .map((row, i) => ({
      id: i + 1,
      name: "Secret",
      image: row.jpg?.large_image_url ?? row.jpg?.image_url ?? null,
    }))
    .filter((s) => s.image);
  return { chars, secrets };
}

type JikanDoc = {
  data?: {
    role?: string;
    character?: {
      mal_id?: number;
      name?: string;
      images?: { jpg?: { image_url?: string | null } };
    };
    jpg?: { large_image_url?: string | null; image_url?: string | null };
  }[];
};

async function jikanJson(path: string): Promise<JikanDoc | null> {
  const r = await fetch(`https://api.jikan.moe/v4${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(4_000),
  }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json()) as JikanDoc;
}

function publicHttps(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "::1") return null;
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(host)) return null;
    if (host.startsWith("[")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function artRoot() {
  const dbFile = process.env.LACRIMA_DB ?? join(process.cwd(), "data", "lacrima.db");
  return join(dirname(dbFile), "cache", "stickers");
}

export function artHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function rememberArt(url: string) {
  db()
    .prepare("insert or ignore into sticker_art (hash, url) values (?, ?)")
    .run(artHash(url), url);
}

export function artSrc(url: string | null): string | null {
  if (!url) return null;
  rememberArt(url);
  return `/api/sticker-art/${artHash(url)}`;
}

export function loadArtFile(hash: string): { body: Buffer; mime: string } | null {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const file = join(artRoot(), hash);
  if (!existsSync(file)) return null;
  const row = db().prepare("select mime from sticker_art where hash = ?").get(hash) as
    | { mime: string | null }
    | undefined;
  return { body: readFileSync(file), mime: row?.mime || "image/jpeg" };
}

export async function ensureArtFile(hash: string): Promise<{ body: Buffer; mime: string } | null> {
  const hit = loadArtFile(hash);
  if (hit) return hit;
  const row = db().prepare("select url from sticker_art where hash = ?").get(hash) as
    | { url: string }
    | undefined;
  const url = publicHttps(row?.url);
  if (!url) return null;
  const res = await fetch(url, {
    headers: { accept: "image/*,*/*", "user-agent": "Lacrima/0.1 (self-hosted)" },
    signal: AbortSignal.timeout(8_000),
    redirect: "follow",
  }).catch(() => null);
  if (!res?.ok) return null;
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  if (!mime.startsWith("image/")) return null;
  const body = Buffer.from(await res.arrayBuffer());
  mkdirSync(artRoot(), { recursive: true });
  writeFileSync(join(artRoot(), hash), body);
  db().prepare("update sticker_art set mime = ? where hash = ?").run(mime, hash);
  return { body, mime };
}

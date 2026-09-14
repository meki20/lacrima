import { db, plain, plainAll } from "./db.ts";
import { stickerEarned, stickerFace } from "./stickers.ts";
import {
  CHROME,
  chromeKind,
  clampCoord,
  clampRot,
  clampScale,
  pagePath,
  parseSurface,
  placeBlocked,
  type Surface,
} from "./sticker-place.ts";

export type Placement = {
  id: number;
  stickerId: string;
  path: string;
  x: number;
  y: number;
  scale: number;
  rot: number;
  name: string;
  src: string;
};

type Row = {
  id: number;
  stickerId: string;
  path: string;
  x: number;
  y: number;
  scale: number;
  rot: number;
};

function hydrate(row: Row): Placement | null {
  const face = stickerFace(row.stickerId);
  if (!face?.src) return null;
  return {
    id: row.id,
    stickerId: row.stickerId,
    path: row.path,
    x: clampCoord(row.x),
    y: clampCoord(row.y),
    scale: clampScale(row.scale),
    rot: clampRot(row.rot),
    name: face.name,
    src: face.src,
  };
}

function rowsFor(profileId: number, surface: Surface, paths: string[]): Row[] {
  if (!paths.length) return [];
  const qs = paths.map(() => "?").join(",");
  return plainAll(
    db()
      .prepare(
        `select id, sticker_id as stickerId, path, x, y, scale, rot
         from sticker_placements where profile_id = ? and surface = ? and path in (${qs}) order by id`,
      )
      .all(profileId, surface, ...paths) as Row[],
  );
}

export function listPlacements(profileId: number, rawPath: string, rawSurface?: string): Placement[] {
  const path = pagePath(rawPath);
  const surface = parseSurface(rawSurface);
  const paths: string[] = [CHROME.sidebar, CHROME.topbar];
  if (path && !placeBlocked(path)) paths.push(path);
  return rowsFor(profileId, surface, paths).flatMap((row) => {
    const p = hydrate(row);
    return p ? [p] : [];
  });
}

export function addPlacement(
  profileId: number,
  input: {
    stickerId: string;
    path: string;
    x: number;
    y: number;
    scale: number;
    rot?: number;
    surface?: string;
  },
): Placement | null {
  const path = pagePath(input.path);
  const stickerId = input.stickerId.trim();
  const surface = parseSurface(input.surface);
  if (!path || (!chromeKind(path) && placeBlocked(path)) || !stickerId) return null;
  if (!stickerEarned(profileId, stickerId)) return null;
  const face = stickerFace(stickerId);
  if (!face?.src) return null;
  const x = clampCoord(input.x);
  const y = clampCoord(input.y);
  const scale = clampScale(input.scale);
  const rot = clampRot(input.rot ?? 0);
  const id = Number(
    db()
      .prepare(
        `insert into sticker_placements (profile_id, sticker_id, path, x, y, scale, rot, surface)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(profileId, stickerId, path, x, y, scale, rot, surface).lastInsertRowid,
  );
  return { id, stickerId, path, x, y, scale, rot, name: face.name, src: face.src };
}

export function movePlacement(
  profileId: number,
  id: number,
  patch: { x?: number; y?: number; scale?: number; rot?: number; path?: string },
): Placement | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  const raw = db()
    .prepare(
      `select id, sticker_id as stickerId, path, x, y, scale, rot
       from sticker_placements where id = ? and profile_id = ?`,
    )
    .get(id, profileId) as Row | undefined;
  if (!raw) return null;
  const row = plain(raw);
  const nextPath = patch.path == null ? row.path : pagePath(patch.path);
  if (!nextPath || (!chromeKind(nextPath) && placeBlocked(nextPath))) return null;
  const x = patch.x == null ? row.x : clampCoord(patch.x);
  const y = patch.y == null ? row.y : clampCoord(patch.y);
  const scale = patch.scale == null ? row.scale : clampScale(patch.scale);
  const rot = patch.rot == null ? row.rot : clampRot(patch.rot);
  db()
    .prepare(
      "update sticker_placements set path = ?, x = ?, y = ?, scale = ?, rot = ? where id = ? and profile_id = ?",
    )
    .run(nextPath, x, y, scale, rot, id, profileId);
  return hydrate({ ...row, path: nextPath, x, y, scale, rot });
}

export function removePlacement(profileId: number, id: number): boolean {
  if (!Number.isInteger(id) || id <= 0) return false;
  return (
    db().prepare("delete from sticker_placements where id = ? and profile_id = ?").run(id, profileId)
      .changes > 0
  );
}

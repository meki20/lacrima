import { cookies } from "next/headers";
import { db, plain, plainAll } from "./db.ts";
import { ACCENTS, parseHex, parseName, parseWallpaper } from "./theme.ts";

export { ACCENTS, parseHex, parseName, parseWallpaper } from "./theme.ts";

export const COOKIE = "lacrima_profile";
export const MAX_PROFILES = 10;

export type Profile = {
  id: number;
  name: string;
  avatar_color: string;
  accent: string;
  wallpaper: string | null;
  created_at: number;
};

const COLS = "id, name, avatar_color, accent, wallpaper, created_at";

export function allProfiles(): Profile[] {
  return plainAll(db().prepare(`select ${COLS} from profiles order by id`).all() as Profile[]);
}

/** Falls back to the first profile so the app is never in a profile-less state. */
export async function currentProfile(): Promise<Profile> {
  const wanted = Number((await cookies()).get(COOKIE)?.value);
  const rows = allProfiles();
  return rows.find((p) => p.id === wanted) ?? rows[0];
}

export function createProfile(name: string, accent = ACCENTS[0]): Profile | { error: string } {
  const n = parseName(name);
  if (!n) return { error: "Name needs to be 1–24 characters." };
  const people = allProfiles();
  if (people.length >= MAX_PROFILES) return { error: "A household can hold 10 profiles." };
  const color = parseHex(accent) ?? ACCENTS[0];
  const id = Number(
    db()
      .prepare("insert into profiles (name, avatar_color, accent, created_at) values (?, ?, ?, ?)")
      .run(n, color, color, Date.now()).lastInsertRowid,
  );
  return plain(
    db().prepare(`select ${COLS} from profiles where id = ?`).get(id) as Profile,
  );
}

export function updateProfile(
  id: number,
  patch: { name?: string; accent?: string; wallpaper?: string | null; avatar_color?: string },
): Profile | { error: string } {
  const row = db().prepare(`select ${COLS} from profiles where id = ?`).get(id) as Profile | undefined;
  if (!row) return { error: "No such profile." };
  const name = patch.name == null ? row.name : parseName(patch.name);
  if (!name) return { error: "Name needs to be 1–24 characters." };
  const accent = patch.accent == null ? row.accent : parseHex(patch.accent);
  if (!accent) return { error: "Accent must be a hex colour." };
  const avatar = patch.avatar_color == null ? row.avatar_color : parseHex(patch.avatar_color);
  if (!avatar) return { error: "Avatar colour must be a hex colour." };
  const wallpaper =
    patch.wallpaper === undefined ? row.wallpaper : parseWallpaper(patch.wallpaper);
  db()
    .prepare("update profiles set name = ?, accent = ?, avatar_color = ?, wallpaper = ? where id = ?")
    .run(name, accent, avatar, wallpaper, id);
  return { ...row, name, accent, avatar_color: avatar, wallpaper };
}

export function deleteProfile(id: number): { ok: true } | { error: string } {
  const people = allProfiles();
  if (people.length <= 1) return { error: "The last profile has to stay." };
  if (!people.some((p) => p.id === id)) return { error: "No such profile." };
  db().prepare("delete from profiles where id = ?").run(id);
  return { ok: true };
}

export function topGenre(profileId: number): string {
  return profileGenres(profileId, 1)[0] ?? "Adventure";
}

export function profileGenres(profileId: number, n = 3): string[] {
  const rows = plainAll(
    db()
      .prepare(
        "select genre from profile_genres where profile_id = ? order by weight desc limit ?",
      )
      .all(profileId, n) as { genre: string }[],
  );
  return rows.length ? rows.map((r) => r.genre) : ["Adventure"];
}

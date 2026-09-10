import { cookies } from "next/headers";
import { db, plainAll } from "./db.ts";

export const COOKIE = "lacrima_profile";

export type Profile = {
  id: number;
  name: string;
  avatar_color: string;
  accent: string;
  wallpaper: string | null;
  created_at: number;
};

export function allProfiles(): Profile[] {
  return plainAll(db().prepare("select * from profiles order by id").all() as Profile[]);
}

/** Falls back to the first profile so the app is never in a profile-less state. */
export async function currentProfile(): Promise<Profile> {
  const wanted = Number((await cookies()).get(COOKIE)?.value);
  const rows = allProfiles();
  return rows.find((p) => p.id === wanted) ?? rows[0];
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

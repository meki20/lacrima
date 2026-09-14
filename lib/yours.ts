import { db, plainAll } from "./db.ts";
import type { MediaKind } from "./media.ts";
import type { LibraryItem } from "./library.ts";

export function activityDay(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function isNightHour(at = Date.now()): boolean {
  const h = new Date(at).getHours();
  return h < 5;
}

export function markActivity(
  profileId: number,
  kind: MediaKind,
  bump: { unit: boolean; night: boolean },
) {
  const day = activityDay();
  const anime = bump.unit && kind === "anime" ? 1 : 0;
  const manga = bump.unit && kind === "manga" ? 1 : 0;
  const novel = bump.unit && kind === "novel" ? 1 : 0;
  const night = bump.unit && bump.night ? 1 : 0;
  db()
    .prepare(
      `insert into activity (profile_id, day, anime, manga, novel, night)
       values (?, ?, ?, ?, ?, ?)
       on conflict(profile_id, day) do update set
         anime = anime + excluded.anime,
         manga = manga + excluded.manga,
         novel = novel + excluded.novel,
         night = night + excluded.night`,
    )
    .run(profileId, day, anime, manga, novel, night);
}

export function streakDays(days: string[], today = activityDay()): number {
  const have = new Set(days);
  let n = 0;
  let cursor = today;
  while (have.has(cursor)) {
    n++;
    cursor = shiftDay(cursor, -1);
  }
  return n;
}

export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export type MixShare = { kind: MediaKind; label: string; n: number; pct: number };

export function mixShares(counts: Record<MediaKind, number>): MixShare[] {
  const total = counts.anime + counts.manga + counts.novel;
  const rows: MixShare[] = [
    { kind: "manga", label: "Manga", n: counts.manga, pct: 0 },
    { kind: "anime", label: "Anime", n: counts.anime, pct: 0 },
    { kind: "novel", label: "Novels", n: counts.novel, pct: 0 },
  ];
  if (!total) return rows;
  return rows.map((r) => ({ ...r, pct: Math.round((r.n / total) * 100) }));
}

export function formatStat(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatHours(seconds: number): string {
  const h = Math.max(0, seconds) / 3600;
  if (h < 0.05) return "0";
  if (h < 10) return (Math.round(h * 10) / 10).toString();
  return formatStat(Math.round(h));
}

export type ProfileFacts = {
  titles: number;
  chapters: number;
  episodes: number;
  hours: number;
  watchedSeconds: number;
  streak: number;
};

export function collectFacts(
  items: LibraryItem[],
  progress: { media_type: MediaKind; unit: number; watched_seconds?: number }[],
  activity: { day: string; anime: number; manga: number; novel: number; night: number }[],
): ProfileFacts {
  const chapters = progress
    .filter((p) => p.media_type !== "anime")
    .reduce((n, p) => n + Math.max(0, p.unit), 0);
  const episodes = progress
    .filter((p) => p.media_type === "anime")
    .reduce((n, p) => n + Math.max(0, p.unit), 0);
  const watchedSeconds = progress.reduce((n, p) => n + Math.max(0, p.watched_seconds ?? 0), 0);
  return {
    titles: items.length,
    chapters,
    episodes,
    hours: Math.round((watchedSeconds / 3600) * 10) / 10,
    watchedSeconds,
    streak: streakDays(activity.map((a) => a.day)),
  };
}

export function loadActivity(profileId: number) {
  return plainAll(
    db()
      .prepare(
        "select day, anime, manga, novel, night from activity where profile_id = ? order by day desc",
      )
      .all(profileId) as {
      day: string;
      anime: number;
      manga: number;
      novel: number;
      night: number;
    }[],
  );
}

export function loadProgress(profileId: number): {
  media_type: MediaKind;
  unit: number;
  watched_seconds: number;
}[] {
  return plainAll(
    db()
      .prepare("select media_type, unit, watched_seconds from progress where profile_id = ?")
      .all(profileId) as { media_type: MediaKind; unit: number; watched_seconds: number }[],
  );
}

export function monthMix(
  activity: { day: string; anime: number; manga: number; novel: number }[],
  month = activityDay().slice(0, 7),
): MixShare[] {
  const counts: Record<MediaKind, number> = { anime: 0, manga: 0, novel: 0 };
  for (const a of activity) {
    if (!a.day.startsWith(month)) continue;
    counts.anime += a.anime;
    counts.manga += a.manga;
    counts.novel += a.novel;
  }
  return mixShares(counts);
}

export function wallStyle(wallpaper: string | null): {
  background?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
} {
  if (!wallpaper) {
    return { background: "color-mix(in srgb, var(--accent) 38%, #14110f)" };
  }
  if (wallpaper.startsWith("#")) return { background: wallpaper };
  return {
    backgroundImage: `url(${wallpaper})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

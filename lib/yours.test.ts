import assert from "node:assert/strict";
import { test } from "node:test";
import type { LibraryItem } from "./library.ts";
import {
  activityDay,
  collectFacts,
  formatHours,
  formatStat,
  mixShares,
  monthMix,
  shiftDay,
  streakDays,
  wallStyle,
} from "./yours.ts";

const item = (over: Partial<LibraryItem> & { id: number }): LibraryItem => ({
  via: "kitsu",
  kind: "manga",
  status: "reading",
  score: null,
  added_at: 1,
  title: "X",
  cover: null,
  color: null,
  units: null,
  genres: [],
  pin: 0,
  unit: 1,
  href: "/",
  ...over,
});

test("streak counts consecutive days ending today, and breaks on a gap", () => {
  const today = "2026-09-14";
  assert.equal(streakDays([today, "2026-09-13", "2026-09-12"], today), 3);
  assert.equal(streakDays(["2026-09-13", "2026-09-12"], today), 0);
  assert.equal(shiftDay("2026-09-01", -1), "2026-08-31");
  assert.equal(activityDay(Date.parse("2026-09-14T18:00:00Z")), "2026-09-14");
});

test("stats and mix are local facts, not metadata", () => {
  const facts = collectFacts(
    [
      item({ id: 1, kind: "manga", status: "completed", score: 8, pin: 1 }),
      item({ id: 2, kind: "anime" }),
      item({ id: 3, kind: "novel" }),
    ],
    [
      { media_type: "manga", unit: 12, watched_seconds: 0 },
      { media_type: "anime", unit: 10, watched_seconds: 5400 },
      { media_type: "novel", unit: 2, watched_seconds: 0 },
    ],
    [{ day: "2026-09-14", anime: 3, manga: 5, novel: 2, night: 4 }],
  );
  assert.equal(facts.titles, 3);
  assert.equal(facts.chapters, 14);
  assert.equal(facts.episodes, 10);
  assert.equal(facts.hours, 1.5);
  assert.equal(facts.watchedSeconds, 5400);
  assert.equal(formatHours(5400), "1.5");
  assert.equal(formatHours(0), "0");
  assert.equal(formatStat(1840), "1 840");
  const mix = monthMix(
    [
      { day: "2026-09-01", anime: 1, manga: 3, novel: 0 },
      { day: "2026-08-31", anime: 9, manga: 9, novel: 9 },
    ],
    "2026-09",
  );
  assert.equal(mix.find((m) => m.kind === "manga")?.pct, 75);
  assert.deepEqual(
    mixShares({ anime: 0, manga: 0, novel: 0 }).map((m) => m.pct),
    [0, 0, 0],
  );
});

test("wallpaper is a colour, an image, or a derived mix of the accent", () => {
  assert.equal(wallStyle("#1d2733").background, "#1d2733");
  assert.ok(wallStyle("https://img.example/w.png").backgroundImage?.includes("https://img.example/w.png"));
  assert.ok(wallStyle(null).background?.includes("accent"));
});

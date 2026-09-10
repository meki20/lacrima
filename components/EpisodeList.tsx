"use client";

import { useMemo, useState } from "react";
import { windowEpisodes } from "@/lib/series";

export type EpisodeRow = {
  id: string;
  number: number;
  name: string;
  season?: number | null;
  scanlator: string | null;
  thumbnailUrl?: string | null;
  overview?: string | null;
};

function rank(s: number) {
  return s > 0 ? s : 1000;
}

function label(s: number) {
  return s > 0 ? `Season ${s}` : "Specials";
}

function seasonTag(s: number | null | undefined) {
  if (s == null) return null;
  return s > 0 ? `S${s}` : "Specials";
}

export default function EpisodeList({
  episodes,
  readingId,
  base,
  hideSeasons = false,
  seasonHint = null,
  episodeOffset = 0,
  episodeCount = null,
}: {
  episodes: EpisodeRow[];
  readingId: string | null;
  /** `/read/{via}/{kind}/{id}/` — episode id is encoded on the end. */
  base: string;
  hideSeasons?: boolean;
  seasonHint?: number | null;
  /** Absolute-position window for a multi-part franchise. See lib/series.ts. */
  episodeOffset?: number;
  episodeCount?: number | null;
}) {
  const seasons = useMemo(() => {
    const set = new Set(episodes.map((e) => e.season ?? 1));
    return [...set].sort((a, b) => rank(a) - rank(b));
  }, [episodes]);

  const initial = seasonHint && seasons.includes(seasonHint)
    ? seasonHint
    : (seasons.find((s) => s > 0) ?? seasons[0] ?? 1);
  const [season, setSeason] = useState(initial);
  const shown = hideSeasons
    ? windowEpisodes(episodes, episodeOffset, episodeCount, seasonHint)
    : seasons.length > 1
      ? (() => {
          const hit = episodes.filter((e) => (e.season ?? 1) === season);
          return hit.length ? hit : episodes;
        })()
      : episodes;

  return (
    <>
      {seasons.length > 1 && !hideSeasons && (
        <div className="filters" style={{ margin: "0 0 12px" }}>
          {seasons.map((s) => (
            <button
              type="button"
              key={s}
              className={`chip${season === s ? " on" : ""}`}
              onClick={() => setSeason(s)}
            >
              {label(s)}
            </button>
          ))}
        </div>
      )}
      <div className="rows eps scrollbox">
        {shown.map((c) => {
          const here = c.id === readingId;
          const tag = seasonTag(c.season);
          return (
            <a
              className={`row${here ? " here" : ""}`}
              key={c.id}
              href={`${base}${encodeURIComponent(c.id)}`}
            >
              <span className="row-thumb">
                {c.thumbnailUrl ? (
                  <img src={c.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                ) : null}
              </span>
              <div className="row-body">
                <h3>{c.name}</h3>
                {here && (tag || c.overview) ? (
                  <p className="row-meta">
                    {tag}
                    {tag && c.overview ? " · " : null}
                    {c.overview}
                  </p>
                ) : null}
              </div>
              {here && <span className="badge">watching</span>}
            </a>
          );
        })}
      </div>
    </>
  );
}

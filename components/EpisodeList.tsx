"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MarkMenu from "./MarkMenu";
import { isChapterRead, pushProgress, type ProgressWrite } from "@/lib/progress-write";

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
  unit,
  progress,
  base,
  indexOffset = 0,
  completed = false,
}: {
  episodes: EpisodeRow[];
  readingId: string | null;
  unit: number;
  progress: Omit<ProgressWrite, "unit" | "chapterId" | "chapterName" | "pages">;
  /** `/read/{via}/{kind}/{id}/` — episode id is encoded on the end. */
  base: string;
  /** When this list is a season window, the index of episodes[0] in the source list. */
  indexOffset?: number;
  completed?: boolean;
}) {
  const router = useRouter();
  const list = useRef<HTMLDivElement>(null);
  const seasons = useMemo(() => {
    const set = new Set(episodes.map((e) => e.season ?? 1));
    return [...set].sort((a, b) => rank(a) - rank(b));
  }, [episodes]);

  const initial = seasons.find((s) => s > 0) ?? seasons[0] ?? 1;
  const [season, setSeason] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(readingId);
  const shown = seasons.length > 1
    ? (() => {
        const hit = episodes.filter((e) => (e.season ?? 1) === season);
        return hit.length ? hit : episodes;
      })()
    : episodes;
  const currentLocal = episodes.findIndex((e) => e.id === readingId);
  const current = currentLocal >= 0 ? indexOffset + currentLocal : -1;

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.deltaY === 0) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      const up = e.deltaY < 0;
      if ((up && el.scrollTop <= 0) || (!up && el.scrollTop >= max - 0.5)) {
        e.preventDefault();
        window.scrollBy(0, e.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const play = (c: EpisodeRow, extra: { skipAhead?: boolean; exact?: boolean } = { skipAhead: true }) => {
    const i = episodes.findIndex((e) => e.id === c.id);
    return pushProgress({
      ...progress,
      unit: indexOffset + i + 1,
      chapterId: extra.exact ? "-" : c.id,
      chapterName: extra.exact ? "" : c.name,
      season: c.season,
      episode: c.number,
      ...extra,
    });
  };

  return (
    <>
      {seasons.length > 1 && (
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
      <div className="rows eps scrollbox" ref={list}>
        {shown.map((c) => {
          const i = episodes.findIndex((e) => e.id === c.id);
          const read = completed || isChapterRead(indexOffset + i, current, unit);
          const here = c.id === readingId && !read;
          const selected = c.id === selectedId;
          const tag = seasonTag(c.season);
          return (
            <div
              className={`row${here ? " here" : ""}${selected ? " selected" : ""}${read ? " read" : ""}`}
              key={c.id}
            >
              <button
                type="button"
                className="episode-select"
                aria-expanded={selected}
                onClick={() => setSelectedId((id) => (id === c.id ? null : c.id))}
              >
                <span className="row-thumb">
                  {c.thumbnailUrl ? (
                    <img src={c.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                  ) : null}
                </span>
                <div className="row-body">
                  <h3>
                    <span className="mono">{tag ? `${tag} · E${c.number}` : `E${c.number}`}</span>
                    {c.name}
                  </h3>
                  {c.overview ? (
                    <p className="row-meta" aria-hidden={!selected}>
                      {c.overview}
                    </p>
                  ) : null}
                </div>
                {here && <span className="badge">watching</span>}
              </button>
              <a
                className="btn primary episode-play"
                href={`${base}${encodeURIComponent(c.id)}`}
                aria-hidden={!selected}
                tabIndex={selected ? undefined : -1}
                onClick={(e) => {
                  e.preventDefault();
                  const href = `${base}${encodeURIComponent(c.id)}`;
                  /* Same episode: keep the saved seconds; a skipAhead rewrite
                     would resume at 0. */
                  if (here || read) {
                    router.push(href);
                    return;
                  }
                  void play(c).then(() => router.push(href));
                }}
              >
                Play episode
              </a>
              <MarkMenu
                kind="anime"
                read={indexOffset + i + 1 <= unit}
                onMark={() => void play(c).then(() => router.refresh())}
                onUpTo={() => void play(c, { exact: true }).then(() => router.refresh())}
                onUnmark={() => {
                  if (i > 0) {
                    void play(episodes[i - 1], { exact: true }).then(() => router.refresh());
                    return;
                  }
                  void pushProgress({
                    ...progress,
                    unit: indexOffset,
                    chapterId: "-",
                    chapterName: "",
                    season: c.season,
                    episode: c.number,
                    exact: true,
                  }).then(() => router.refresh());
                }}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import MarkMenu from "./MarkMenu";
import { isChapterRead, pushProgress, type ProgressWrite } from "@/lib/progress-write";

export type ChapterRow = {
  id: string;
  number: number;
  name: string;
  scanlator: string | null;
  pageCount?: number | null;
};

export default function ChapterList({
  chapters,
  readingId,
  unit,
  progress,
  completed = false,
}: {
  chapters: ChapterRow[];
  readingId: string | null;
  unit: number;
  progress: Omit<ProgressWrite, "unit" | "chapterId" | "chapterName" | "pages">;
  completed?: boolean;
}) {
  const router = useRouter();
  const list = useRef<HTMLDivElement>(null);
  const current = chapters.findIndex((c) => c.id === readingId);

  useEffect(() => {
    const box = list.current;
    const read = box?.querySelectorAll<HTMLElement>(".row.read");
    const target = read?.[read.length - 1];
    if (!box || !target) return;
    /* Nested scrollbox: park inside the box. Page scroll (phone): bring into view. */
    if (box.scrollHeight > box.clientHeight + 1) {
      const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      box.scrollTop = top - target.offsetHeight;
    } else {
      target.scrollIntoView({ block: "center" });
    }
  }, [chapters, readingId, unit, completed]);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    /* Wheel at an edge continues the page instead of dying in the box. */
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

  const write = (
    i: number,
    extra: { skipAhead?: boolean; exact?: boolean },
    unit = i + 1,
  ) => {
    const target = extra.exact ? null : unit > 0 ? chapters[unit - 1] ?? chapters[i] : chapters[i];
    return pushProgress({
      ...progress,
      unit,
      chapterId: target?.id ?? "-",
      chapterName: target?.name ?? "",
      pages: target?.pageCount ?? null,
      ...extra,
    }).then(() => router.refresh());
  };

  return (
    <div className="rows scrollbox chapter-scrollbox" ref={list}>
      {chapters.map((c, i) => {
        const read = completed || isChapterRead(i, current, unit);
        const here = c.id === readingId && !read;
        const href = `/read/${progress.via}/${progress.kind}/${progress.mediaId}/${encodeURIComponent(c.id)}`;
        return (
          <div className={`row${here ? " here" : ""}${read ? " read" : ""}`} key={c.id}>
            <a
              className="row-main"
              href={href}
              onClick={(e) => {
                e.preventDefault();
                /* Same chapter: do not rewrite progress — that zeroes the page
                   anchor and "Continue" starts at page 1. New chapter: skipAhead. */
                if (here || read) {
                  router.push(href);
                  return;
                }
                void pushProgress({
                  ...progress,
                  unit: i + 1,
                  chapterId: c.id,
                  chapterName: c.name,
                  pages: c.pageCount ?? null,
                  skipAhead: true,
                }).then(() => router.push(href));
              }}
            >
              <span className="mono" style={{ width: 56 }}>
                {c.number}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3>{c.name}</h3>
                {c.scanlator && <span className="url">{c.scanlator}</span>}
              </div>
              {here && <span className="badge">reading</span>}
              {c.pageCount ? <span className="badge">{c.pageCount}p</span> : null}
            </a>
            <MarkMenu
              kind={progress.kind}
              read={i + 1 <= unit}
              onMark={() => void write(i, { skipAhead: true })}
              onUpTo={() => void write(i, { exact: true })}
              onUnmark={() => void write(i, { exact: true }, i)}
            />
          </div>
        );
      })}
    </div>
  );
}

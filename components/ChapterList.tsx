"use client";

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
}: {
  chapters: ChapterRow[];
  readingId: string | null;
  unit: number;
  progress: Omit<ProgressWrite, "unit" | "chapterId" | "chapterName" | "pages">;
}) {
  const router = useRouter();
  const current = chapters.findIndex((c) => c.id === readingId);

  const write = (
    i: number,
    extra: { skipAhead?: boolean; exact?: boolean },
    unit = i + 1,
  ) => {
    const target = unit > 0 ? chapters[unit - 1] ?? chapters[i] : chapters[i];
    return pushProgress({
      ...progress,
      unit,
      chapterId: target.id,
      chapterName: target.name,
      pages: target.pageCount ?? null,
      ...extra,
    }).then(() => router.refresh());
  };

  return (
    <div className="rows scrollbox">
      {chapters.map((c, i) => {
        const here = c.id === readingId;
        const read = isChapterRead(i, current, unit);
        const href = `/read/${progress.via}/${progress.kind}/${progress.mediaId}/${encodeURIComponent(c.id)}`;
        return (
          <div className={`row${here ? " here" : ""}${read ? " read" : ""}`} key={c.id}>
            <a
              className="row-main"
              href={href}
              onClick={(e) => {
                e.preventDefault();
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

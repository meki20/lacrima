"use client";

import { useMemo, useState } from "react";

export type MatchRow = {
  confidence: number;
  manga: {
    id: string;
    sourceId: string;
    sourceName: string;
    title: string;
    chapterCount: number | null;
  };
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

export default function MatchList({
  candidates,
  expectedTitles,
  unit,
  backendName,
  pick,
}: {
  candidates: MatchRow[];
  expectedTitles: string[];
  unit: string;
  backendName: string;
  pick: (formData: FormData) => void | Promise<void>;
}) {
  const sources = useMemo(
    () => [...new Set(candidates.map((c) => c.manga.sourceName))],
    [candidates],
  );
  const [source, setSource] = useState("all");
  const [exact, setExact] = useState(false);
  const want = useMemo(() => new Set(expectedTitles.map(fold)), [expectedTitles]);
  const shown = candidates.filter((c) => {
    if (source !== "all" && c.manga.sourceName !== source) return false;
    if (exact && !want.has(fold(c.manga.title))) return false;
    return true;
  });

  return (
    <section id="alternatives">
      <div className="row-h">
        <h2>Other matches</h2>
        <a href="#">ranked by title and chapter count</a>
      </div>
      <div className="filters" style={{ margin: "0 0 12px" }}>
        {sources.length > 1 && (
          <>
            <button
              type="button"
              className={`chip${source === "all" ? " on" : ""}`}
              onClick={() => setSource("all")}
            >
              All sources
            </button>
            {sources.map((s) => (
              <button
                type="button"
                key={s}
                className={`chip${source === s ? " on" : ""}`}
                onClick={() => setSource(s)}
              >
                {s}
              </button>
            ))}
          </>
        )}
        <button
          type="button"
          className={`chip${exact ? " on" : ""}`}
          onClick={() => setExact((v) => !v)}
        >
          Exact title
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="empty">
          <b>No matches for that filter</b>
          Clear a chip above to see the rest of the list.
        </div>
      ) : (
        <div className="rows scrollbox">
          {shown.map((c) => (
            <form className="row" action={pick} key={`${c.manga.sourceId}-${c.manga.id}`}>
              <input type="hidden" name="sourceId" value={c.manga.sourceId} />
              <input type="hidden" name="sourceTitle" value={c.manga.title} />
              <input type="hidden" name="sourceMangaId" value={c.manga.id} />
              <input type="hidden" name="backend" value={backendName} />
              <input type="hidden" name="confidence" value={c.confidence} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3>{c.manga.title}</h3>
                <span className="url">
                  {c.manga.sourceName}
                  {c.manga.chapterCount ? ` · ${c.manga.chapterCount} ${unit}s` : ""}
                </span>
              </div>
              <span className="mono">{Math.round(c.confidence * 100)}%</span>
              <button className="btn" type="submit">
                Use this
              </button>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}

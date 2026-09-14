"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LibraryItem } from "@/lib/library";

export default function PinnedShelf({ items }: { items: LibraryItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [mode, setMode] = useState(false);
  const drag = useRef<number | null>(null);
  const nudge = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [items.length]);

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...items];
    const [hit] = next.splice(from, 1);
    next.splice(to, 0, hit);
    void fetch("/api/library", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reorder: next.map((m) => ({ via: m.via, id: m.id })) }),
    }).then(() => router.refresh());
  };

  return (
    <>
      <div className="row-h yours-shelf-h">
        <h2>Pinned shelf</h2>
        {items.length > 1 && (
          <button className={`quiet${mode ? " on" : ""}`} type="button" onClick={() => setMode((v) => !v)}>
            {mode ? "Done" : "Rearrange"}
          </button>
        )}
        <div className="spacer" />
        <button className="nudge" type="button" onClick={() => nudge(-1)} aria-label="Scroll shelf left">
          ‹
        </button>
        <button className="nudge" type="button" onClick={() => nudge(1)} aria-label="Scroll shelf right">
          ›
        </button>
      </div>
      {items.length === 0 ? (
        <div className="yours-pinned-empty">Pin up to 10 titles from a title page.</div>
      ) : (
        <div className="yours-pinned" ref={ref}>
          {items.map((m, i) => (
            <a
              key={`${m.via}-${m.id}`}
              className="poster"
              href={mode ? undefined : m.href}
              draggable={mode}
              onDragStart={() => {
                drag.current = i;
              }}
              onDragOver={(e) => {
                if (!mode) return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag.current == null) return;
                move(drag.current, i);
                drag.current = null;
                setMode(false);
              }}
              onClick={(e) => {
                if (mode) e.preventDefault();
              }}
              style={{ background: m.color ?? "var(--s2)" }}
            >
              {m.cover ? <img src={m.cover} alt="" loading="lazy" decoding="async" /> : null}
              <span className="cap">{m.title}</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Poster, type RailItem } from "./ui";

export default function SearchResults({
  groups,
}: {
  groups: { title: string; items: RailItem[] }[];
}) {
  const flat = groups.flatMap((g) => g.items);
  const [sel, setSel] = useState(-1);

  useEffect(() => {
    setSel(-1);
  }, [groups]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && sel >= 0) {
        const m = flat[sel];
        if (!m) return;
        e.preventDefault();
        window.location.href = m.href ?? `/title/${m.via}/${m.kind}/${m.id}`;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, sel]);

  let n = 0;
  return (
    <>
      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <section key={g.title}>
            <div className="row-h">
              <h2>{g.title}</h2>
              <span className="mono">{g.items.length}</span>
            </div>
            <div className="grid">
              {g.items.map((m) => {
                const i = n++;
                return (
                  <Poster
                    key={`${m.via}-${m.kind}-${m.id}`}
                    media={m}
                    selected={i === sel}
                  />
                );
              })}
            </div>
          </section>
        ),
      )}
    </>
  );
}

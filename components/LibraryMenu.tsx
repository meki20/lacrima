"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LibraryItem, LibraryStatus } from "@/lib/library";
import type { MediaKind, ProviderSlug } from "@/lib/media";

const STATUSES = ["reading", "planned", "completed", "hold", "dropped"] as const;
const STATUS_LABEL: Record<LibraryStatus, string> = {
  reading: "In progress",
  planned: "Planned",
  completed: "Completed",
  hold: "On hold",
  dropped: "Dropped",
};
const PIN_LIMIT = 10;

export type LibrarySnapshot = {
  via: ProviderSlug;
  id: number;
  kind: MediaKind;
  title: string;
  cover: string | null;
  color: string | null;
  units: number | null;
  genres: string[];
};

export default function LibraryMenu({
  media,
  entry,
}: {
  media: LibrarySnapshot;
  entry: LibraryItem | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(entry);
  const save = (body: Record<string, unknown>) => {
    void fetch("/api/library", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...media, ...body }),
    })
      .then((r) => r.json() as Promise<{ entry?: LibraryItem | null }>)
      .then((j) => {
        setCurrent(j.entry ?? null);
        setOpen(false);
        router.refresh();
      });
  };

  return (
    <div className="lib-menu">
      <button className="btn" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {current ? STATUS_LABEL[current.status] : "Add to yours"}
      </button>
      {open && (
        <div className="lib-menu-pop" role="menu">
          {STATUSES.map((s: LibraryStatus) => (
            <button
              key={s}
              type="button"
              className={current?.status === s ? "on" : undefined}
              onClick={() => save({ status: s })}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
          {current && (
            <button
              type="button"
              onClick={() => save({ pin: current.pin <= 0 })}
            >
              {current.pin > 0 ? "Unpin from shelf" : `Pin to shelf (${PIN_LIMIT} max)`}
            </button>
          )}
          {current && (
            <button type="button" onClick={() => save({ remove: true })}>
              Remove from library
            </button>
          )}
        </div>
      )}
    </div>
  );
}

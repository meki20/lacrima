"use client";

import { useRouter } from "next/navigation";
import type { LibrarySort } from "@/lib/library";

const SORTS = ["added", "title", "score", "progress"] as const;

const LABEL: Record<LibrarySort, string> = {
  added: "Recently added",
  title: "Title",
  score: "Score",
  progress: "Progress",
};

export default function LibrarySort({
  value,
  query,
}: {
  value: LibrarySort;
  query: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <label className="yours-sort">
      <span className="sr-only">Sort library</span>
      <select
        className="chip"
        value={value}
        onChange={(e) => {
          const q = new URLSearchParams(query);
          const v = e.target.value;
          if (v && v !== "added") q.set("sort", v);
          else q.delete("sort");
          const s = q.toString();
          router.replace(s ? `/yours?${s}` : "/yours");
        }}
      >
        {SORTS.map((s) => (
          <option key={s} value={s}>
            {LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

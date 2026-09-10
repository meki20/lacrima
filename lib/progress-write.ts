import type { Anchor } from "./db.ts";
import type { MediaKind, ProviderSlug } from "./media.ts";

/** Serializable progress payload passed from a server page into client readers. */
export type ProgressWrite = {
  via: ProviderSlug;
  mediaId: number;
  kind: MediaKind;
  title: string;
  cover: string | null;
  unit: number;
  chapterId: string | number;
  chapterName: string;
};

/** Fire-and-forget: must never block navigation or a page turn. */
export function pushProgress(p: ProgressWrite & { anchor: Anchor }) {
  void fetch("/api/progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(p),
    keepalive: true,
  }).catch(() => {});
}

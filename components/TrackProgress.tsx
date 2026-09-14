"use client";

import { useEffect } from "react";
import { pushProgress, type ProgressWrite } from "@/lib/progress-write";

/** Novels have no page-turner; opening a chapter is the progress write. */
export default function TrackProgress({ progress }: { progress: ProgressWrite }) {
  useEffect(() => {
    pushProgress(progress);
  }, [progress.chapterId, progress.mediaId, progress.unit, progress.via, progress.kind]);
  return null;
}

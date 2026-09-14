"use client";

import { useLayoutEffect, useRef, useState } from "react";

export default function PlayerMeta({
  title,
  episodeLabel,
  provider,
  revealKey,
}: {
  title: string;
  episodeLabel: string;
  provider: string | null;
  /** Changes trigger a fresh overflow measurement. */
  revealKey: string | null;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const text = [provider, title, episodeLabel].filter(Boolean).join(" · ");

  useLayoutEffect(() => {
    const update = () => setOverflow((line.current?.scrollWidth ?? 0) > (rail.current?.clientWidth ?? 0) + 1);
    update();
    const resize = new ResizeObserver(update);
    if (rail.current) resize.observe(rail.current);
    return () => resize.disconnect();
  }, [text, revealKey]);

  return (
    <div className={`player-meta${overflow ? " overflow" : ""}`}>
      <div ref={rail} className="player-meta-rail" data-overflow={overflow || undefined} aria-live="polite">
        <span ref={line} className="player-meta-line">
          <span className="player-meta-provider">{provider ? `${provider} · ` : ""}</span>
          <span className="player-meta-title">{title}</span>
          <span className="player-meta-ep"> · {episodeLabel}</span>
        </span>
        {overflow && (
          <span className="player-meta-line" aria-hidden>
            <span className="player-meta-provider">{provider ? `${provider} · ` : ""}</span>
            <span className="player-meta-title">{title}</span>
            <span className="player-meta-ep"> · {episodeLabel}</span>
          </span>
        )}
      </div>
    </div>
  );
}

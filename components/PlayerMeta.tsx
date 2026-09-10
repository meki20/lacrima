"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Phase = "idle" | "animating" | "shown";

export default function PlayerMeta({
  title,
  episodeLabel,
  provider,
  revealKey,
}: {
  title: string;
  episodeLabel: string;
  provider: string | null;
  /** Changes trigger the reveal animation. */
  revealKey: string | null;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const titleEl = useRef<HTMLSpanElement>(null);
  const leadEl = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [key, setKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!revealKey || !provider) return;
    if (revealKey === key && phase !== "idle") return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setKey(revealKey);
    if (reduced) {
      setPhase("shown");
      return;
    }

    const root = rail.current;
    const tw = titleEl.current?.offsetWidth ?? 0;
    root?.style.setProperty("--title-w", `${tw}px`);

    setPhase("animating");
    const done = window.setTimeout(() => setPhase("shown"), 720);
    return () => window.clearTimeout(done);
  }, [revealKey, provider, key, phase, title, episodeLabel]);

  const showLead = provider && phase !== "idle";

  return (
    <div className="player-meta">
      <div ref={rail} className="player-meta-rail" data-phase={phase} aria-live="polite">
        <span
          ref={leadEl}
          className="player-meta-lead"
          data-visible={showLead ? "true" : "false"}
          aria-hidden={!showLead}
        >
          <span className="player-meta-provider">{provider ?? ""}</span>
          <span className="player-meta-dot" aria-hidden>
            ·
          </span>
        </span>
        <span ref={titleEl} className="player-meta-title">
          {title}
        </span>
        <span className="player-meta-dot" aria-hidden>
          ·
        </span>
        <span className="player-meta-ep">{episodeLabel}</span>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The cover, fading in over its placeholder once it has actually decoded.
 *
 * The box is sized by the card (aspect-ratio), so nothing shifts when it lands.
 * Visibility is CSS-driven by data-state: "wait" is transparent, "on" fades in,
 * "failed" is hidden so the card falls back to its typographic tile. Without JS
 * the images stay visible (see `@media (scripting: none)` in globals.css).
 */
export default function PosterImg({
  src,
  eager,
  high,
}: {
  src: string;
  /** In the first viewport: fetch now rather than when scrolled near. */
  eager?: boolean;
  /** One of the first couple of tiles: the likely LCP, ahead of everything else. */
  high?: boolean;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"wait" | "on" | "failed">("wait");

  // A server-rendered image can finish (or fail) before hydration attaches
  // onLoad/onError, and those events are not replayed. Read the outcome off the element.
  useEffect(() => {
    const el = ref.current;
    if (el?.complete) setState(el.naturalWidth > 0 ? "on" : "failed");
  }, []);

  return (
    <img
      ref={ref}
      className="pimg"
      data-state={state}
      src={src}
      alt=""
      loading={eager ? "eager" : "lazy"}
      fetchPriority={high ? "high" : undefined}
      decoding="async"
      onLoad={() => setState("on")}
      onError={() => setState("failed")}
    />
  );
}

"use client";

import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import type { ContinueItem } from "@/lib/progress";

const COAST_DECAY = 0.92;
const COAST_MIN = 0.04;
const COAST_MAX = 3.5;

export default function ContinueRail({ items }: { items: ContinueItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const nudge = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    const startX = e.clientX;
    let lastX = startX;
    let lastT = performance.now();
    let velocity = 0;
    let dragged = false;
    const move = (event: MouseEvent) => {
      if (!dragged && Math.abs(event.clientX - startX) < 5) return;
      dragged = true;
      el.classList.add("panning");
      const now = performance.now();
      const elapsed = now - lastT;
      if (elapsed > 0) velocity = (event.clientX - lastX) / elapsed;
      el.scrollLeft -= event.clientX - lastX;
      lastX = event.clientX;
      lastT = now;
    };
    const up = () => {
      el.classList.remove("panning");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (!dragged) return;
      const blockClick = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        el.removeEventListener("click", blockClick, true);
      };
      el.addEventListener("click", blockClick, true);
      if (performance.now() - lastT > 50) return;
      let v = Math.max(-COAST_MAX, Math.min(COAST_MAX, velocity));
      if (Math.abs(v) < COAST_MIN) return;
      let last = performance.now();
      const coast = (now: number) => {
        const elapsed = Math.min(32, now - last);
        last = now;
        v *= COAST_DECAY ** (elapsed / 16);
        el.scrollLeft -= v * elapsed;
        if (Math.abs(v) >= COAST_MIN) frame.current = requestAnimationFrame(coast);
      };
      frame.current = requestAnimationFrame(coast);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  if (items.length === 0) return null;

  return (
    <section>
      <div className="row-h">
        <h2>Continue</h2>
      </div>
      <div className="cont-wrap">
        <button className="arrow left" type="button" onClick={() => nudge(-1)} aria-label="Scroll Continue left">
          ‹
        </button>
        <div
          className="cont"
          ref={ref}
          onMouseDown={onMouseDown}
          onDragStart={(e) => e.preventDefault()}
        >
          {items.map((m) => (
            <a className="cont-card" key={`${m.kind}-${m.id}`} href={`/title/${m.via}/${m.kind}/${m.id}`}>
              <div className="cont-art" style={{ background: m.color ?? "var(--s2)" }}>
                {m.cover ? <img src={m.cover} alt="" loading="lazy" decoding="async" /> : null}
              </div>
              <div className="cont-b">
                <div className="cont-top">
                  <h3>{m.title}</h3>
                  <span className="mono">{m.pip}</span>
                </div>
                {m.detail ? <div className="cont-detail">{m.detail}</div> : <div className="cont-detail">&nbsp;</div>}
                <div className="progress" aria-hidden="true">
                  <i style={{ width: `${Math.round((m.ratio ?? 0) * 100)}%` }} />
                </div>
              </div>
            </a>
          ))}
        </div>
        <button className="arrow right" type="button" onClick={() => nudge(1)} aria-label="Scroll Continue right">
          ›
        </button>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { Poster, type RailItem } from "./ui";

const COPIES = 3;
const TICK_MS = 5000;
const STAGGER_MS = 1000;
const SLIDE_MS = 800;
const COAST_DECAY = 0.92; // per 16ms
const COAST_MIN = 0.04; // px/ms
const COAST_MAX = 3.5; // px/ms

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Keep scroll in the middle copy so the rail can pan forever in either direction. */
function wrapRail(el: HTMLDivElement) {
  const w = el.scrollWidth / COPIES;
  if (w < 1) return;
  if (el.scrollLeft < w / 2) el.scrollLeft += w;
  else if (el.scrollLeft >= w * 1.5) el.scrollLeft -= w;
}

function cardStep(el: HTMLDivElement) {
  const a = el.children[0] as HTMLElement | undefined;
  const b = el.children[1] as HTMLElement | undefined;
  if (!a) return 0;
  return b ? b.offsetLeft - a.offsetLeft : a.offsetWidth;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export default function Rail({
  title,
  href,
  action,
  items,
}: {
  title: string;
  href?: string;
  action?: string;
  items: RailItem[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const held = useRef(false);
  const sliding = useRef(false);
  const frame = useRef(0);

  const stopSlide = () => {
    cancelAnimationFrame(frame.current);
    sliding.current = false;
  };

  const coast = (el: HTMLDivElement, pointerVx: number) => {
    let v = clamp(pointerVx, -COAST_MAX, COAST_MAX);
    if (Math.abs(v) < COAST_MIN) return;
    sliding.current = true;
    let last = performance.now();
    const tick = (now: number) => {
      if (held.current) {
        sliding.current = false;
        return;
      }
      const dt = Math.min(32, now - last);
      last = now;
      v *= COAST_DECAY ** (dt / 16);
      el.scrollLeft -= v * dt;
      wrapRail(el);
      if (Math.abs(v) < COAST_MIN) {
        sliding.current = false;
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth / COPIES;
    const ro = new ResizeObserver(() => {
      if (!sliding.current) wrapRail(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const slide = () => {
      if (held.current || sliding.current) return;
      const from = el.scrollLeft;
      const delta = cardStep(el);
      if (!delta) return;
      sliding.current = true;
      const t0 = performance.now();
      const tick = (now: number) => {
        if (held.current) {
          sliding.current = false;
          return;
        }
        const t = Math.min(1, (now - t0) / SLIDE_MS);
        el.scrollLeft = from + delta * easeInOut(t);
        if (t < 1) {
          frame.current = requestAnimationFrame(tick);
          return;
        }
        sliding.current = false;
        wrapRail(el);
      };
      frame.current = requestAnimationFrame(tick);
    };

    const i = Math.max(0, [...document.querySelectorAll(".rail")].indexOf(el));
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      slide();
      interval = setInterval(slide, TICK_MS);
    }, TICK_MS + i * STAGGER_MS);

    return () => {
      clearTimeout(start);
      clearInterval(interval);
      stopSlide();
    };
  }, []);

  const nudge = (dir: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  /**
   * Left-drag to pan. Clicks still open a title; a drag swallows the click
   * that would otherwise follow mouseup.
   */
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;

    stopSlide();
    held.current = true;
    const originX = e.clientX;
    let lastX = e.clientX;
    let lastT = performance.now();
    let vx = 0;
    let dragged = false;

    const move = (ev: MouseEvent) => {
      if (!dragged) {
        if (Math.abs(ev.clientX - originX) < 5) return;
        dragged = true;
        el.classList.add("panning");
      }
      const now = performance.now();
      const dt = now - lastT;
      if (dt > 0) vx = (ev.clientX - lastX) / dt;
      el.scrollLeft -= ev.clientX - lastX;
      lastX = ev.clientX;
      lastT = now;
      wrapRail(el);
    };
    const up = () => {
      held.current = false;
      el.classList.remove("panning");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (!dragged) return;
      const block = (ce: Event) => {
        ce.preventDefault();
        ce.stopPropagation();
        el.removeEventListener("click", block, true);
      };
      el.addEventListener("click", block, true);
      if (performance.now() - lastT > 50) return;
      coast(el, vx);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  if (items.length === 0) return null;

  return (
    <section>
      <div className="row-h">
        <h2>{title}</h2>
        {action && <a href={href ?? "#"}>{action}</a>}
      </div>

      <div className="rail-wrap">
        <button className="arrow left" onClick={() => nudge(-1)} aria-label={`Scroll ${title} left`}>
          ‹
        </button>

        <div
          className="rail"
          ref={ref}
          onScroll={() => {
            if (held.current || sliding.current) return;
            const el = ref.current;
            if (el) wrapRail(el);
          }}
          onMouseDown={onMouseDown}
          onDragStart={(e) => e.preventDefault()}
        >
          {[0, 1, 2].flatMap((copy) =>
            items.map((m) => <Poster key={`${copy}-${m.kind}-${m.id}`} media={m} />),
          )}
        </div>

        <button className="arrow right" onClick={() => nudge(1)} aria-label={`Scroll ${title} right`}>
          ›
        </button>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Poster, type RailItem } from "./ui";

const COAST_DECAY = 0.92; // per 16ms
const COAST_MIN = 0.04; // px/ms
const COAST_MAX = 3.5; // px/ms

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A bounded browse strip: one copy of the items, native scrolling, drag-coast
 * on desktop. Nothing moves unless the user moves it.
 */
export default function Rail({
  title,
  href,
  action,
  items,
  priority,
}: {
  title: string;
  href?: string;
  action?: string;
  items: RailItem[];
  /** The first rail on a page: its leading posters load eagerly. */
  priority?: boolean;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const frame = useRef(0);
  // Which ends still have content past them. Drives the arrows and the edge fade.
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      setCanPrev(el.scrollLeft > 1);
      setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener("scroll", queue, { passive: true });
    const ro = new ResizeObserver(queue);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", queue);
      ro.disconnect();
      cancelAnimationFrame(raf);
      cancelAnimationFrame(frame.current);
    };
  }, [items]);

  const coast = (el: HTMLElement, pointerVx: number) => {
    let v = clamp(pointerVx, -COAST_MAX, COAST_MAX);
    if (Math.abs(v) < COAST_MIN) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - last);
      last = now;
      v *= COAST_DECAY ** (dt / 16);
      el.scrollLeft -= v * dt;
      if (Math.abs(v) >= COAST_MIN) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  /** About one viewport of whole cards, so the next page starts on a poster edge. */
  const nudge = (dir: number) => {
    const el = ref.current;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !first) return;
    const next = el.children[1] as HTMLElement | undefined;
    const step = next ? next.offsetLeft - first.offsetLeft : first.offsetWidth;
    const page = Math.max(step, Math.floor(el.clientWidth / step) * step);
    el.scrollBy({ left: dir * page, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  /** Arrow keys walk poster to poster; Tab still gets one stop per poster. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return; // Alt+Left is "back"
    const item = (e.target as HTMLElement).closest("li");
    const to = (e.key === "ArrowRight" ? item?.nextElementSibling : item?.previousElementSibling)?.querySelector("a");
    if (!to) return;
    e.preventDefault();
    to.focus({ preventScroll: true });
    to.scrollIntoView({ inline: "nearest", block: "nearest" });
  };

  /**
   * Left-drag to pan. Clicks still open a title; a drag swallows the click
   * that would otherwise follow mouseup.
   */
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;

    cancelAnimationFrame(frame.current);
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
    };
    const up = () => {
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
        {action && (href ? <Link href={href}>{action}</Link> : <a href="#">{action}</a>)}
      </div>

      <div className="rail-wrap">
        <button
          type="button"
          className="arrow left"
          onClick={() => nudge(-1)}
          disabled={!canPrev}
          aria-label={`Scroll ${title} left`}
        >
          ‹
        </button>

        <ul
          className="rail"
          role="list"
          aria-label={title}
          data-fade={canPrev && canNext ? "both" : canPrev ? "start" : canNext ? "end" : undefined}
          ref={ref}
          onKeyDown={onKeyDown}
          onMouseDown={onMouseDown}
          onDragStart={(e) => e.preventDefault()}
        >
          {items.map((m, i) => (
            <li key={`${m.via}-${m.kind}-${m.id}`}>
              <Poster media={m} index={priority ? i : undefined} />
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="arrow right"
          onClick={() => nudge(1)}
          disabled={!canNext}
          aria-label={`Scroll ${title} right`}
        >
          ›
        </button>
      </div>
    </section>
  );
}

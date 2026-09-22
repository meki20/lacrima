"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { type DockEpisode } from "@/lib/nav";
import { isChapterRead, pushProgress, type ProgressWrite } from "@/lib/progress-write";
import {
  groupIndexForPage,
  pageStepGroups,
  probeImageHeights,
  stitchPageGroups,
} from "@/lib/reader-pages";
import MarkMenu from "./MarkMenu";
import { DEFAULT_READER, parseReaderPrefs, tapZone, wheelZoom, type ReaderPrefs } from "@/lib/reader-prefs";
import { useRouter } from "next/navigation";

type Prefs = ReaderPrefs;

const GLOBAL = "lacrima.reader";
const PRELOAD = 2;

function atEnd(href: string | null): string | null {
  if (!href) return null;
  return `${href}${href.includes("?") ? "&" : "?"}end=1`;
}

export type ReaderProps = {
  pages: string[];
  initialPage: number;
  title: string;
  chapterLabel: string;
  backHref: string;
  prevHref: string | null;
  nextHref: string | null;
  progress: ProgressWrite;
  trackProgress?: boolean;
  /** via:id — prefs stick to the series, not the chapter. */
  settingsKey: string;
  defaults?: Prefs;
  chapters?: DockEpisode[];
  currentId?: string;
};

export default function Reader({
  pages,
  initialPage,
  title,
  chapterLabel,
  backHref,
  prevHref,
  nextHref,
  progress,
  trackProgress = true,
  settingsKey,
  defaults = DEFAULT_READER,
  chapters = [],
  currentId,
}: ReaderProps) {
  const router = useRouter();
  const store = `${GLOBAL}.${settingsKey}`;
  const [page, setPage] = useState(() => clamp(initialPage, pages.length));
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [ready, setReady] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState(false);
  const [zoom, setZoom] = useState(1);
  const reader = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const chaptersEl = useRef<HTMLDivElement>(null);
  const tap0 = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressObserver = useRef(false);
  const { mode, rtl, fit, spread } = prefs;
  const paged = mode === "paged";
  const double = paged && spread === "double";
  const stride = double ? 2 : 1;
  const [heights, setHeights] = useState<number[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHeights(null);
    void probeImageHeights(pages).then((next) => {
      if (!cancelled) setHeights(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pages]);
  const stacksReady = heights != null || !paged;
  const stacks = useMemo(() => {
    if (heights && heights.length === pages.length && heights.some((h) => h > 0)) {
      return stitchPageGroups(heights);
    }
    return pages.map((_, i) => [i]);
  }, [heights, pages]);
  const stackAt = groupIndexForPage(stacks, page);
  const shownStacks = (
    double ? [stacks[stackAt], stacks[stackAt + 1]] : [stacks[stackAt]]
  ).filter((s): s is number[] => Array.isArray(s) && s.length > 0);
  const pageCount = paged ? stacks.length : pages.length;
  const pageLabel = paged ? stackAt : page;
  const currentChapter = chapters.findIndex((c) => c.id === currentId);
  const [readUnit, setReadUnit] = useState(progress.unit);
  useEffect(() => {
    setPage(clamp(initialPage, pages.length));
    setZoom(1);
  }, [currentId, initialPage, pages.length]);

  useEffect(() => {
    const root = reader.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !(e.target instanceof Element) || !e.target.closest(".reader-stage, .reader-webtoon")) return;
      e.preventDefault();
      setZoom((current) => wheelZoom(current, e.deltaY));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    setReadUnit(progress.unit);
  }, [progress.unit, progress.chapterId]);

  useEffect(() => {
    setPrefs(readPrefs(store, defaults));
    setReady(true);
  }, [store]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(store, JSON.stringify(prefs));
  }, [prefs, ready, store]);

  useEffect(() => {
    if (!double) return;
    setPage((p) => {
      const gi = groupIndexForPage(stacks, p);
      const snapped = gi - (gi % 2);
      return stacks[snapped]?.[0] ?? p;
    });
  }, [double, stacks]);

  useEffect(() => {
    if (!trackProgress) return;
    const t = setTimeout(() => {
      pushProgress({
        ...progress,
        anchor: {
          kind: "page",
          index: page,
          chapterId: progress.chapterId,
          chapterName: progress.chapterName,
          ...(progress.pages && progress.pages > 0 ? { pages: progress.pages } : {}),
        },
      });
    }, 700);
    return () => clearTimeout(t);
  }, [page, progress, trackProgress]);

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    if (!trackProgress) return;
    let last = Date.now();
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") {
        last = Date.now();
        return;
      }
      const now = Date.now();
      const delta = Math.min(8, Math.round((now - last) / 1000));
      last = now;
      if (delta < 1) return;
      const p = progressRef.current;
      pushProgress({
        ...p,
        watchedDelta: delta,
        anchor: {
          kind: "page",
          index: pageRef.current,
          chapterId: p.chapterId,
          chapterName: p.chapterName,
          ...(p.pages && p.pages > 0 ? { pages: p.pages } : {}),
        },
      });
    }, 5_000);
    return () => clearInterval(id);
  }, [trackProgress]);

  const goPage = useCallback(
    (next: number) => {
      if (paged) {
        if (next < 0) {
          const href = atEnd(prevHref);
          if (href) router.push(href);
          return;
        }
        if (next >= stacks.length) {
          if (nextHref) router.push(nextHref);
          return;
        }
        const at = double ? next - (next % 2) : next;
        setPage(stacks[at]?.[0] ?? 0);
        return;
      }
      if (next < 0) {
        const href = atEnd(prevHref);
        if (href) router.push(href);
        return;
      }
      if (next >= pages.length) {
        if (nextHref) router.push(nextHref);
        return;
      }
      setPage(next);
      if (mode === "webtoon") {
        suppressObserver.current = true;
        strip.current?.children[next]?.scrollIntoView({ block: "start" });
        setTimeout(() => (suppressObserver.current = false), 120);
      }
    },
    [double, mode, nextHref, pages.length, paged, prevHref, router, stacks],
  );

  const step = useCallback(
    (d: number) => {
      if (paged) {
        const gi = groupIndexForPage(stacks, page);
        const nextGi = gi + d * stride;
        if (nextGi < 0) {
          const href = atEnd(prevHref);
          if (href) router.push(href);
          return;
        }
        if (nextGi >= stacks.length) {
          if (nextHref) router.push(nextHref);
          return;
        }
        setPage(pageStepGroups(page, d, stacks, spread));
        return;
      }
      goPage(page + d * stride);
    },
    [goPage, nextHref, page, paged, prevHref, router, stacks, stride, spread],
  );

  useEffect(() => {
    if (mode !== "webtoon" || !strip.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (suppressObserver.current) return;
        const seen = entries.filter((e) => e.isIntersecting);
        if (seen.length === 0) return;
        const top = seen.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setPage(Number((top.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const el of strip.current.children) io.observe(el);
    return () => io.disconnect();
  }, [mode, pages.length]);

  useEffect(() => {
    if (mode !== "webtoon") return;
    suppressObserver.current = true;
    strip.current?.children[page]?.scrollIntoView({ block: "start" });
    const t = setTimeout(() => (suppressObserver.current = false), 200);
    return () => clearTimeout(t);
    // Mode switch and first paint with pages — following `page` would fight the observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pages.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? "";
      const typing =
        tag === "TEXTAREA" ||
        (tag === "INPUT" && (el as HTMLInputElement).type !== "range");
      if (typing) return;

      if (e.key === "Escape" && menu) {
        e.preventDefault();
        e.stopPropagation();
        setMenu(false);
        return;
      }
      const fwd = rtl ? -1 : 1;
      switch (e.key) {
        case "ArrowRight": step(fwd); break;
        case "ArrowLeft": step(-fwd); break;
        case "ArrowDown": if (paged) step(1); else return; break;
        case "ArrowUp": if (paged) step(-1); else return; break;
        case " ": step(e.shiftKey ? -1 : 1); break;
        case "Home": goPage(0); break;
        case "End": goPage(pages.length - 1); break;
        case "f": void toggleFullscreen(); break;
        case "w": setPrefs((p) => ({ ...p, mode: p.mode === "paged" ? "webtoon" : "paged" })); break;
        case "r": setPrefs((p) => ({ ...p, rtl: !p.rtl })); break;
        case "m": setMenu((v) => !v); setChrome(true); break;
        case "h": setChrome((v) => !v); setMenu(false); break;
        case "Escape": if (!document.fullscreenElement) router.push(backHref); return;
        default: return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (el instanceof HTMLElement && el.closest(".reader-slit")) el.blur();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [backHref, goPage, menu, paged, pages.length, router, rtl, step]);

  useEffect(() => {
    if (!menu) return;
    const box = chaptersEl.current;
    const read = box?.querySelectorAll<HTMLElement>(".reader-chapter.read");
    const target = read?.[read.length - 1];
    if (!box || !target) return;
    const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = top - target.offsetHeight;
  }, [menu, currentId, readUnit]);

  const openMenu = useCallback(() => {
    setMenu(true);
    setChrome(true);
  }, []);

  const onTapDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    tap0.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  const onTapUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = tap0.current;
    tap0.current = null;
    if (!start || start.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 24) return;
    if ((e.target as HTMLElement).closest("a, button, input, .pbtn")) return;
    const r = e.currentTarget.getBoundingClientRect();
    const z = tapZone(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (z === "top") openMenu();
    else if (z === "left") step(rtl ? 1 : -1);
    else if (z === "right") step(rtl ? -1 : 1);
    else {
      setChrome((v) => !v);
      setMenu(false);
    }
  };

  const t = pageCount > 1 ? pageLabel / (pageCount - 1) : 1;
  const visible = chrome || menu;

  return (
    <div
      ref={reader}
      className={`reader${visible ? "" : " bare"}`}
      data-mode={mode}
      data-rtl={rtl ? "" : undefined}
      style={{ ["--zoom" as string]: zoom }}
    >
      <header className="reader-bar">
        <a className="pbtn" href={backHref} aria-label="Back to the title" title="Back (Esc)">
          <Icon d={PATH.back} filled={false} />
        </a>
        <div className="reader-id">
          <b>{title}</b>
          <span>
            {chapterLabel}
            <span className="mono" style={{ marginLeft: 8 }}>
              {pageLabel + 1} / {pageCount}
            </span>
          </span>
        </div>
        <div className="spacer" />
        <button
          type="button"
          className={`pbtn${menu ? " on" : ""}`}
          aria-label="Reading options"
          aria-expanded={menu}
          title="Options (m)"
          onClick={() => {
            setMenu((v) => !v);
            setChrome(true);
          }}
        >
          <Icon d={PATH.menu} filled={false} />
        </button>
        <button
          type="button"
          className="pbtn"
          aria-label="Fullscreen"
          title="Fullscreen (f)"
          onClick={() => void toggleFullscreen()}
        >
          <Icon d={PATH.full} filled={false} />
        </button>
      </header>

      {paged ? (
        <div
          className="reader-stage"
          data-fit={fit}
          data-spread={double ? "double" : "single"}
          data-rtl={rtl ? "" : undefined}
          data-zoomed={zoom > 1 ? "" : undefined}
          onPointerDown={onTapDown}
          onPointerUp={onTapUp}
          onPointerCancel={() => {
            tap0.current = null;
          }}
        >
          {!stacksReady ? (
            <div className="reader-loading" aria-busy="true">
              Loading pages…
            </div>
          ) : (
            <>
              {shownStacks.map((stack) => (
                <div
                  key={stack[0]}
                  className="reader-stack"
                  data-stitched={stack.length > 1 ? "" : undefined}
                >
                  {stack.map((i) => (
                    <img
                      key={`${i}:${pages[i]}`}
                      className="reader-img"
                      src={pages[i]}
                      alt={`Page ${i + 1}`}
                      draggable={false}
                    />
                  ))}
                </div>
              ))}
              {pages.slice(page + shownStacks.flat().length, page + shownStacks.flat().length + PRELOAD).map((src) => (
                <img key={src} src={src} alt="" style={{ display: "none" }} />
              ))}
            </>
          )}
        </div>
      ) : (
        <div
          className="reader-webtoon"
          onPointerDown={onTapDown}
          onPointerUp={onTapUp}
          onPointerCancel={() => {
            tap0.current = null;
          }}
        >
          <div className="reader-strip" ref={strip} data-zoomed={zoom > 1 ? "" : undefined}>
            {pages.map((src, i) => (
              <img
                key={src}
                data-i={i}
                className="reader-img"
                src={src}
                alt={`Page ${i + 1}`}
                loading={i <= PRELOAD ? "eager" : "lazy"}
                decoding="async"
                draggable={false}
              />
            ))}
          </div>
        </div>
      )}

      <Hop href={rtl ? nextHref : atEnd(prevHref)} side="prev" chapter={rtl ? "next" : "prev"} />
      <Hop href={rtl ? atEnd(prevHref) : nextHref} side="next" chapter={rtl ? "prev" : "next"} />

      {menu && (
        <button type="button" className="reader-catch" aria-label="Close options" onClick={() => setMenu(false)} />
      )}
      <aside className={`reader-drawer${menu ? " open" : ""}`} aria-label="Reading options" inert={!menu || undefined}>
        <div className="reader-group">
          <b>Direction</b>
          <div className="reader-group-opts">
            <Opt on={rtl === false} label="LTR" onClick={() => setPrefs((p) => ({ ...p, rtl: false }))}>
              <Icon d={PATH.ltr} filled={false} />
            </Opt>
            <Opt on={rtl} label="RTL" onClick={() => setPrefs((p) => ({ ...p, rtl: true }))}>
              <Icon d={PATH.rtl} filled={false} />
            </Opt>
          </div>
        </div>
        <div className="reader-group">
          <b>Mode</b>
          <div className="reader-group-opts">
            <Opt on={mode === "paged"} label="Paged" onClick={() => setPrefs((p) => ({ ...p, mode: "paged" }))}>
              <Icon d={PATH.paged} filled={false} />
            </Opt>
            <Opt on={mode === "webtoon"} label="Webtoon" onClick={() => setPrefs((p) => ({ ...p, mode: "webtoon" }))}>
              <Icon d={PATH.webtoon} filled={false} />
            </Opt>
          </div>
        </div>
        <div className="reader-group">
          <b>Fit</b>
          <div className="reader-group-opts">
            <Opt on={fit === "height"} label="Height" onClick={() => setPrefs((p) => ({ ...p, fit: "height" }))}>
              <Icon d={PATH.fitH} filled={false} />
            </Opt>
            <Opt on={fit === "width"} label="Width" onClick={() => setPrefs((p) => ({ ...p, fit: "width" }))}>
              <Icon d={PATH.fitW} filled={false} />
            </Opt>
            <Opt on={fit === "contain"} label="Screen" onClick={() => setPrefs((p) => ({ ...p, fit: "contain" }))}>
              <Icon d={PATH.fitBox} filled={false} />
            </Opt>
          </div>
        </div>
        <div className="reader-group">
          <b>Pages</b>
          <div className="reader-group-opts">
            <Opt on={spread === "single"} label="Single" onClick={() => setPrefs((p) => ({ ...p, spread: "single" }))}>
              <Icon d={PATH.single} filled={false} />
            </Opt>
            <Opt on={spread === "double"} label="Double" onClick={() => setPrefs((p) => ({ ...p, spread: "double" }))}>
              <Icon d={PATH.double} filled={false} />
            </Opt>
          </div>
        </div>
        {chapters.length > 0 && (
          <div className="reader-group reader-chapters-box">
            <b>Chapters</b>
            <div className="reader-chapters" ref={chaptersEl}>
              {chapters.map((c, i) => {
                const read = isChapterRead(i, currentChapter, readUnit);
                const write = (extra: { skipAhead?: boolean; exact?: boolean }, unit = i + 1) => {
                  const target = extra.exact ? null : unit > 0 ? chapters[unit - 1] ?? c : c;
                  return pushProgress({
                    ...progress,
                    unit,
                    chapterId: target?.id ?? "-",
                    chapterName: target?.name ?? "",
                    ...extra,
                  }).then(() => {
                    setReadUnit((u) => (extra.exact ? unit : Math.max(u, unit)));
                  });
                };
                return (
                  <div
                    key={c.id}
                    className={`reader-chapter${c.id === currentId ? " on" : ""}${read ? " read" : ""}`}
                  >
                    <a
                      href={c.href}
                      onClick={(e) => {
                        e.preventDefault();
                        if (c.id === currentId || read) {
                          router.push(c.href);
                          return;
                        }
                        void write({ skipAhead: true }).then(() => router.push(c.href));
                      }}
                    >
                      <span className="mono">{c.number}</span>
                      <span className="name">{c.name}</span>
                    </a>
                    <MarkMenu
                      kind={progress.kind}
                      read={i + 1 <= readUnit}
                      onMark={() => void write({ skipAhead: true })}
                      onUpTo={() => void write({ exact: true })}
                      onUnmark={() => void write({ exact: true }, i)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      <div className={`reader-slit${drag ? " drag" : ""}`} data-rtl={rtl ? "" : undefined} style={{ ["--t" as string]: t }}>
        <div className="reader-slit-fill" />
        <input
          type="range"
          min={0}
          max={Math.max(0, pageCount - 1)}
          step={stride}
          value={pageLabel}
          dir={rtl ? "rtl" : "ltr"}
          aria-label="Page"
          onPointerDown={() => setDrag(true)}
          onPointerUp={() => setDrag(false)}
          onChange={(e) => goPage(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function Hop({
  href,
  side,
  chapter,
}: {
  href: string | null;
  side: "prev" | "next";
  chapter: "prev" | "next";
}) {
  return (
    <a
      className={`pbtn reader-hop ${side}`}
      href={href ?? undefined}
      aria-disabled={!href}
      aria-label={chapter === "prev" ? "Previous chapter" : "Next chapter"}
      title={chapter === "prev" ? "Previous chapter" : "Next chapter"}
    >
      <Icon d={side === "prev" ? PATH.prevCh : PATH.nextCh} />
    </a>
  );
}

function Opt({
  on,
  label,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`reader-opt${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function Icon({ d, filled = true }: { d: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={filled ? undefined : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const PATH = {
  back: "M14 6l-6 6 6 6",
  menu: "M5 7h14M5 12h14M5 17h10",
  full: "M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5",
  prevCh: "M18 5.5v13l-9-6.5zM7.5 5.5H5v13h2.5z",
  nextCh: "M6 5.5v13l9-6.5zM16.5 5.5H19v13h-2.5z",
  ltr: "M4 7h9v10H4zM16 12h4m0 0-2-2m2 2-2 2",
  rtl: "M11 7h9v10h-9zM8 12H4m0 0 2-2m-2 2 2 2",
  paged: "M7 4h10v16H7z",
  webtoon: "M8 3h8v5H8zM8 9.5h8v5H8zM8 16h8v5H8z",
  fitH: "M8 7h8v10H8zM12 3v3M12 18v3M10 5l2-2 2 2M10 19l2 2 2-2",
  fitW: "M7 8h10v8H7zM3 12h3M18 12h3M5 10l-2 2 2 2M19 10l2 2-2 2",
  fitBox: "M7 7h10v10H7zM4 4h3M4 4v3M20 4h-3M20 4v3M4 20h3M4 20v-3M20 20h-3M20 20v-3",
  single: "M8 4h8v16H8z",
  double: "M3 5h8v14H3zM13 5h8v14h-8",
};

function readPrefs(store: string, fallback: Prefs): Prefs {
  return parseReaderPrefs(localStorage.getItem(store) ?? localStorage.getItem(GLOBAL) ?? JSON.stringify(fallback));
}

const clamp = (i: number, len: number) => Math.min(Math.max(i, 0), Math.max(0, len - 1));

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* denied or unsupported — the reader works either way */
  }
}

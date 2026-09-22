"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { type DockEpisode } from "@/lib/nav";
import { htmlParagraphs, paragraphCfi, paragraphIndex } from "@/lib/novel-html";
import { isChapterRead, pushProgress, type ProgressWrite } from "@/lib/progress-write";
import {
  DEFAULT_NOVEL_READER,
  clampNovelFontSize,
  parseNovelReaderPrefs,
  tapZone,
  type NovelReaderPrefs,
} from "@/lib/reader-prefs";
import { useRouter } from "next/navigation";
import MarkMenu from "./MarkMenu";

const GLOBAL = "lacrima.novel";

export type NovelReaderProps = {
  html: string;
  initialParagraph?: number;
  title: string;
  chapterLabel: string;
  backHref: string;
  prevHref: string | null;
  nextHref: string | null;
  progress: ProgressWrite;
  trackProgress?: boolean;
  settingsKey: string;
  defaults?: NovelReaderPrefs;
  chapters?: DockEpisode[];
  currentId?: string;
};

export default function NovelReader({
  html,
  initialParagraph = 0,
  title,
  chapterLabel,
  backHref,
  prevHref,
  nextHref,
  progress,
  trackProgress = true,
  settingsKey,
  defaults = DEFAULT_NOVEL_READER,
  chapters = [],
  currentId,
}: NovelReaderProps) {
  const router = useRouter();
  const store = `${GLOBAL}.${settingsKey}`;
  const paragraphs = htmlParagraphs(html);
  const count = Math.max(1, paragraphs.length);
  const [page, setPage] = useState(() => clamp(initialParagraph, count));
  const [prefs, setPrefs] = useState<NovelReaderPrefs>(defaults);
  const [ready, setReady] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState(false);
  const reader = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const chaptersEl = useRef<HTMLDivElement>(null);
  const tap0 = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressObserver = useRef(false);
  const { mode, rtl, fontSize } = prefs;
  const paged = mode === "paged";
  const currentChapter = chapters.findIndex((c) => c.id === currentId);
  const [readUnit, setReadUnit] = useState(progress.unit);

  useEffect(() => {
    setPage(clamp(initialParagraph, count));
  }, [currentId, initialParagraph, count]);

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
    if (!trackProgress) return;
    const t = setTimeout(() => {
      pushProgress({
        ...progress,
        anchor: {
          kind: "paragraph",
          cfi: paragraphCfi(page),
          chapterId: progress.chapterId,
          chapterName: progress.chapterName,
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
          kind: "paragraph",
          cfi: paragraphCfi(pageRef.current),
          chapterId: p.chapterId,
          chapterName: p.chapterName,
        },
      });
    }, 5_000);
    return () => clearInterval(id);
  }, [trackProgress]);

  const goPage = useCallback(
    (next: number) => {
      if (next < 0) {
        if (prevHref) router.push(prevHref);
        return;
      }
      if (next >= count) {
        if (nextHref) router.push(nextHref);
        return;
      }
      setPage(next);
      if (!paged && strip.current) {
        suppressObserver.current = true;
        const el = strip.current.querySelector(`[data-i="${next}"]`);
        el?.scrollIntoView({ block: "start" });
        requestAnimationFrame(() => {
          suppressObserver.current = false;
        });
      }
    },
    [count, nextHref, paged, prevHref, router],
  );

  const step = useCallback((dir: number) => goPage(page + dir), [goPage, page]);

  useEffect(() => {
    if (paged || !strip.current) return;
    const root = strip.current;
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-i]")];
    if (!nodes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (suppressObserver.current) return;
        let best: { i: number; r: number } | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.i);
          if (!Number.isFinite(i)) continue;
          const r = e.intersectionRatio;
          if (!best || r > best.r) best = { i, r };
        }
        if (best) setPage(best.i);
      },
      { root, threshold: [0.35, 0.55, 0.75] },
    );
    for (const n of nodes) io.observe(n);
    return () => io.disconnect();
  }, [paged, paragraphs.length, currentId]);

  useEffect(() => {
    if (paged || !strip.current) return;
    const el = strip.current.querySelector(`[data-i="${clamp(initialParagraph, count)}"]`);
    el?.scrollIntoView({ block: "start" });
  }, [currentId, initialParagraph, count, paged]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const fwd = rtl ? -1 : 1;
      switch (e.key) {
        case "Escape":
          if (menu) setMenu(false);
          else router.push(backHref);
          break;
        case "ArrowLeft":
        case "a":
          e.preventDefault();
          step(-fwd);
          break;
        case "ArrowRight":
        case "d":
        case " ":
          e.preventDefault();
          step(fwd);
          break;
        case "ArrowUp":
          if (paged) {
            e.preventDefault();
            step(-1);
          }
          break;
        case "ArrowDown":
          if (paged) {
            e.preventDefault();
            step(1);
          }
          break;
        case "h":
          setChrome((v) => !v);
          break;
        case "m":
          setMenu((v) => !v);
          setChrome(true);
          break;
        case "r":
          setPrefs((p) => ({ ...p, rtl: !p.rtl }));
          break;
        case "w":
        case "c":
          setPrefs((p) => ({ ...p, mode: p.mode === "paged" ? "continuous" : "paged" }));
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "[":
          setPrefs((p) => ({ ...p, fontSize: clampNovelFontSize(p.fontSize - 1) }));
          break;
        case "]":
          setPrefs((p) => ({ ...p, fontSize: clampNovelFontSize(p.fontSize + 1) }));
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backHref, menu, paged, router, rtl, step]);

  useEffect(() => {
    if (!menu || !chaptersEl.current || currentChapter < 0) return;
    const on = chaptersEl.current.querySelector(".reader-chapter.on");
    on?.scrollIntoView({ block: "center" });
  }, [menu, currentChapter, currentId]);

  const onTapDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    tap0.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onTapUp = (e: PointerEvent) => {
    const t = tap0.current;
    tap0.current = null;
    if (!t || t.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 12) return;
    const stage = e.currentTarget as HTMLElement;
    const r = stage.getBoundingClientRect();
    const z = tapZone(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (z === "mid" || z === "top") {
      setChrome((v) => !v);
      return;
    }
    if (z === "left") step(rtl ? 1 : -1);
    else if (z === "right") step(rtl ? -1 : 1);
  };

  const t = count > 1 ? page / (count - 1) : 1;
  const visible = chrome || menu;

  return (
    <div
      ref={reader}
      className={`reader novel-reader${visible ? "" : " bare"}`}
      data-mode={mode}
      data-rtl={rtl ? "" : undefined}
      style={{ ["--novel-size" as string]: `${fontSize}px` }}
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
              {page + 1} / {count}
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
          className="reader-stage novel-stage"
          data-rtl={rtl ? "" : undefined}
          onPointerDown={onTapDown}
          onPointerUp={onTapUp}
          onPointerCancel={() => {
            tap0.current = null;
          }}
        >
          <article className="novel-page" dir={rtl ? "rtl" : "ltr"}>
            <p>{paragraphs[page] ?? ""}</p>
          </article>
        </div>
      ) : (
        <div
          className="reader-webtoon novel-scroll"
          onPointerDown={onTapDown}
          onPointerUp={onTapUp}
          onPointerCancel={() => {
            tap0.current = null;
          }}
        >
          <div className="reader-strip novel-strip" ref={strip} dir={rtl ? "rtl" : "ltr"}>
            <article className="novel-flow">
              {paragraphs.map((text, i) => (
                <p key={i} data-i={i} className={i === page ? "on" : undefined}>
                  {text}
                </p>
              ))}
            </article>
          </div>
        </div>
      )}

      <Hop href={rtl ? nextHref : prevHref} side="prev" chapter={rtl ? "next" : "prev"} />
      <Hop href={rtl ? prevHref : nextHref} side="next" chapter={rtl ? "prev" : "next"} />

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
            <Opt
              on={mode === "continuous"}
              label="Scroll"
              onClick={() => setPrefs((p) => ({ ...p, mode: "continuous" }))}
            >
              <Icon d={PATH.scroll} filled={false} />
            </Opt>
          </div>
        </div>
        <div className="reader-group">
          <b>Text size</b>
          <div className="reader-group-opts novel-size-opts">
            <button
              type="button"
              className="reader-opt"
              aria-label="Smaller text"
              title="Smaller ([)"
              onClick={() => setPrefs((p) => ({ ...p, fontSize: clampNovelFontSize(p.fontSize - 1) }))}
            >
              <span style={{ fontSize: 13 }}>A−</span>
            </button>
            <span className="mono novel-size-label">{fontSize}</span>
            <button
              type="button"
              className="reader-opt"
              aria-label="Larger text"
              title="Larger (])"
              onClick={() => setPrefs((p) => ({ ...p, fontSize: clampNovelFontSize(p.fontSize + 1) }))}
            >
              <span style={{ fontSize: 17 }}>A+</span>
            </button>
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
          max={Math.max(0, count - 1)}
          step={1}
          value={page}
          dir={rtl ? "rtl" : "ltr"}
          aria-label="Paragraph"
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
  scroll: "M8 3h8v5H8zM8 9.5h8v5H8zM8 16h8v5H8z",
};

function readPrefs(store: string, fallback: NovelReaderPrefs): NovelReaderPrefs {
  return parseNovelReaderPrefs(
    localStorage.getItem(store) ?? localStorage.getItem(GLOBAL) ?? JSON.stringify(fallback),
  );
}

const clamp = (i: number, len: number) => Math.min(Math.max(i, 0), Math.max(0, len - 1));

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* denied or unsupported */
  }
}

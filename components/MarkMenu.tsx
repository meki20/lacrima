"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MediaKind } from "@/lib/media";

const closeAll = new EventTarget();

type Pos = { top: number; left: number };

function place(btn: HTMLElement, menu: HTMLElement): Pos {
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const gap = 6;
  const pad = 12;
  const left = Math.min(Math.max(pad, r.right - w), Math.max(pad, window.innerWidth - w - pad));
  const below = r.bottom + gap;
  const above = r.top - gap - h;
  const top = below + h <= window.innerHeight - pad || above < pad ? below : above;
  return {
    top: Math.min(Math.max(pad, top), Math.max(pad, window.innerHeight - h - pad)),
    left,
  };
}

export default function MarkMenu({
  kind,
  read,
  onMark,
  onUpTo,
  onUnmark,
}: {
  kind: MediaKind;
  read: boolean;
  onMark: () => void;
  onUpTo: () => void;
  onUnmark: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const word = kind === "anime" ? "watched" : "read";

  useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    closeAll.addEventListener("close", hide);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onPtr = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPtr, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      closeAll.removeEventListener("close", hide);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPtr, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    setPos(place(btn, pop));
  }, [open, read]);

  return (
    <div className="row-mark">
      <button
        ref={btnRef}
        type="button"
        className="row-mark-btn"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) {
            setOpen(false);
            return;
          }
          closeAll.dispatchEvent(new Event("close"));
          setOpen(true);
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={menuId}
            className="lib-menu-pop mark-pop"
            role="menu"
            style={{ top: pos.top, left: pos.left }}
          >
            {read ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onUnmark();
                }}
              >
                Mark as un{word}
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onMark();
                }}
              >
                Mark as {word}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onUpTo();
              }}
            >
              Mark as {word} up to here
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

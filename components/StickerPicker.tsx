"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { setCarry } from "@/lib/sticker-carry";
import { filterStickerGroups, type StickerGroup, type StickerPick } from "@/lib/sticker-catalog";

export default function StickerPicker() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [groups, setGroups] = useState<StickerGroup[] | null>(null);
  const [q, setQ] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!open) {
      setQ("");
      return;
    }
    let live = true;
    setGroups(null);
    void fetch("/api/stickers")
      .then((r) => r.json() as Promise<{ groups?: StickerGroup[] }>)
      .then((j) => {
        if (live) setGroups(Array.isArray(j.groups) ? j.groups : []);
      })
      .catch(() => {
        if (live) setGroups([]);
      });
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open && groups && groups.length) search.current?.focus();
  }, [open, groups]);

  const pick = (s: StickerPick) => {
    setCarry({ id: s.id, src: s.src, name: s.name, scale: 1, rot: 0 });
    setOpen(false);
    btn.current?.focus();
  };

  const shown = groups ? filterStickerGroups(groups, q) : null;

  const modal =
    ready &&
    open &&
    createPortal(
      <div
        className="sticker-modal-back"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            setOpen(false);
            btn.current?.focus();
          }
        }}
      >
        <div
          className="sticker-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sticker-modal-title"
        >
          <h2 id="sticker-modal-title">Place a sticker</h2>
          <p>Click one to carry it, then click anywhere on the page to put it down.</p>
          {groups != null && groups.length > 0 && (
            <input
              ref={search}
              className="search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a series or character"
              aria-label="Search a series or character"
            />
          )}
          {shown == null ? (
            <p className="sticker-modal-empty">Loading…</p>
          ) : groups?.length === 0 ? (
            <div className="empty">
              <b>None earned yet</b>
              Track a title, then watch or read. Come back when a sticker unlocks.
            </div>
          ) : shown.length === 0 ? (
            <div className="empty">
              <b>Nothing matches</b>
              Try a series or a character name.
            </div>
          ) : (
            shown.map((g) => (
              <section className="sticker-title" key={g.title}>
                <div className="row-h">
                  <h3>{g.title}</h3>
                  <span className="mono">{g.stickers.length}</span>
                </div>
                <div className="sticker-grid">
                  {g.stickers.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="sticker-slot earned"
                      aria-label={s.name}
                      onClick={() => pick(s)}
                    >
                      <img src={s.src} alt={s.name} />
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>,
      document.body,
    );

  return (
    <div className="sticker-picker">
      <button
        ref={btn}
        type="button"
        className="settings-link"
        aria-label="Place a sticker"
        title="Stickers"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2" />
        </svg>
      </button>
      {modal}
    </div>
  );
}

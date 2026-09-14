"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname } from "next/navigation";
import { getCarry, onCarry, setCarry, type Carry } from "@/lib/sticker-carry";
import {
  CHROME,
  HOLD_MS,
  STICKER_SIZE,
  chromeKind,
  clampCoord,
  clampRot,
  clampScale,
  pagePath,
  placeBlocked,
  rectFrac,
  surfaceForWidth,
  type Surface,
} from "@/lib/sticker-place";

type Placement = {
  id: number;
  stickerId: string;
  path: string;
  x: number;
  y: number;
  scale: number;
  rot: number;
  name: string;
  src: string;
};

function docBox() {
  const d = document.documentElement;
  return {
    w: Math.max(d.scrollWidth, window.innerWidth, 1),
    h: Math.max(d.scrollHeight, window.innerHeight, 1),
  };
}

function pageFrac(e: { pageX: number; pageY: number }) {
  const { w, h } = docBox();
  return { x: clampCoord(e.pageX / w), y: clampCoord(e.pageY / h) };
}

function viewFrac(e: { clientX: number; clientY: number }) {
  return {
    x: clampCoord(e.clientX / (window.innerWidth || 1)),
    y: clampCoord(e.clientY / (window.innerHeight || 1)),
  };
}

function chromeBox(sel: string) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const s = getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden") return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function chromeAt(x: number, y: number): "sidebar" | "topbar" | null {
  const hit = (sel: string) => {
    const r = chromeBox(sel);
    return Boolean(r && x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height);
  };
  if (hit(".sidebar")) return "sidebar";
  if (hit(".topbar")) return "topbar";
  return null;
}

function fromPicker(t: EventTarget | null) {
  return Boolean(
    (t as HTMLElement | null)?.closest?.(".sticker-picker, .sticker-modal-back, .sticker-carry-bar"),
  );
}

function destFor(
  e: { clientX: number; clientY: number; pageX: number; pageY: number },
  here: string,
) {
  const kind = chromeAt(e.clientX, e.clientY);
  if (kind) {
    const el = document.querySelector(kind === "sidebar" ? ".sidebar" : ".topbar");
    const r = el?.getBoundingClientRect();
    if (r) return { path: CHROME[kind], at: rectFrac(e.clientX, e.clientY, r) };
  }
  return { path: here, at: pageFrac(e) };
}

function bumpScale(scale: number, deltaY: number) {
  return clampScale(scale * (deltaY < 0 ? 1.08 : 1 / 1.08));
}

function bumpRot(rot: number, deltaY: number, step = 8) {
  return clampRot(rot + (deltaY < 0 ? step : -step));
}

export default function StickerDecor() {
  const raw = usePathname() ?? "";
  const path = pagePath(raw);
  const blocked = placeBlocked(path);
  const [items, setItems] = useState<Placement[]>([]);
  const [carry, setCarryState] = useState<Carry | null>(null);
  const [ghost, setGhost] = useState({ x: 0.5, y: 0.5 });
  const [doc, setDoc] = useState({ w: 1, h: 1 });
  const [surface, setSurface] = useState<Surface>("desktop");
  const [rails, setRails] = useState<{
    sidebar: { left: number; top: number; width: number; height: number } | null;
    topbar: { left: number; top: number; width: number; height: number } | null;
  }>({ sidebar: null, topbar: null });
  const carryRef = useRef<Carry | null>(null);
  const placing = useRef(false);
  const armed = useRef(false);
  const placeAtRef = useRef<(x: number, y: number) => void>(() => {});

  useEffect(() => {
    const sync = () => {
      const c = getCarry();
      carryRef.current = c;
      setCarryState(c);
    };
    sync();
    return onCarry(sync);
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      setDoc(docBox());
      setSurface(surfaceForWidth(window.innerWidth));
      setRails({ sidebar: chromeBox(".sidebar"), topbar: chromeBox(".topbar") });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [path]);

  useEffect(() => {
    let ok = true;
    void fetch(
      `/api/sticker-placements?path=${encodeURIComponent(path || "/")}&surface=${surface}`,
    )
      .then((r) => r.json() as Promise<{ placements?: Placement[] }>)
      .then((j) => {
        if (ok) setItems(Array.isArray(j.placements) ? j.placements : []);
      })
      .catch(() => {
        if (ok) setItems([]);
      });
    return () => {
      ok = false;
    };
  }, [path, surface]);

  useEffect(() => {
    document.documentElement.classList.toggle("sticker-carrying", Boolean(carry));
    return () => document.documentElement.classList.remove("sticker-carrying");
  }, [carry]);

  useEffect(() => {
    if (!carry) {
      armed.current = false;
      return;
    }
    const move = (e: PointerEvent) => {
      if (fromPicker(e.target)) return;
      setGhost(viewFrac(e));
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const cur = carryRef.current;
      if (!cur) return;
      const next = e.shiftKey
        ? { ...cur, rot: bumpRot(cur.rot, e.deltaY) }
        : { ...cur, scale: bumpScale(cur.scale, e.deltaY) };
      carryRef.current = next;
      setCarry(next);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCarry(null);
    };
    const commit = (e: { clientX: number; clientY: number; pageX: number; pageY: number }) => {
      const cur = carryRef.current;
      const here = pagePath(location.pathname);
      if (!cur || placeBlocked(here) || placing.current) return;
      placing.current = true;
      const { path: dest, at } = destFor(e, here);
      const keep = (placement: Placement) =>
        Boolean(chromeKind(placement.path)) || placement.path === pagePath(location.pathname);
      const done = (placement?: Placement) => {
        if (placement && keep(placement)) {
          setItems((list) => {
            const rest = list.filter((it) => it.id !== placement.id);
            return [...rest, placement];
          });
        }
        setCarry(null);
        placing.current = false;
      };
      if (cur.placeId != null) {
        void fetch("/api/sticker-placements", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: cur.placeId,
            path: dest,
            x: at.x,
            y: at.y,
            scale: cur.scale,
            rot: cur.rot,
            surface,
          }),
        })
          .then((r) => r.json() as Promise<{ ok?: boolean; placement?: Placement }>)
          .then((j) => done(j.ok ? j.placement : undefined))
          .catch(() => {
            placing.current = false;
          });
        return;
      }
      void fetch("/api/sticker-placements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stickerId: cur.id,
          path: dest,
          x: at.x,
          y: at.y,
          scale: cur.scale,
          rot: cur.rot,
          surface,
        }),
      })
        .then((r) => r.json() as Promise<{ ok?: boolean; placement?: Placement }>)
        .then((j) => {
          if (j.ok) done(j.placement);
          else placing.current = false;
        })
        .catch(() => {
          placing.current = false;
        });
    };
    placeAtRef.current = (clientX, clientY) =>
      commit({
        clientX,
        clientY,
        pageX: clientX + window.scrollX,
        pageY: clientY + window.scrollY,
      });
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || fromPicker(e.target) || placeBlocked(pagePath(location.pathname))) return;
      armed.current = true;
      e.preventDefault();
      e.stopPropagation();
    };
    const up = (e: PointerEvent) => {
      if (e.button !== 0 || fromPicker(e.target) || placing.current || !armed.current) return;
      armed.current = false;
      e.preventDefault();
      e.stopPropagation();
      commit(e);
    };
    const pinch = { last: 0 };
    const touch = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        pinch.last = 0;
        return;
      }
      e.preventDefault();
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      if (pinch.last) {
        const cur = carryRef.current;
        if (cur) {
          const next = { ...cur, scale: bumpScale(cur.scale, pinch.last - d) };
          carryRef.current = next;
          setCarry(next);
        }
      }
      pinch.last = d;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("touchmove", touch, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("touchmove", touch);
    };
  }, [carry ? `${carry.id}:${carry.placeId ?? ""}` : "", surface]);

  const onDecalDown = (e: ReactPointerEvent<HTMLButtonElement>, p: Placement) => {
    if (e.button !== 0 || carry || placeBlocked(pagePath(location.pathname))) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.blur();
    const origin = { x: e.clientX, y: e.clientY };
    const lift = () => {
      setGhost(viewFrac({ clientX: origin.x, clientY: origin.y }));
      setCarry({
        id: p.stickerId,
        src: p.src,
        name: p.name,
        scale: p.scale,
        rot: p.rot,
        placeId: p.id,
      });
    };
    if (surface === "mobile") {
      lift();
      return;
    }
    let lifted = false;
    const hold = window.setTimeout(() => {
      lifted = true;
      lift();
    }, HOLD_MS);

    const move = (ev: PointerEvent) => {
      if (lifted) return;
      const dx = ev.clientX - origin.x;
      const dy = ev.clientY - origin.y;
      if (dx * dx + dy * dy > 36) window.clearTimeout(hold);
    };
    const up = () => {
      window.clearTimeout(hold);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const remove = (id: number) => {
    setItems((cur) => cur.filter((it) => it.id !== id));
    void fetch("/api/sticker-placements", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  };

  const over = path.startsWith("/read/");
  const size = (scale: number) => STICKER_SIZE * scale;
  const lifted = carry?.placeId;
  const pageStickers = items.filter((p) => p.id !== lifted && !chromeKind(p.path) && !blocked);
  const sidebarStickers = items.filter((p) => p.id !== lifted && p.path === CHROME.sidebar);
  const topbarStickers = items.filter((p) => p.id !== lifted && p.path === CHROME.topbar);

  const decal = (p: Placement, chrome: boolean) => {
    const px = size(p.scale);
    return (
      <button
        key={p.id}
        type="button"
        className={`sticker-decal${chrome ? " chrome" : ""}${over && !chrome ? " over-reader" : ""}`}
        aria-label={p.name}
        tabIndex={-1}
        style={{
          left: chrome ? `${p.x * 100}%` : p.x * doc.w,
          top: chrome ? `${p.y * 100}%` : p.y * doc.h,
          width: px,
          height: px,
          transform: `translate(-50%, -50%) rotate(${p.rot}deg)`,
        }}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => onDecalDown(e, p)}
        onDoubleClick={(e) => {
          if (surface === "mobile") return;
          e.preventDefault();
          e.stopPropagation();
          remove(p.id);
        }}
      >
        <img src={p.src} alt="" draggable={false} />
      </button>
    );
  };

  return (
    <>
      {pageStickers.length > 0 && (
        <div className="sticker-layer" style={{ height: doc.h }}>
          {pageStickers.map((p) => decal(p, false))}
        </div>
      )}
      {rails.sidebar && sidebarStickers.length > 0 && (
        <div
          className="sticker-chrome-layer"
          style={{
            left: rails.sidebar.left,
            top: rails.sidebar.top,
            width: rails.sidebar.width,
            height: rails.sidebar.height,
          }}
        >
          {sidebarStickers.map((p) => decal(p, true))}
        </div>
      )}
      {rails.topbar && topbarStickers.length > 0 && (
        <div
          className="sticker-chrome-layer"
          style={{
            left: rails.topbar.left,
            top: rails.topbar.top,
            width: rails.topbar.width,
            height: rails.topbar.height,
          }}
        >
          {topbarStickers.map((p) => decal(p, true))}
        </div>
      )}
      {carry && (
        <>
          <div
            className="sticker-ghost"
            style={{
              left: `${ghost.x * 100}%`,
              top: `${ghost.y * 100}%`,
              width: size(carry.scale),
              height: size(carry.scale),
              transform: `translate(-50%, -50%) rotate(${carry.rot}deg)`,
            }}
          >
            <img src={carry.src} alt="" draggable={false} />
          </div>
          {surface === "mobile" && (
            <div className="sticker-carry-bar" role="toolbar" aria-label="Sticker">
              <button
                type="button"
                className="place"
                onClick={() =>
                  placeAtRef.current(ghost.x * window.innerWidth, ghost.y * window.innerHeight)
                }
              >
                Place
              </button>
              <button
                type="button"
                onClick={() => {
                  const cur = carryRef.current;
                  if (!cur) return;
                  const next = { ...cur, rot: bumpRot(cur.rot, -1, 15) };
                  carryRef.current = next;
                  setCarry(next);
                }}
              >
                Rotate
              </button>
              <button
                type="button"
                onClick={() => {
                  const cur = carryRef.current;
                  if (!cur) return;
                  const next = { ...cur, scale: bumpScale(cur.scale, 1) };
                  carryRef.current = next;
                  setCarry(next);
                }}
              >
                Smaller
              </button>
              <button
                type="button"
                onClick={() => {
                  const cur = carryRef.current;
                  if (!cur) return;
                  const next = { ...cur, scale: bumpScale(cur.scale, -1) };
                  carryRef.current = next;
                  setCarry(next);
                }}
              >
                Bigger
              </button>
              {carry.placeId != null && (
                <button
                  type="button"
                  onClick={() => {
                    if (carry.placeId != null) remove(carry.placeId);
                    setCarry(null);
                  }}
                >
                  Remove
                </button>
              )}
              <button type="button" onClick={() => setCarry(null)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

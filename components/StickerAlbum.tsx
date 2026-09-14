"use client";

import { useEffect, useState } from "react";

type Slot = {
  id: string;
  name: string;
  secret: boolean;
  earned: boolean;
  src: string | null;
};

type Title = {
  via: string;
  id: number;
  title: string;
  href: string;
  earned: number;
  slots: Slot[];
};

const CODE = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
];

export default function StickerAlbum({ titles }: { titles: Title[] }) {
  const [rows, setRows] = useState(titles);
  const [egg, setEgg] = useState(false);

  useEffect(() => {
    let at = 0;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k !== CODE[at]) {
        at = k === CODE[0] ? 1 : 0;
        return;
      }
      at++;
      if (at === CODE.length) {
        at = 0;
        setEgg(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const poke = (slot: Slot) => {
    if (!egg) return;
    void fetch("/api/stickers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: slot.id }),
    })
      .then(
        (r) =>
          r.json() as Promise<{
            ok?: boolean;
            earned?: boolean;
            src?: string | null;
            name?: string;
          }>,
      )
      .then((j) => {
        if (!j.ok || typeof j.earned !== "boolean") return;
        setRows((cur) =>
          cur.map((t) => {
            if (!t.slots.some((s) => s.id === slot.id)) return t;
            const slots = t.slots.map((s) =>
              s.id === slot.id
                ? { ...s, earned: j.earned!, src: j.src ?? null, name: j.name ?? s.name }
                : s,
            );
            return { ...t, slots, earned: slots.filter((x) => x.earned).length };
          }),
        );
      })
      .catch(() => {});
  };

  return (
    <div className={egg ? "sticker-egg" : undefined}>
      {rows.map((t) => (
        <section className="sticker-title" key={`${t.via}-${t.id}`}>
          <div className="row-h">
            <h2>
              <a href={t.href}>{t.title}</a>
            </h2>
            <span className="mono">
              {t.earned} / {t.slots.length}
            </span>
          </div>
          {t.slots.length === 0 ? (
            <p className="yours-muted">No character art for this title yet.</p>
          ) : (
            <div className="sticker-grid">
              {t.slots.map((s) => {
                const cls = `sticker-slot${s.earned ? " earned" : " locked"}${s.secret ? " secret" : ""}`;
                const inner = s.src ? (
                  <img src={s.src} alt={s.earned || !s.secret ? s.name : ""} />
                ) : (
                  <span>?</span>
                );
                return egg ? (
                  <button key={s.id} type="button" className={cls} onClick={() => poke(s)}>
                    {inner}
                  </button>
                ) : (
                  <div key={s.id} className={cls} title={s.secret && !s.earned ? undefined : s.name}>
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

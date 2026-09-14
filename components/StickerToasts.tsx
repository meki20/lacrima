"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  holdStickerToasts,
  onStickerQueue,
  peekStickers,
  takeStickers,
  type AwardedSticker,
} from "@/lib/progress-write";

export default function StickerToasts() {
  const path = usePathname() ?? "";
  const hold = holdStickerToasts(path);
  const [items, setItems] = useState<AwardedSticker[]>([]);

  useEffect(() => {
    const flush = () => setItems(hold ? [] : peekStickers());
    flush();
    return onStickerQueue(flush);
  }, [hold, path]);

  useEffect(() => {
    if (hold || !items.length) return;
    const t = setTimeout(() => {
      takeStickers();
      setItems([]);
    }, 4200);
    return () => clearTimeout(t);
  }, [hold, items]);

  if (hold || !items.length) return null;
  const many = items.length > 1;
  return (
    <div className="sticker-toast" role="status">
      <div className="sticker-toast-stack">
        {items.map((s, i) => (
          <span
            className={`sticker-slot earned${s.secret ? " secret" : ""}`}
            key={`${s.id}-${i}`}
            style={{ zIndex: i + 1 }}
          >
            {s.src ? <img src={s.src} alt="" /> : <span>?</span>}
          </span>
        ))}
      </div>
      <b>{many ? "New stickers" : "New sticker"}</b>
    </div>
  );
}

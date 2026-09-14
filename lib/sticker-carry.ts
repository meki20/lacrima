import { clampRot, clampScale } from "./sticker-place.ts";

export type Carry = {
  id: string;
  src: string;
  name: string;
  scale: number;
  rot: number;
  placeId?: number;
};

const KEY = "lacrima.stickerCarry";
const EVT = "lacrima:carry";

export function getCarry(): Carry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Carry;
    if (!c?.id || !c.src || !c.name) return null;
    return {
      id: c.id,
      src: c.src,
      name: c.name,
      scale: clampScale(c.scale ?? 1),
      rot: clampRot(c.rot ?? 0),
      placeId: typeof c.placeId === "number" ? c.placeId : undefined,
    };
  } catch {
    return null;
  }
}

export function setCarry(c: Carry | null) {
  if (typeof window === "undefined") return;
  if (c) {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...c, scale: clampScale(c.scale), rot: clampRot(c.rot) }),
    );
  } else sessionStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVT));
}

export function onCarry(fn: () => void): () => void {
  window.addEventListener(EVT, fn);
  return () => window.removeEventListener(EVT, fn);
}

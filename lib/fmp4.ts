/** Walk ISO-BMFF boxes. `size === 1` is the 64-bit form; `size === 0` runs to EOF. */
function walk(
  buf: Uint8Array,
  visit: (type: string, payload: Uint8Array) => boolean,
): boolean {
  let i = 0;
  while (i + 8 <= buf.byteLength) {
    const view = new DataView(buf.buffer, buf.byteOffset + i, buf.byteLength - i);
    let size = view.getUint32(0);
    let header = 8;
    if (size === 1) {
      if (i + 16 > buf.byteLength) break;
      const big = view.getBigUint64(8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = buf.byteLength - i;
    } else if (size < 8) {
      break;
    }
    if (i + size > buf.byteLength) break;
    const type = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]);
    if (visit(type, buf.subarray(i + header, i + size))) return true;
    i += size;
  }
  return false;
}

const NESTED = new Set(["moov", "trak", "mdia", "moof", "traf"]);

function findBox(buf: Uint8Array, want: string): Uint8Array | null {
  let hit: Uint8Array | null = null;
  walk(buf, (type, payload) => {
    if (type === want) {
      hit = payload;
      return true;
    }
    if (NESTED.has(type) && (hit = findBox(payload, want))) return true;
    return false;
  });
  return hit;
}

/** Movie timescale from `mdhd`. Fragment decode times are in these units. */
export function readTimescale(buf: Uint8Array): number | null {
  const mdhd = findBox(buf, "mdhd");
  if (!mdhd || mdhd.byteLength < 16) return null;
  const view = new DataView(mdhd.buffer, mdhd.byteOffset, mdhd.byteLength);
  const scale = mdhd[0] === 1 ? view.getUint32(20) : view.getUint32(12);
  return scale > 0 ? scale : null;
}

/** First `tfdt` baseMediaDecodeTime. That is the remux's first frame, in timescale ticks. */
export function readTfdt(buf: Uint8Array): number | null {
  const tfdt = findBox(buf, "tfdt");
  if (!tfdt || tfdt.byteLength < 8) return null;
  const view = new DataView(tfdt.buffer, tfdt.byteOffset, tfdt.byteLength);
  if (tfdt[0] === 1) {
    if (tfdt.byteLength < 12) return null;
    const big = view.getBigUint64(4);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(big);
  }
  return view.getUint32(4);
}

export type RemuxClock = { timescale: number | null; origin: number | null };

/**
 * First frame's episode time, once both `mdhd` and a `tfdt` have arrived.
 * Sequence-mode MSE still clocks from 0; this is the offset those ticks sit on.
 */
export function scanRemuxClock(buf: Uint8Array, prev: RemuxClock): RemuxClock {
  const timescale = prev.timescale ?? readTimescale(buf);
  if (prev.origin != null) return { timescale, origin: prev.origin };
  if (!timescale) return { timescale, origin: null };
  const ticks = readTfdt(buf);
  if (ticks == null) return { timescale, origin: null };
  return { timescale, origin: ticks / timescale };
}

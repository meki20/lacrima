/** Picker grouping helpers. Safe for client import — no sqlite. */

export type StickerPick = { id: string; name: string; src: string };
export type StickerGroup = { title: string; stickers: StickerPick[] };

export function filterStickerGroups(groups: StickerGroup[], q: string): StickerGroup[] {
  const n = q.trim().toLowerCase();
  if (!n) return groups;
  const out: StickerGroup[] = [];
  for (const g of groups) {
    const seriesHit = g.title.toLowerCase().includes(n);
    const stickers = seriesHit
      ? g.stickers
      : g.stickers.filter((s) => s.name.toLowerCase().includes(n));
    if (stickers.length) out.push({ ...g, stickers });
  }
  return out;
}

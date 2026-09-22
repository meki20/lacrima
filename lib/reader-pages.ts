/** Glue short source fragments onto the previous print page. */
export function stitchPageGroups(heights: number[]): number[][] {
  if (heights.length === 0) return [];
  const groups: number[][] = [];
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i] ?? 0;
    const prev = groups.at(-1);
    const lead = prev?.[0] != null ? (heights[prev[0]] ?? 0) : 0;
    if (prev && lead > 0 && h > 0 && h < lead * 0.35) prev.push(i);
    else groups.push([i]);
  }
  return groups;
}

export function groupIndexForPage(groups: number[][], page: number): number {
  if (groups.length === 0) return 0;
  const at = groups.findIndex((g) => g.includes(page));
  return at >= 0 ? at : 0;
}

export function pageStepGroups(
  page: number,
  delta: number,
  groups: number[][],
  spread: "single" | "double",
): number {
  if (groups.length === 0) return 0;
  const step = spread === "double" ? 2 : 1;
  const next = Math.min(
    groups.length - 1,
    Math.max(0, groupIndexForPage(groups, page) + delta * step),
  );
  return groups[next]![0]!;
}

/** Same-origin proxy URLs — loads also warm the reader cache. */
export function probeImageHeights(urls: string[]): Promise<number[]> {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise<number>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalHeight || 0);
          img.onerror = () => resolve(0);
          img.src = url;
        }),
    ),
  );
}

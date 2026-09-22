/** Split novel HTML into portable paragraph blocks for paged reading + progress. */
export function htmlParagraphs(html: string): string[] {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const blocks = cleaned
    .replace(/<\/?(?:p|div|h[1-6]|li|blockquote|tr|section|article)[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\n\s*\n+/)
    .map((chunk) => stripTags(chunk).trim())
    .filter(Boolean);
  if (blocks.length > 0) return blocks;
  const fallback = stripTags(cleaned).trim();
  return fallback ? [fallback] : [];
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Match Android: `p:${index}` — `paragraphIndex` reads the trailing int. */
export function paragraphCfi(index: number): string {
  return `p:${Math.max(0, Math.floor(index))}`;
}

export function paragraphIndex(cfi: string | null | undefined): number {
  if (!cfi) return 0;
  const n = Number(String(cfi).split(":").pop());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

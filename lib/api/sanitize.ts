import { load } from "cheerio";

/** Novel plugins return HTML. Keep prose markup, remove anything executable. */
export function sanitizeNovelHtml(raw: string): string {
  const $ = load(raw, null, false);
  $("script, iframe, object, embed, form, link, meta").remove();
  $("*").each((_i, el) => {
    if (!("attribs" in el)) return;
    for (const name of Object.keys(el.attribs ?? {})) {
      const value = $(el).attr(name)?.trim() ?? "";
      if (/^on/i.test(name) || (/^(?:href|src|xlink:href)$/i.test(name) && /^javascript:/i.test(value))) {
        $(el).removeAttr(name);
      }
    }
  });
  return $.html();
}

import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeNovelHtml } from "./sanitize.ts";

test("novel HTML keeps prose but removes executable content", () => {
  const html = sanitizeNovelHtml('<p onclick="steal()">Hello <em>reader</em></p><script>steal()</script><a href="javascript:steal()">bad</a>');
  assert.match(html, /Hello <em>reader<\/em>/);
  assert.doesNotMatch(html, /script|onclick|javascript:/i);
});

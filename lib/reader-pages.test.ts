import assert from "node:assert/strict";
import { test } from "node:test";
import { groupIndexForPage, pageStepGroups, stitchPageGroups } from "./reader-pages.ts";

test("short page stubs glue onto the previous page", () => {
  assert.deepEqual(stitchPageGroups([2000, 1800, 400, 1900]), [[0], [1, 2], [3]]);
  assert.deepEqual(stitchPageGroups([2000, 1900, 1800]), [[0], [1], [2]]);
  assert.deepEqual(stitchPageGroups([2000, 300]), [[0, 1]]);
});

test("page step walks stitched groups", () => {
  const groups = stitchPageGroups([2000, 1800, 400, 1900]);
  assert.equal(groupIndexForPage(groups, 2), 1);
  assert.equal(pageStepGroups(1, 1, groups, "single"), 3);
  assert.equal(pageStepGroups(3, -1, groups, "single"), 1);
});

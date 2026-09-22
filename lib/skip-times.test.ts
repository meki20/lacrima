import assert from "node:assert/strict";
import { test } from "node:test";
import { adjustSkipTimes } from "./skip-times.ts";

test("skip times preserve AniSkip's exact endpoints across different stream lengths", () => {
  const raw = [{ type: "op" as const, start: 90, end: 180, episodeLength: 1440 }];
  assert.deepEqual(adjustSkipTimes(raw), [{ type: "op", start: 90, end: 180 }]);
});

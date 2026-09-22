import assert from "node:assert/strict";
import { test } from "node:test";
import { episodeLookup } from "./episode-metadata.ts";

test("episode metadata only follows explicit catalog identifiers", () => {
  assert.deepEqual(episodeLookup("anilist:269"), { service: "anilist", id: "269" });
  assert.deepEqual(episodeLookup("kitsu:244"), { service: "kitsu", id: "244" });
  assert.equal(episodeLookup("tt5979872"), null);
});

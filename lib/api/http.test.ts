import assert from "node:assert/strict";
import test from "node:test";
import { ApiFault, finiteNumber, jsonObject, parseKind, positiveId, profileFromHeaders, resultEnvelope } from "./http.ts";
import { Err, Ok } from "../result.ts";
import type { Profile } from "../profile.ts";

const profile: Profile = {
  id: 7,
  name: "Reader",
  avatar_color: "#630E19",
  accent: "#630E19",
  wallpaper: null,
  created_at: 1,
};

test("native profile header is explicit and validated", () => {
  assert.equal(profileFromHeaders(new Headers({ "X-Lacrima-Profile": "7" }), [profile]), profile);
  assert.throws(() => profileFromHeaders(new Headers(), [profile]), (e) => e instanceof ApiFault && e.code === "profile_required");
  assert.throws(() => profileFromHeaders(new Headers({ "X-Lacrima-Profile": "8" }), [profile]), (e) => e instanceof ApiFault && e.code === "profile_not_found");
  assert.equal(profileFromHeaders(new Headers(), [profile], false), null);
});

test("source Result keeps failure distinct from an empty success", () => {
  assert.deepEqual(resultEnvelope(Ok([])), { ok: true, data: [] });
  assert.deepEqual(resultEnvelope(Err("offline", 123)), {
    ok: false,
    error: { code: "upstream_unavailable", message: "offline", lastSuccess: 123 },
  });
});

test("trust-boundary parsers reject ambiguous route input", async () => {
  assert.equal(parseKind("novel"), "novel");
  assert.throws(() => parseKind("book"), ApiFault);
  assert.equal(positiveId("42"), 42);
  assert.throws(() => positiveId("4.2"), ApiFault);
  assert.equal(finiteNumber("1.5"), 1.5);
  await assert.rejects(() => jsonObject(new Request("http://x", { method: "POST", body: "[]" })), ApiFault);
});

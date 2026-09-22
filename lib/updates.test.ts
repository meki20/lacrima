import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPreferences, releaseFromGithub, releaseVersion } from "./updates.ts";

test("update preferences accept only a 24-hour time", () => {
  assert.deepEqual(cleanPreferences({ auto_update: true, update_time: "23:59" }), { auto_update: true, update_time: "23:59" });
  assert.deepEqual(cleanPreferences({ auto_update: true, update_time: "24:00" }), { auto_update: true, update_time: "03:00" });
});

test("GitHub release data is reduced to a safe public status", () => {
  assert.deepEqual(releaseFromGithub({ tag_name: "v1.0.0", name: "First release", html_url: "https://github.com/meki20/lacrima/releases/tag/v1.0.0", published_at: "2026-09-22T10:00:00Z" }), {
    tag: "v1.0.0", name: "First release", url: "https://github.com/meki20/lacrima/releases/tag/v1.0.0", published_at: Date.parse("2026-09-22T10:00:00Z"),
  });
  assert.equal(releaseFromGithub({ tag_name: "v1", html_url: "https://not-github.example/release" }), null);
});

test("only a release different from the installed package enables updating", () => {
  const release = releaseFromGithub({ tag_name: "v1.0.1", html_url: "https://github.com/meki20/lacrima/releases/tag/v1.0.1" });
  assert.deepEqual(releaseVersion(release, "1.0.0"), { label: "local dev", update_available: true });
  assert.deepEqual(releaseVersion(release, "1.0.1"), { label: "Version 1.0.1", update_available: false });
  assert.deepEqual(releaseVersion(null, "1.0.1"), { label: "local dev", update_available: false });
});

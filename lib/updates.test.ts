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
  assert.equal(releaseFromGithub([]), null);
  assert.equal(releaseFromGithub([{ tag_name: "a1.0.0", html_url: "https://github.com/meki20/lacrima/releases/tag/a1.0.0" }])?.tag, "a1.0.0");
  assert.equal(releaseFromGithub({ tag_name: "v1", html_url: "https://not-github.example/release" }), null);
});

test("only a newer release enables updating", () => {
  const release = releaseFromGithub({ tag_name: "v1.0.1", html_url: "https://github.com/meki20/lacrima/releases/tag/v1.0.1" });
  assert.deepEqual(releaseVersion(release, "1.0.0"), { label: "Version v1.0.0", update_available: true });
  assert.deepEqual(releaseVersion(release, "1.0.1"), { label: "Version v1.0.1", update_available: false });
  assert.deepEqual(releaseVersion(null, "1.0.4-alpha"), { label: "Version v1.0.4-alpha", update_available: false });
  assert.equal(releaseVersion({ ...release!, tag: "v1.0.2-alpha" }, "1.0.4-alpha").update_available, false);
  assert.equal(releaseVersion({ ...release!, tag: "v1.0.4" }, "1.0.4-alpha").update_available, true);
  assert.equal(releaseVersion({ ...release!, tag: "v1.0.4-alpha.10" }, "1.0.4-alpha.2").update_available, true);
});

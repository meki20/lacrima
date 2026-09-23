import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipBackup, zipBackup, type Backup } from "./backup.ts";

test("backups are readable ZIPs and reject the wrong backup type", () => {
  const backup: Backup = { version: 1, type: "profile", exportedAt: 1, data: { profile: { name: "Luka" } } };
  const zip = zipBackup(backup);
  assert.equal(zip.subarray(0, 4).toString(), "PK\x03\x04");
  assert.deepEqual(unzipBackup(zip), backup);
  assert.throws(() => unzipBackup(Buffer.from("not a zip")), /ZIP/);
});

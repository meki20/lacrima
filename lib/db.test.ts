import assert from "node:assert/strict";
import { test } from "node:test";
import { plain, plainAll } from "./db.ts";

/**
 * node:sqlite rows have a null prototype. React refuses to serialise those into
 * a client component's props or a server action's closure, which took down the
 * whole title page once. This is the guard.
 */
test("rows leaving the db layer have a real prototype", () => {
  const row = Object.assign(Object.create(null), { a: 1, b: "x" });
  assert.equal(Object.getPrototypeOf(row), null);

  const p = plain(row);
  assert.equal(Object.getPrototypeOf(p), Object.prototype);
  assert.deepEqual({ ...p }, { a: 1, b: "x" });

  assert.ok(plainAll([row]).every((r) => Object.getPrototypeOf(r) === Object.prototype));
});

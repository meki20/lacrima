import assert from "node:assert/strict";
import test from "node:test";
import { castOrigin } from "./cast-origin.ts";

test("only Google's Cast receiver gets cross-origin media access", () => {
  const request = (origin: string) => new Request("http://lacrima.local/api/stream", { headers: { origin } });
  assert.equal(castOrigin(request("https://www.gstatic.com")), "https://www.gstatic.com");
  assert.equal(castOrigin(request("https://cc1ad845.apps.googleusercontent.com")), "https://cc1ad845.apps.googleusercontent.com");
  assert.equal(castOrigin(request("https://evil.example")), null);
  assert.equal(castOrigin(request("http://www.gstatic.com")), null);
});

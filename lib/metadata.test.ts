import assert from "node:assert/strict";
import { test } from "node:test";
import { chain, walk } from "./metadata.ts";
import { Err, Ok } from "./result.ts";
import type { HomeData, Provider, SearchData } from "./media.ts";

const EMPTY: HomeData = {
  hero: null,
  popularAnime: [],
  popularManga: [],
  novels: [],
  forYou: [],
};

const EMPTY_SEARCH: SearchData = { anime: [], manga: [], novels: [] };

const stub: Omit<Provider, "name" | "fetchHome"> = {
  slug: "kitsu",
  fetchTitle: async () => Err("unused"),
  search: async () => Err("unused"),
  browse: async () => Err("unused"),
};

const good = (name: string): Provider => ({
  ...stub,
  name,
  fetchHome: async () => Ok(EMPTY),
  search: async () => Ok(EMPTY_SEARCH),
});

const bad = (name: string, why = "down"): Provider => ({
  ...stub,
  name,
  fetchHome: async () => Err(why),
  search: async () => Err(why),
});

test("first healthy provider serves, and is not marked degraded", async () => {
  const r = await chain([good("A"), good("B")], "Adventure");
  assert.ok(r.ok);
  assert.equal(r.value.via, "A");
  assert.equal(r.value.degraded, false);
});

test("falls through to the next provider and flags it as degraded", async () => {
  const r = await chain([bad("A"), good("B")], "Adventure");
  assert.ok(r.ok);
  assert.equal(r.value.via, "B");
  assert.equal(r.value.degraded, true);
});

test("total failure is an Err naming every provider, never an empty success", async () => {
  const r = await chain([bad("A", "403"), bad("B", "504")], "Adventure");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason.includes("A: 403"));
  assert.ok(!r.ok && r.reason.includes("B: 504"));
});

test("no providers configured fails loudly rather than returning empty rows", async () => {
  const r = await chain([], "Adventure");
  assert.equal(r.ok, false);
});

test("search uses the same fallback chain as home", async () => {
  const r = await walk([bad("A"), good("B")], (p) => p.search("frieren"));
  assert.ok(r.ok);
  assert.equal(r.value.via, "B");
  assert.equal(r.value.degraded, true);
});

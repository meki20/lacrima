import assert from "node:assert/strict";
import { test } from "node:test";
import { Err, Ok, type Result } from "../result.ts";
import type { SourceInfo } from "./types.ts";
import { allRemoteSources, backend, BACKENDS, clearSourceHealth, langMatches, pickSearchable } from "./index.ts";

test("en matches English plugin langs and not Japanese", () => {
  const langs = ["en"];
  assert.equal(langMatches("en", langs), true);
  assert.equal(langMatches("English", langs), true);
  assert.equal(langMatches("en,all", langs), true);
  assert.equal(langMatches("日本語", langs), false);
});

test("default en,all matches English and all-language sources, not every language", () => {
  const langs = ["en", "all"];
  assert.equal(langMatches("en", langs), true);
  assert.equal(langMatches("all", langs), true);
  assert.equal(langMatches("ja", langs), false);
  assert.equal(langMatches("es", langs), false);
  assert.equal(langMatches("*", ["*"]), true);
});

test("search caps remote sources without excluding the eighth eligible addon", () => {
  const sources = Array.from({ length: 9 }, (_, i) => ({
    id: String(i),
    lang: "all",
    kind: "anime" as const,
    isLocal: false,
  }));
  assert.deepEqual(pickSearchable(sources).map((source) => source.id), ["0", "1", "2", "3", "4", "5", "6", "7"]);
});

test("movie and series share anime's backend, and it is listed once", async () => {
  assert.equal(BACKENDS.movie, BACKENDS.anime);
  assert.equal(backend("series"), BACKENDS.anime);

  const { manga, novel, anime } = BACKENDS;
  const real = [manga.listSources, novel.listSources, anime.listSources];
  const answer = (ok: boolean) => async (): Promise<Result<SourceInfo[]>> => (ok ? Ok([]) : Err("down"));
  let shared = 0;
  try {
    manga.listSources = answer(true);
    novel.listSources = answer(true);
    anime.listSources = async () => { shared++; return Ok([]); };
    clearSourceHealth();
    assert.equal((await allRemoteSources()).ok, true);
    assert.equal(shared, 1);

    // "Every backend failed" counts distinct backends: three, not five kinds.
    for (const b of [manga, novel, anime]) b.listSources = answer(false);
    clearSourceHealth();
    assert.equal((await allRemoteSources()).ok, false);
  } finally {
    [manga.listSources, novel.listSources, anime.listSources] = real;
    clearSourceHealth();
  }
});

test("movie and series searches skip addons that declared they serve something else", () => {
  const s = (id: string, types?: string[]) => ({
    id, lang: "all", kind: "anime" as const, isLocal: false, ...(types ? { types } : {}),
  });
  const all = [s("films", ["movie"]), s("shows", ["series"]), s("anime", ["anime"]), s("undeclared")];
  const ids = (kind?: Parameters<typeof pickSearchable>[1]) => pickSearchable(all, kind).map((x) => x.id);
  assert.deepEqual(ids("movie"), ["films", "undeclared"]);
  assert.deepEqual(ids("series"), ["shows", "undeclared"]);
  // Anime, and callers that pass no kind, are not narrowed; the cap and language rules still apply.
  assert.deepEqual(ids("anime"), ["films", "shows", "anime", "undeclared"]);
  assert.deepEqual(ids(), ["films", "shows", "anime", "undeclared"]);
  const many = Array.from({ length: 12 }, (_, i) => s(`m${i}`, ["movie"]));
  assert.equal(pickSearchable(many, "movie").length, 8);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Media } from "./media.ts";
import {
  assembleSeries,
  collapseSeries,
  colonPrefix,
  episodeWindow,
  franchiseKey,
  franchiseLabel,
  partLabel,
  progressTree,
  seriesTitle,
  canonicalTitle,
  windowEpisodes,
  type SeriesNode,
} from "./series.ts";

const media = (id: number, title: string, kind: Media["kind"] = "anime"): Media => ({
  id,
  via: "kitsu",
  kind,
  title,
  cover: null,
  banner: null,
  color: null,
  description: null,
  genres: [],
  units: null,
  unitLabel: "episodes",
  score: null,
});

test("seriesTitle strips numbered seasons, parts and final season", () => {
  assert.equal(seriesTitle("Attack on Titan Season 2"), "Attack on Titan");
  assert.equal(seriesTitle("Attack on Titan Season 3 Part 2"), "Attack on Titan");
  assert.equal(seriesTitle("Attack on Titan: The Final Season"), "Attack on Titan");
  assert.equal(seriesTitle("Attack on Titan: The Final Season Part 2"), "Attack on Titan");
  assert.equal(seriesTitle("Attack on Titan Season 3 Specials"), "Attack on Titan");
  assert.equal(seriesTitle("JoJo's Bizarre Adventure: Stone Ocean Part 2"), "JoJo's Bizarre Adventure: Stone Ocean");
  assert.equal(seriesTitle("JoJo's Bizarre Adventure (2012)"), "JoJo's Bizarre Adventure");
  assert.equal(
    seriesTitle("JoJo's Bizarre Adventure Part 7: Steel Ball Run"),
    "JoJo's Bizarre Adventure: Steel Ball Run",
  );
  assert.equal(seriesTitle("Frieren: Beyond Journey's End Season 2"), "Frieren: Beyond Journey's End");
});

test("colonPrefix needs a colon-space, so Re:Zero stays whole", () => {
  assert.equal(colonPrefix("JoJo's Bizarre Adventure: Stardust Crusaders"), "JoJo's Bizarre Adventure");
  assert.equal(colonPrefix("Re:Zero − Starting Life in Another World"), null);
  assert.equal(colonPrefix("Kaguya-sama: Love is War"), "Kaguya-sama");
});

test("collapseSeries folds Attack on Titan cours into one tile", () => {
  const out = collapseSeries([
    media(1, "Attack on Titan Season 2"),
    media(2, "Attack on Titan"),
    media(3, "Attack on Titan Season 3 Part 2"),
    media(4, "Attack on Titan: The Final Season"),
    media(5, "Attack on Titan Season 3 Specials"),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Attack on Titan");
  assert.equal(out[0].id, 2, "shortest title is the root");
});

test("collapseSeries groups JoJo parts under the franchise name", () => {
  const out = collapseSeries([
    media(1, "JoJo's Bizarre Adventure: Stardust Crusaders"),
    media(2, "JoJo's Bizarre Adventure"),
    media(3, "JoJo's Bizarre Adventure: Diamond is Unbreakable"),
    media(4, "JoJo's Bizarre Adventure: Stone Ocean Part 2"),
    media(5, "JoJo's Bizarre Adventure (2012)"),
    media(6, "JoJo's Bizarre Adventure Part 7: Steel Ball Run"),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "JoJo's Bizarre Adventure");
  assert.equal(out[0].id, 2);
});

test("collapseSeries folds Dr. Stone cours under one name", () => {
  const out = collapseSeries([
    media(1, "Dr. STONE"),
    media(2, "Dr. STONE: Stone Wars"),
    media(3, "Dr. STONE: New World"),
    media(4, "Dr. STONE: Science Future"),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Dr. STONE");
  assert.equal(out[0].id, 1);
  assert.equal(canonicalTitle("Dr. STONE: Stone Wars", [
    "Dr. STONE",
    "Dr. STONE: Stone Wars",
  ]), "Dr. STONE");
});

test("franchiseKey folds progress-style Dr. Stone titles that have no colon", () => {
  const peers = ["Dr. STONE SCIENCE FUTURE", "Dr. STONE New World", "Dr. STONE"];
  assert.equal(franchiseKey(peers[0]!, peers), "dr. stone");
  assert.equal(franchiseLabel(peers[0]!, peers), "Dr. STONE");
  assert.equal(
    franchiseKey("Dr. STONE SCIENCE FUTURE", ["Dr. STONE SCIENCE FUTURE", "Dr. STONE New World"]),
    "dr. stone",
  );
  assert.equal(franchiseKey("Frieren: Beyond Journey's End", peers.concat("Frieren: Beyond Journey's End")), "frieren: beyond journey's end");
});

test("a lone subtitle is not stripped (Frieren, Kaguya, Re:Zero)", () => {
  assert.equal(collapseSeries([media(1, "Frieren: Beyond Journey's End")])[0].title, "Frieren: Beyond Journey's End");
  assert.equal(collapseSeries([media(1, "Kaguya-sama: Love is War")])[0].title, "Kaguya-sama: Love is War");
  assert.equal(
    collapseSeries([media(1, "Re:Zero − Starting Life in Another World")])[0].title,
    "Re:Zero − Starting Life in Another World",
  );
});

test("anime and manga with the same name stay separate", () => {
  const out = collapseSeries([
    media(1, "Attack on Titan", "anime"),
    media(2, "Attack on Titan", "manga"),
  ]);
  assert.equal(out.length, 2);
});

test("partLabel prefers season numbers, then the subtitle", () => {
  assert.equal(partLabel("Attack on Titan Season 2", "Attack on Titan"), "Season 2");
  assert.equal(partLabel("Attack on Titan Season 3 Part 2", "Attack on Titan"), "Season 3 part 2");
  assert.equal(partLabel("Attack on Titan: The Final Season", "Attack on Titan"), "Final season");
  assert.equal(
    partLabel("Attack on Titan: The Final Season - Final Chapters Part 1", "Attack on Titan"),
    "Final season · Final Chapters Part 1",
  );
  assert.equal(partLabel("JoJo's Bizarre Adventure (2012)", "JoJo's Bizarre Adventure"), "Season 1");
  assert.equal(
    partLabel("JoJo's Bizarre Adventure: Stardust Crusaders", "JoJo's Bizarre Adventure"),
    "Stardust Crusaders",
  );
  assert.equal(
    partLabel("JoJo's Bizarre Adventure: Stone Ocean Part 2", "JoJo's Bizarre Adventure"),
    "Stone Ocean Part 2",
  );
  assert.equal(
    partLabel("Steel Ball Run: JoJo no Kimyou na Bouken", "JoJo's Bizarre Adventure"),
    "Steel Ball Run",
  );
  assert.equal(partLabel("Attack on Titan: No Regrets", "Attack on Titan", true), "No Regrets");
  assert.equal(partLabel("Dr. STONE: Special Episode – RYUSUI", "Dr. STONE", true), "RYUSUI");
});

test("assembleSeries walks prequel/sequel and collects specials", () => {
  const node = (
    id: number,
    title: string,
    edges: SeriesNode["edges"],
  ): [number, SeriesNode] => [id, { id, title, format: "TV", edges }];

  const nodes = new Map<number, SeriesNode>([
    node(1, "Attack on Titan", [
      { kind: "sequel", id: 2, title: "Attack on Titan Season 2", format: "TV" },
      { kind: "side", id: 90, title: "Attack on Titan: No Regrets", format: "OVA" },
    ]),
    node(2, "Attack on Titan Season 2", [
      { kind: "prequel", id: 1, title: "Attack on Titan", format: "TV" },
      { kind: "sequel", id: 3, title: "Attack on Titan Season 3", format: "TV" },
    ]),
    node(3, "Attack on Titan Season 3", [
      { kind: "prequel", id: 2, title: "Attack on Titan Season 2", format: "TV" },
    ]),
  ]);

  const fromMiddle = assembleSeries(2, nodes);
  assert.equal(fromMiddle.rootId, 1);
  assert.equal(fromMiddle.title, "Attack on Titan");
  assert.deepEqual(
    fromMiddle.parts.map((p) => p.label),
    ["Season 1", "Season 2", "Season 3"],
  );
  assert.equal(fromMiddle.specials.length, 1);
  assert.equal(fromMiddle.specials[0].label, "No Regrets");
});

test("assembleSeries crosses a chronological special without counting it as a season", () => {
  const node = (
    id: number,
    title: string,
    format: string,
    edges: SeriesNode["edges"],
  ): [number, SeriesNode] => [id, { id, title, format, edges }];

  const nodes = new Map<number, SeriesNode>([
    node(1, "Dr. STONE", "TV", [
      { kind: "sequel", id: 2, title: "Dr. STONE: STONE WARS", format: "TV" },
    ]),
    node(2, "Dr. STONE: STONE WARS", "TV", [
      { kind: "prequel", id: 1, title: "Dr. STONE", format: "TV" },
      { kind: "sequel", id: 90, title: "Dr. STONE: Ryusui", format: "SPECIAL" },
    ]),
    node(90, "Dr. STONE: Ryusui", "SPECIAL", [
      { kind: "prequel", id: 2, title: "Dr. STONE: STONE WARS", format: "TV" },
      { kind: "sequel", id: 3, title: "Dr. STONE: NEW WORLD", format: "TV" },
    ]),
    node(3, "Dr. STONE: NEW WORLD", "TV", [
      { kind: "prequel", id: 90, title: "Dr. STONE: Ryusui", format: "SPECIAL" },
    ]),
  ]);

  const s = assembleSeries(3, nodes);
  assert.equal(s.rootId, 1);
  assert.deepEqual(s.parts.map((p) => p.id), [1, 2, 3]);
  assert.deepEqual(s.specials.map((p) => p.id), [90]);
});

test("assembleSeries gives a punctuation-only sequel an ordinal season label", () => {
  const nodes = new Map<number, SeriesNode>([
    [1, { id: 1, title: "Kaguya-sama: Love is War", format: "TV", edges: [
      { kind: "sequel", id: 2, title: "Kaguya-sama: Love is War?", format: "TV" },
    ] }],
    [2, { id: 2, title: "Kaguya-sama: Love is War?", format: "TV", edges: [
      { kind: "prequel", id: 1, title: "Kaguya-sama: Love is War", format: "TV" },
    ] }],
  ]);

  assert.deepEqual(assembleSeries(1, nodes).parts.map((p) => p.label), ["Season 1", "Season 2"]);
});

test("assembleSeries keeps a sequel even if that node was not loaded", () => {
  const nodes = new Map<number, SeriesNode>([
    [
      1,
      {
        id: 1,
        title: "Attack on Titan",
        format: "TV",
        edges: [{ kind: "sequel", id: 2, title: "Attack on Titan Season 2", format: "TV" }],
      },
    ],
  ]);
  const s = assembleSeries(1, nodes);
  assert.deepEqual(
    s.parts.map((p) => p.id),
    [1, 2],
  );
  assert.equal(s.parts[1].label, "Season 2");
});

test("episodeWindow sums units of earlier parts, unknown counts as 0", () => {
  const parts = [
    { id: 1, units: 25 },
    { id: 2, units: 12 },
    { id: 3, units: null },
  ];
  assert.deepEqual(episodeWindow(parts, 1), { offset: 0, count: 25 });
  assert.deepEqual(episodeWindow(parts, 2), { offset: 25, count: 12 });
  assert.deepEqual(episodeWindow(parts, 3), { offset: 37, count: null });
  assert.deepEqual(episodeWindow(parts, 999), { offset: 0, count: null });
});

test("progressTree is empty for a single part and names later seasons", () => {
  assert.deepEqual(progressTree([{ id: 1, title: "Only", label: "1", kind: "part" }], 1, []), {});
  const tree = progressTree(
    [
      { id: 1, title: "S1", label: "1", kind: "part" },
      { id: 2, title: "S2", label: "2", kind: "part" },
    ],
    2,
    [
      { ok: true, value: { title: "Season 1", cover: null, units: 12 } },
      { ok: false, reason: "down" },
    ],
  );
  assert.equal(tree.partIndex, 1);
  assert.deepEqual(tree.seriesParts, [
    { mediaId: 1, title: "Season 1", cover: null, units: 12 },
    { mediaId: 2, title: "S2", cover: null, units: 0 },
  ]);
});

const ep = (number: number, season: number | null = null) => ({ number, season });

test("windowEpisodes slices a flattened multi-season list by absolute position", () => {
  // A source that flattened two seasons under one bound id (the real bug):
  // both parts see the exact same 50-episode list.
  const flat = Array.from({ length: 50 }, (_, i) => ep(i + 1));
  const season1 = windowEpisodes(flat, 0, 25, null);
  const season2 = windowEpisodes(flat, 25, 25, null);
  assert.equal(season1.length, 25);
  assert.equal(season2.length, 25);
  assert.deepEqual(
    season1.map((e) => e.number),
    Array.from({ length: 25 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    season2.map((e) => e.number),
    Array.from({ length: 25 }, (_, i) => i + 26),
  );
  // No overlap between the two seasons.
  const overlap = season1.filter((a) => season2.some((b) => b.number === a.number));
  assert.equal(overlap.length, 0);
});

test("windowEpisodes leaves an already-scoped list alone", () => {
  // The addon's own meta for this season only has 12 episodes — offset would
  // point past the end of the list, so it must not be applied.
  const scoped = Array.from({ length: 12 }, (_, i) => ep(i + 1));
  const shown = windowEpisodes(scoped, 50, 12, null);
  assert.equal(shown.length, 12);
});

test("windowEpisodes tolerates a couple of movies/specials mixed into a scoped list", () => {
  const scoped = Array.from({ length: 14 }, (_, i) => ep(i + 1)); // 12 episodes + 2 specials
  const shown = windowEpisodes(scoped, 25, 12, null);
  assert.equal(shown.length, 14, "within slack, list is trusted whole");
});

test("windowEpisodes never returns empty when a slice or season tag is available", () => {
  const flat = Array.from({ length: 50 }, (_, i) => ep(i + 1, 1)); // addon tags everything season 1
  const shown = windowEpisodes(flat, 25, 25, 2); // seasonHint 2 matches nothing
  assert.equal(shown.length, 25, "falls back to the position slice, not to an empty season filter");
});

test("windowEpisodes falls back to the season tag when the count is unknown and offset is out of range", () => {
  const list = [...Array.from({ length: 5 }, (_, i) => ep(i + 1, 1)), ep(6, 2), ep(7, 2)];
  const shown = windowEpisodes(list, 100, null, 2);
  assert.deepEqual(
    shown.map((e) => e.number),
    [6, 7],
  );
});

test("windowEpisodes takes the remainder for an unknown-count tail part", () => {
  const flat = Array.from({ length: 30 }, (_, i) => ep(i + 1));
  const shown = windowEpisodes(flat, 25, null, null); // ongoing final season, count not reported
  assert.deepEqual(
    shown.map((e) => e.number),
    [26, 27, 28, 29, 30],
  );
});

test("windowEpisodes never substitutes a regular episode for a special", () => {
  const parent = [ep(1, 1), ep(2, 1), ep(1, 0)];
  assert.deepEqual(windowEpisodes(parent, 0, 1, 0), [ep(1, 0)]);
  assert.deepEqual(windowEpisodes(parent.slice(0, 2), 0, 1, 0), []);
  assert.deepEqual(windowEpisodes([ep(1, 1)], 0, 1, 0), [ep(1, 1)]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Media } from "./media.ts";
import {
  assembleSeries,
  collapseSeries,
  colonPrefix,
  partLabel,
  seriesTitle,
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

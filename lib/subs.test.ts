import assert from "node:assert/strict";
import test from "node:test";
import {
  cueAt,
  cueLabel,
  cueType,
  dedupeCues,
  fileHref,
  parseCues,
  parseSubChoice,
  parseSubSync,
  pickSubLang,
  remuxEpisodeTime,
  parseCaptionScale,
  captionScaleLabel,
  subSyncKey,
  toCue,
  type SubCue,
} from "./subs.ts";

const cue = (lang: SubCue["lang"], url = `https://cdn.example/${lang}.srt`): SubCue => ({
  id: url,
  lang,
  label: cueLabel(lang),
  url,
  src: fileHref(url),
  type: cueType(url),
});

test("cueType reads the extension, vtt if missing", () => {
  assert.equal(cueType("https://x/a.ass?x=1"), "ass");
  assert.equal(cueType("https://x/a.ssa"), "ssa");
  assert.equal(cueType("https://x/a.srt"), "srt");
  assert.equal(cueType("https://x/a.vtt"), "vtt");
  assert.equal(cueType("https://x/a"), "vtt");
});

test("toCue drops unknown langs and non-http urls", () => {
  assert.equal(toCue({ url: "https://x/a.srt", lang: "eng" })?.lang, "en");
  assert.equal(toCue({ url: "https://x/a.srt", language: "en-US" })?.lang, "en");
  assert.equal(toCue({ url: "https://x/a.srt", lang: "jpn" })?.lang, "ja");
  assert.equal(toCue({ url: "magnet:?xt=urn:btih:abc", lang: "en" }), null);
  assert.equal(toCue({ url: "https://x/a.srt", lang: "xx" }), null);
  assert.equal(
    toCue({ url: "https://x/a.srt", lang: "en", filename: "ep.srt" }, "OpenSubtitles")?.label,
    "English · OpenSubtitles · ep.srt",
  );
});

test("dedupeCues keeps several files per language, same URL once", () => {
  const a = cue("en", "https://a/en.srt");
  const b = cue("en", "https://b/en.srt");
  const out = dedupeCues([a, b, cue("it", "https://a/it.srt"), a]);
  assert.deepEqual(
    out.map((c) => c.url),
    ["https://a/en.srt", "https://b/en.srt", "https://a/it.srt"],
  );
});

test("pickSubLang prefers a saved file, else English on dubbed-from-Japanese", () => {
  const en = cue("en");
  const it = cue("it");
  const cues = [en, it];
  assert.equal(pickSubLang(cues, "ja"), en.id);
  assert.equal(pickSubLang(cues, "en"), "off");
  assert.equal(pickSubLang(cues, "ja", "off"), "off");
  assert.equal(pickSubLang(cues, "ja", it.id), it.id);
  assert.equal(pickSubLang(cues, "ja", "it"), it.id);
  assert.equal(pickSubLang(cues, "ja", "ko"), en.id);
  assert.equal(pickSubLang([], "ja"), "off");
});

test("parseSubSync clamps to ±10 and defaults to 0", () => {
  assert.equal(parseSubSync(null), 0);
  assert.equal(parseSubSync("2.5"), 2.5);
  assert.equal(parseSubSync("0.25"), 0.25);
  assert.equal(parseSubSync("0.3"), 0.25);
  assert.equal(parseSubSync("-11"), -10);
  assert.equal(parseSubSync("99"), 10);
  assert.equal(subSyncKey("kitsu", 10740, "ep1"), "lacrima-sub-sync:kitsu:10740:ep1");
});

test("parseSubChoice accepts off, langs and file ids", () => {
  assert.equal(parseSubChoice("off"), "off");
  assert.equal(parseSubChoice("en"), "en");
  assert.equal(parseSubChoice("OpenSubtitles:123"), "OpenSubtitles:123");
  assert.equal(parseSubChoice(null), undefined);
});

test("a remux mid-episode is timed from the keyframe, not the requested seek", () => {
  assert.equal(remuxEpisodeTime(180, 0, false, 173.2), 173.2);
  assert.equal(remuxEpisodeTime(180, 10, false, 173.2), 183.2);
  assert.equal(remuxEpisodeTime(180, 0, false), 180);
  assert.equal(remuxEpisodeTime(180, 10, false, 0), 190);
  assert.equal(remuxEpisodeTime(180, 10, false, 3773), 190);
  assert.equal(remuxEpisodeTime(0, 12, false, 0), 12);
  assert.equal(remuxEpisodeTime(180, 10, true, 173.2), 10);
});

test("parseCues reads VTT, SRT and ASS on episode time", () => {
  const vtt = parseCues("WEBVTT\n\n00:03:00.000 --> 00:03:02.500\nHello\n");
  assert.deepEqual(vtt, [{ start: 180, end: 182.5, text: "Hello" }]);
  const srt = parseCues("1\n00:03:00,000 --> 00:03:02,500\nHello\n");
  assert.deepEqual(srt, [{ start: 180, end: 182.5, text: "Hello" }]);
  const ass = parseCues("Dialogue: 0,0:03:00.00,0:03:02.50,Default,,0,0,0,,Hello");
  assert.deepEqual(ass, [{ start: 180, end: 182.5, text: "Hello" }]);
  assert.equal(cueAt(vtt, 179.9), null);
  assert.equal(cueAt(vtt, 180)?.text, "Hello");
  assert.equal(cueAt(vtt, 182.5), null);
});

test("caption scale only accepts the three sizes", () => {
  assert.equal(parseCaptionScale(null), 1);
  assert.equal(parseCaptionScale("1.2"), 1.2);
  assert.equal(parseCaptionScale("1.45"), 1.45);
  assert.equal(parseCaptionScale("2"), 1);
  assert.equal(captionScaleLabel(1.45), "Large");
  assert.equal(captionScaleLabel(1), "Small");
});

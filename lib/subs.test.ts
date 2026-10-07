import assert from "node:assert/strict";
import test from "node:test";
import {
  appliedShift,
  cueAt,
  cueLabel,
  cueType,
  castVtt,
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

test("a resumed remux times subtitles from its accurate requested start", () => {
  assert.equal(remuxEpisodeTime(180, 0, false), 180);
  assert.equal(remuxEpisodeTime(180, 10, false), 190);
  assert.equal(remuxEpisodeTime(0, 12, false), 12);
  assert.equal(remuxEpisodeTime(180, 10, true), 10);
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

test("cast subtitles convert to WebVTT on the remux clock", () => {
  const srt = "1\n00:02:59,500 --> 00:03:01,250\nHello\n\n2\n00:03:02,000 --> 00:03:03,000\nAgain";
  assert.equal(castVtt(srt, 180), "WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nHello\n\n00:00:02.000 --> 00:00:03.000\nAgain\n");
});

test("caption scale only accepts the three sizes", () => {
  assert.equal(parseCaptionScale(null), 1);
  assert.equal(parseCaptionScale("1.2"), 1.2);
  assert.equal(parseCaptionScale("1.45"), 1.45);
  assert.equal(parseCaptionScale("2"), 1);
  assert.equal(captionScaleLabel(1.45), "Large");
  assert.equal(captionScaleLabel(1), "Small");
});

test("the file the audio agrees with beats the one that sorts first", () => {
  const files = [cue("en", "https://x/a.srt"), cue("en", "https://x/b.srt"), cue("en", "https://x/c.srt")];
  const fits = {
    [files[0].id]: { id: files[0].id, shift: 0, r: 0.1, matched: false },
    [files[1].id]: { id: files[1].id, shift: 4.95, r: 0.31, matched: true },
    [files[2].id]: { id: files[2].id, shift: -0.1, r: 0.25, matched: true },
  };
  assert.equal(pickSubLang(files, "ja", undefined, fits), files[1].id);
  // A saved language is not a saved file; a saved file is.
  assert.equal(pickSubLang(files, "ja", "en", fits), files[1].id);
  assert.equal(pickSubLang(files, "ja", files[2].id, fits), files[2].id);
  // Nothing measured, or nothing matched: the old order.
  assert.equal(pickSubLang(files, "ja"), files[0].id);
  assert.equal(pickSubLang(files, "ja", undefined, { [files[0].id]: fits[files[0].id] }), files[0].id);
});

test("an offset inside the method's error is left alone, and an unmatched file is never moved", () => {
  assert.equal(appliedShift({ id: "a", shift: 21.3, r: 0.36, matched: true }), 21.3);
  assert.equal(appliedShift({ id: "a", shift: 0.35, r: 0.36, matched: true }), 0);
  assert.equal(appliedShift({ id: "a", shift: 21.3, r: 0.1, matched: false }), 0);
  assert.equal(appliedShift(undefined), 0);
});

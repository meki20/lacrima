import assert from "node:assert/strict";
import test from "node:test";
import {
  bucketLangs,
  claimedLangs,
  parseLang,
  parseLangToken,
  pickAudioTrack,
  speaksLang,
  trackLangs,
} from "./audio.ts";

test("parseLang maps the old sub/dub keys", () => {
  assert.equal(parseLang("sub"), "ja");
  assert.equal(parseLang("dub"), "en");
  assert.equal(parseLang("it"), "it");
  assert.equal(parseLang("nope"), undefined);
});

test("parseLangToken reads ISO codes and names", () => {
  assert.equal(parseLangToken("eng"), "en");
  assert.equal(parseLangToken("en-US"), "en");
  assert.equal(parseLangToken("Japanese"), "ja");
  assert.equal(parseLangToken("jpn"), "ja");
  assert.equal(parseLangToken("ita"), "it");
  assert.equal(parseLangToken("xx"), undefined);
});

test("sub labels are Japanese audio, even when the subtitle language is named", () => {
  assert.deepEqual(claimedLangs("AnimeStream | Attack on Titan 1080p 🔊 SUB"), ["ja"]);
  assert.deepEqual(claimedLangs("AoT S01E01 1080p English Sub"), ["ja"]);
  assert.deepEqual(claimedLangs("AoT S01E01 SUB ITA 1080p"), ["ja"]);
  assert.deepEqual(claimedLangs("Shingeki no Kyojin S01E01 iTA SUB"), ["ja"]);
});

test("dub labels are the named spoken language", () => {
  assert.deepEqual(claimedLangs("AoT S01E01 1080p English Dub"), ["en"]);
  assert.deepEqual(claimedLangs("AoT S01E01 ITA DUB 1080p"), ["it"]);
  assert.deepEqual(claimedLangs("AoT S01E01 Dubbed"), ["en"]);
});

test("a language with no sub/dub tag is spoken audio", () => {
  assert.deepEqual(claimedLangs("AoT S01E01 ITA 1080p"), ["it"]);
  assert.deepEqual(claimedLangs("AoT S01E01 GERMAN DL 1080p"), ["de"]);
  assert.deepEqual(claimedLangs("AoT S01E01 Hindi 1080p"), ["hi"]);
});

test("DualDub/Subs is dual audio, not Japanese-only", () => {
  assert.deepEqual(
    claimedLangs("One Punch Man DualDub/Subs MKV").sort(),
    ["en", "ja"],
  );
  assert.deepEqual(
    claimedLangs("One Punch Man Dual Audio 1080p / 🇬🇧 / 🇮🇹 / 🇵🇹").sort(),
    ["en", "ja"],
  );
});

test("an unlabelled dump is Japanese audio", () => {
  assert.deepEqual(claimedLangs("AoT S01E01 1080p BluRay"), ["ja"]);
});

test("subtitle flags are not spoken audio", () => {
  const jp = "🌐 1080p\n🔊 opus · 2.0 · 🇯🇵\n💬 🇺🇸\n🏷️ MTBB";
  const en = "🌐 1080p\n🔊 aac · 2.0 · 🇬🇧\n💬 🇺🇸🇮🇩\n🏷️ i_c";
  const dual = "🌐 1080p\n🔊 dual audio · 2.0 · 🇬🇧🇯🇵\n💬 🇺🇸";
  assert.deepEqual(claimedLangs(jp), ["ja"]);
  assert.deepEqual(claimedLangs(en), ["en"]);
  assert.deepEqual(claimedLangs(dual).sort(), ["en", "ja"]);
});

test("pickAudioTrack failovers when the file only speaks the other language", () => {
  assert.equal(pickAudioTrack([{ language: "eng", label: "English" }], "ja"), -1);
  assert.equal(pickAudioTrack([{ language: "jpn" }, { language: "eng" }], "ja"), 0);
  assert.equal(pickAudioTrack([], "ja"), null);
  assert.equal(pickAudioTrack([{ language: "und" }], "ja"), null);
});

test("a multi-dub is offered in every language it carries", () => {
  /* The relay selects the audio track with ffmpeg, so a file naming Hindi,
     English and Japanese really does serve all three. It used to collapse to
     Hindi because the browser plays the first track and cannot be told otherwise
     — a workaround for a missing capability, not a fact about the file. */
  const text = "OPM S01E03 1080p [Hindi DDP 2.0 + English-Japanese AAC]";
  assert.deepEqual([...bucketLangs(text)].sort(), ["en", "hi", "ja"]);
  assert.equal(speaksLang(text, "hi"), true);
  assert.equal(speaksLang(text, "ja"), true);
  assert.equal(speaksLang(text, "en"), true);
});

test("an Italian+Japanese dual carries both, and both are reachable", () => {
  const text = "🌐 1080p\n🔊 aac · 2.0 · 🇮🇹🇯🇵\n💬 🇺🇸🇮🇹";
  assert.deepEqual([...bucketLangs(text)].sort(), ["it", "ja"]);
  assert.equal(speaksLang(text, "ja"), true);
  assert.equal(speaksLang(text, "it"), true);
  // Subtitle flags on the 💬 line are still not spoken audio.
  assert.equal(speaksLang(text, "en"), false);
});

test("unlabeled dual audio picks track 0 for Japanese and 1 for English", () => {
  const hint = "OPM S01E03 1080p Dual Audio x264";
  const tracks = [{ language: "und" }, { language: "und" }];
  assert.equal(pickAudioTrack(tracks, "ja", hint), 0);
  assert.equal(pickAudioTrack(tracks, "en", hint), 1);
});

test("an unlabelled MULTi is offered as the usual pair, not guessed at", () => {
  const text =
    "🐧 PenguPlay 🧊 1080p • 4KHDHub · R2 📡 One Punch Man S01E03 | 🎞️ 1080p • MKV • WEB-DL • x264 • AAC 5.1 | One-Punch.Man.S01E03.CR.WEB-DL.MULTi.AAC2.0.H.264-4kHdHub.Com.mkv";
  /* It names no language at all, so there is nothing to read. ffprobe finds the
     real tracks at play time; guessing Hindi here only hid the file from everyone
     who wanted the Japanese it also contains. */
  assert.deepEqual(bucketLangs(text), ["ja", "en"]);
});

test("explicit Audio: Japanese stays in the Japanese menu", () => {
  const text = "🐧 PenguPlay 🧊 1080p • Miruro | 🎧 Audio: Japanese 1080pMP4";
  assert.deepEqual(bucketLangs(text), ["ja"]);
  assert.equal(speaksLang(text, "ja"), true);
});

test("the live single-line format separates audio from subtitles", () => {
  /* Real TorrentClaw output: 🔊 and 💬 on one line, not two. Reading to the end
     of the line made every English-subbed Japanese release English audio too. */
  const subbed = "🌐 1080p 🔊 aac · 2.0 · 🇯🇵 💬 🇺🇸 💾 1.5 GB 🏷️ SubsPlease";
  assert.deepEqual(bucketLangs(subbed), ["ja"]);
  assert.deepEqual(trackLangs(subbed), ["ja"]);

  const dual = "🌐 1080p 🔊 dual audio · 2.0 · 🇬🇧🇯🇵 💬 🇺🇸 💾 16.3 GB";
  assert.deepEqual(bucketLangs(dual), ["ja", "en"]);

  const engDub = "🌐 1080p 🔊 aac · 2.0 · 🇬🇧 💬 🇺🇸🇮🇩 💾 1.2 GB";
  assert.deepEqual(bucketLangs(engDub), ["en"]);
});

test("a Hindi flag is read as Hindi", () => {
  /* 4KHDHub releases label themselves 🇮🇳🇬🇧🇯🇵 and default to the Hindi track.
     With 🇮🇳 unreadable this looked like a plain ja+en dual and was offered as
     both Japanese and English — the audio was Hindi either way. */
  const multi =
    "[HS+] Sootio 1080p One-Punch.Man.S01E02.1080p.CR.WEB-DL.MULTi.AAC2.0.H.264-4kHdHub.Com.mkv H264 🇮🇳🇬🇧🇯🇵";
  // ffprobe confirms this exact file holds hin, eng and jpn — all three are real.
  assert.deepEqual([...bucketLangs(multi)].sort(), ["en", "hi", "ja"]);

  assert.deepEqual(bucketLangs("One Punch Man - HD 720p 🇮🇳 💾 2.9GB | CineDoze"), ["hi"]);
  assert.deepEqual(
    [...bucketLangs("OPM S01E02 1080p [Hindi DDP 2.0 + English-Japanese FLAC]")].sort(),
    ["en", "hi", "ja"],
  );
  // A genuine Japanese release is untouched.
  assert.deepEqual(bucketLangs("[HS+] Sootio auto 🔗Gdrive + Mirrors 🇯🇵 AnimeFlix"), ["ja"]);
});

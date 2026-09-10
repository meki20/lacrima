import assert from "node:assert/strict";
import { test } from "node:test";
import { playFileArgs, remuxArgs } from "./remux.ts";

const at = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
const maps = (args: string[]) =>
  args.reduce<string[]>((out, a, i) => (a === "-map" ? [...out, args[i + 1]] : out), []);

test("the requested language is required so a wrong track cannot silently play", () => {
  const args = remuxArgs("http://relay/x", { lang: "ja" });
  assert.deepEqual(maps(args), ["0:v:0", "0:a:m:language:jpn"]);

  assert.deepEqual(maps(remuxArgs("http://relay/x", { lang: "en" })), [
    "0:v:0",
    "0:a:m:language:eng",
  ]);
  assert.deepEqual(maps(remuxArgs("http://relay/x", { lang: "hi" })), [
    "0:v:0",
    "0:a:m:language:hin",
  ]);
  // No language asked for: take whatever the file leads with.
  assert.deepEqual(maps(remuxArgs("http://relay/x", {})), ["0:v:0", "0:a:0?"]);
  assert.deepEqual(maps(remuxArgs("http://relay/x", { lang: "ja", audioIndex: 3 })), [
    "0:v:0",
    "0:3",
  ]);
});

test("video is always copied and audio is copied when it is already AAC", () => {
  const args = remuxArgs("http://relay/x", { lang: "ja" });
  assert.equal(at(args, "-c:v"), "copy", "video must never be re-encoded");
  assert.equal(at(args, "-c:a"), "aac");
  assert.equal(args.includes("-af"), false);
  assert.equal(args.includes("-copyts"), true);
  assert.equal(at(args, "-avoid_negative_ts"), "disabled");
  assert.equal(args.includes("-bsf:v"), false);
  assert.equal(at(args, "-disposition:a:0"), "default");
  assert.equal(at(args, "-f"), "mp4");
  assert.match(at(args, "-movflags"), /frag_keyframe/);
  assert.match(at(args, "-movflags"), /empty_moov/);
  assert.equal(args.at(-1), "pipe:1");

  const copy = remuxArgs("C:/cache/video", { lang: "ja", copyAudio: true });
  assert.equal(at(copy, "-c:a"), "copy");
  assert.equal(copy.includes("-reconnect"), false);
});

test("a seek is applied before the input, so it is a seek and not a wait", () => {
  const args = remuxArgs("http://relay/x", { lang: "ja", seek: 578 });
  const ss = args.indexOf("-ss");
  const i = args.indexOf("-i");
  assert.ok(ss > -1 && ss < i, "-ss must precede -i for keyframe seeking");
  assert.equal(at(args, "-ss"), "578");

  // No seek at the start of an episode: the flag is absent, not "0".
  assert.equal(remuxArgs("http://relay/x", { lang: "ja" }).includes("-ss"), false);
  assert.equal(remuxArgs("http://relay/x", { lang: "ja", seek: 0 }).includes("-ss"), false);
});

test("a cached title is remuxed to a seekable file, not a live pipe", () => {
  const args = playFileArgs("C:/cache/video", "C:/cache/play-ja.mp4", {
    lang: "ja",
    copyAudio: true,
  });
  assert.equal(at(args, "-c:v"), "copy");
  assert.equal(at(args, "-c:a"), "copy");
  assert.equal(at(args, "-movflags"), "+faststart");
  assert.equal(args.includes("pipe:1"), false);
  assert.equal(args.at(-1), "C:/cache/play-ja.mp4");
});

test("a referer is passed through, because sources hotlink-block", () => {
  const args = remuxArgs("http://relay/x", { lang: "ja", referer: "https://src.example/" });
  assert.match(at(args, "-headers"), /^Referer: https:\/\/src\.example\/\r\n$/);
  assert.equal(remuxArgs("http://relay/x", { lang: "ja" }).includes("-headers"), false);
  assert.equal(
    remuxArgs("C:/cache/video", { lang: "ja", referer: "https://src.example/" }).includes("-headers"),
    false,
  );
});

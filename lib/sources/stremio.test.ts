import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claimedSlot,
  clearCooldowns,
  coolDown,
  coolingOff,
  episodeMatches,
  extraStreamIds,
  idsFor,
  idsForSubs,
  releaseTitle,
  wrongWork,
  isBareMovieId,
  namedSeason,
  namesSlot,
  playableListing,
  raceFirstPlayable,
  servesStreams,
  servesSubtitles,
  streamHref,
  streamTypes,
  streamTypesFor,
  wantedSlot,
} from "./stremio.ts";

test("HTTP streams become a same-origin proxy URL", () => {
  assert.equal(
    streamHref({ url: "https://cdn.example/ep.mp4" }),
    "/api/stream?url=https%3A%2F%2Fcdn.example%2Fep.mp4",
  );
  assert.equal(
    streamHref({
      url: "https://cdn.example/ep.mp4",
      behaviorHints: { proxyHeaders: { request: { Referer: "https://src.example/" } } },
    }),
    "/api/stream?url=https%3A%2F%2Fcdn.example%2Fep.mp4&referer=https%3A%2F%2Fsrc.example%2F",
  );
});

test("infoHash streams become a torrent URL carrying the episode", () => {
  const ih = "dd9bca443c9ab0de9685a1f33c4668d6dabef61c";
  assert.equal(streamHref({ infoHash: ih, fileIdx: 0 }), `/api/stream?ih=${ih}&i=0`);
  assert.equal(streamHref({ infoHash: ih }), `/api/stream?ih=${ih}`);
  assert.equal(streamHref({ infoHash: "nope" }), null);
  assert.equal(
    streamHref({ infoHash: ih, fileIdx: 3 }, { season: 1, episode: 1 }),
    `/api/stream?ih=${ih}&i=3&s=1&e=1`,
  );
  assert.equal(
    streamHref({ url: `magnet:?xt=urn:btih:${ih}&dn=foo` }, { season: 1, episode: 1 }),
    `/api/stream?ih=${ih}&s=1&e=1`,
  );
});

test("HTTP wins over a sibling infoHash on the same object", () => {
  const href = streamHref({
    url: "https://debrid.example/file.mp4",
    infoHash: "dd9bca443c9ab0de9685a1f33c4668d6dabef61c",
    fileIdx: 0,
  });
  assert.ok(href?.startsWith("/api/stream?url="));
});

test("a sign-in stub is not a stream", () => {
  assert.equal(
    streamHref({ url: "https://pengu.uk/signin.mp4", title: "You must sign in" }),
    null,
  );
});

test("anime-namespaced ids are asked before the IMDB catalog id", () => {
  /* Order is the whole fix: collectStreams stops at the first id that answers,
     so whichever id leads is the question the addon actually gets asked. */
  assert.deepEqual(extraStreamIds("tt2560140:1:1", { via: "kitsu", mediaId: 7442 }), [
    "kitsu:7442:1",
    "tt2560140:1:1",
  ]);
  assert.deepEqual(extraStreamIds("tt2560140:1:1", { via: "anilist", mediaId: 16498 }), [
    "anilist:16498:1",
    "tt2560140:1:1",
  ]);
  // Jikan ids are MAL ids.
  assert.deepEqual(extraStreamIds("tt2560140:1:1", { via: "jikan", mediaId: 16498 }), [
    "mal:16498:1",
    "tt2560140:1:1",
  ]);
  assert.deepEqual(extraStreamIds("kitsu:7442:1", { via: "kitsu", mediaId: 7442 }), ["kitsu:7442:1"]);
  assert.deepEqual(extraStreamIds("tt2560140:3:1", { via: "kitsu", mediaId: 7442 }), ["tt2560140:3:1"]);
});

test("a full mapping asks in every namespace, widest reach first", () => {
  assert.deepEqual(
    extraStreamIds("tt22248376:1:1", {
      via: "kitsu",
      mediaId: 46474,
      ids: { kitsu: 46474, anilist: 154587, mal: 52991 },
    }),
    ["kitsu:46474:1", "anilist:154587:1", "mal:52991:1", "tt22248376:1:1"],
  );
  // The id we hold beats whatever a mapping claims for that same namespace.
  assert.deepEqual(
    extraStreamIds("tt0388629:1:1", { via: "kitsu", mediaId: 12, ids: { mal: 21 } }),
    ["kitsu:12:1", "mal:21:1", "tt0388629:1:1"],
  );
});

test("a bare movie id never grows a synthetic episode", () => {
  // `kitsu:176:tt0748454` is not a question any addon can answer.
  assert.deepEqual(extraStreamIds("tt0748454", { via: "kitsu", mediaId: 176 }), ["tt0748454"]);
});

test("season 0 IMDB ids also try season 1", () => {
  assert.deepEqual(extraStreamIds("tt2560140:0:1", { via: "kitsu", mediaId: 7442 }), [
    "kitsu:7442:1",
    "tt2560140:0:1",
    "tt2560140:1:1",
  ]);
});

test("an addon that says it is broken stops being asked; a 404 does not", () => {
  clearCooldowns();
  // Measured on a live install: Meteor 401s and TorrentsDB 429s every request,
  // once per id × type, per episode, forever.
  coolDown("Meteor", 401, "refused us");
  coolDown("TorrentsDB", 429, "rate-limited us");
  assert.equal(coolingOff("Meteor"), "refused us");
  assert.equal(coolingOff("TorrentsDB"), "rate-limited us");

  /* A 404 is "I do not have this id" — a fact about the title, not the addon.
     Cooling down on it would blind us to every other title it does have. */
  coolDown("AniScraper", 404, "not found");
  assert.equal(coolingOff("AniScraper"), null);
  assert.equal(coolingOff("TorrentClaw"), null);

  clearCooldowns();
  assert.equal(coolingOff("Meteor"), null);
});

test("an advert is not an answer", () => {
  // Both of these are real: PenguPlay and AIOStreams return them for every id.
  assert.equal(
    playableListing({ name: "✨", title: "support the project! | pengu.uk/donate" }),
    false,
  );
  assert.equal(playableListing({ name: "🚫 Removal Reasons", description: "disabled" }), false);
  assert.equal(playableListing({ url: "https://cdn.example/ep.mp4" }), true);
  assert.equal(playableListing({ infoHash: "d".repeat(40) }), true);
  assert.equal(playableListing({ sources: [`magnet:?xt=urn:btih:${"e".repeat(40)}`] }), true);
});

test("the wanted slot comes from the video id", () => {
  assert.deepEqual(wantedSlot("tt2560140:3:7"), { season: 3, episode: 7 });
  assert.deepEqual(wantedSlot("tt2560140:0:1"), { season: 1, episode: 1 });
  assert.deepEqual(wantedSlot("kitsu:7442:12"), { season: 1, episode: 12 });
  assert.deepEqual(wantedSlot("anilist:269:1"), { season: 1, episode: 1 });
  assert.deepEqual(wantedSlot("anilist:269-1"), { season: 1, episode: 1 });
  assert.deepEqual(wantedSlot("mal:269:1"), { season: 1, episode: 1 });
  assert.equal(wantedSlot("ap:some-slug"), undefined);
});

test("hyphenated anime episodes still reach mapped stream addons", () => {
  assert.deepEqual(
    extraStreamIds("anilist:269-2", { ids: { anilist: 269, kitsu: 244, mal: 269 } }),
    ["kitsu:244:2", "mal:269:2", "anilist:269-2"],
  );
});

test("stream titles are read for the episode they actually contain", () => {
  assert.deepEqual(claimedSlot("Attack on Titan S01E01 1080p"), { season: 1, episode: 1 });
  assert.deepEqual(claimedSlot("Shingeki no Kyojin 3x07 WEB"), { season: 3, episode: 7 });
  assert.deepEqual(claimedSlot("Attack on Titan - 38 [1080p]"), { season: null, episode: 38 });
  assert.deepEqual(claimedSlot("Attack on Titan Complete Series 1080p"), {
    season: null,
    episode: null,
  });
  assert.deepEqual(claimedSlot("AoT S01E05.1080p"), { season: 1, episode: 5 });
  assert.deepEqual(claimedSlot("AoT S01E05.5 No Regrets"), { season: null, episode: null });
});

test("a wrong episode is rejected, not offered as an alternative", () => {
  const want = { season: 1, episode: 1 };
  assert.equal(episodeMatches({ title: "Attack.on.Titan.S03E38.GERMAN.1080p" }, want), false);
  assert.equal(episodeMatches({ title: "Attack on Titan S01E01 1080p ENG" }, want), true);
});

test("a complete+OVA pack is not a numbered episode unless it names that slot", () => {
  const want = { season: 1, episode: 5 };
  assert.equal(
    episodeMatches(
      { title: "[Anime Time] Attack On Titan (Complete Series) (S01-S04+OVA) [Dual Audio]" },
      want,
    ),
    false,
  );
  assert.equal(episodeMatches({ title: "Attack.on.Titan.S01E05.1080p.BluRay Dual Audio" }, want), true);
});

test("a pack's side files are not episode 1, whatever the addon captions them", () => {
  const want = { season: 1, episode: 1 };
  /* All four are real AniScraper answers for kitsu:10740:1 (One-Punch Man S1),
     and every one of them carries the addon's own "Season 1 Episode 1" caption. */
  const reject = [
    "[Judas] One Punch Man - OAD 01.mkv 📜 Season 1 Episode 1",
    "[Judas] One Punch Man - S01OVA01.mkv 📜 Season 1 Episode 1",
    "[Judas] One Punch Man - S02E01.mkv 📜 Season 2 Episode 1",
    "One-Punch Man - S00E01 (480p BluRay x265).mkv 📜 Season 1 Episode 1",
  ];
  for (const title of reject) assert.equal(episodeMatches({ title }, want), false, title);

  // The real episode, from the same pack, still passes.
  assert.equal(
    episodeMatches({ title: "[Judas] One-Punch Man - S01E01.mkv 📜 Season 1 Episode 1" }, want),
    true,
  );
  // A special that names the exact slot asked for is still playable.
  assert.equal(
    episodeMatches({ title: "One Piece OVA S01E01 1080p" }, want),
    true,
  );
});

test("naming the slot outright beats a bare episode number", () => {
  const want = { season: 1, episode: 1 };
  // Season three, and it says only "- 01".
  assert.equal(namesSlot("[Erai-raws] One Punch Man (2025) - 01 (REPACK) [1080p]", want), false);
  assert.equal(namesSlot("[Judas] One-Punch Man - S01E01.mkv", want), true);
  assert.equal(namesSlot("One-Punch Man 1x01 1080p", want), true);
  assert.equal(namesSlot("One-Punch Man S01E02", want), false);
  assert.equal(namesSlot("One-Punch Man S02E01", want), false);
  // Not 1.5 or 01b — those are OVAs, not episode 1.
  assert.equal(namesSlot("One-Punch Man S01E01.5", want), false);
  assert.equal(namesSlot("anything", undefined), false);
});

test("a stream URL for a different season is not the episode we asked for", () => {
  const want = { season: 1, episode: 1 };
  assert.equal(
    episodeMatches({ title: "OPM S01E01 1080p AAC", url: "https://cdn.example/tv.10687.S4E1.original.mp4" }, want),
    false,
  );
  assert.equal(
    episodeMatches({ title: "OPM S01E01 1080p AAC", url: "https://cdn.example/tv.10687.S1E1.original.mp4" }, want),
    true,
  );
});

test("catalog-only addons are never asked for a stream", () => {
  const cinemeta = { resources: ["catalog", "meta", "addon_catalog"], idPrefixes: ["tt"] };
  const torrentsdb = { resources: ["stream"], types: ["movie", "series", "anime", "other"] };
  assert.equal(servesStreams(cinemeta), false);
  assert.equal(servesStreams(torrentsdb), true);
});

test("subtitle addons are recognised even without streams", () => {
  assert.equal(servesSubtitles({ resources: ["subtitles"] }), true);
  assert.equal(servesSubtitles({ resources: ["stream"] }), false);
  const os = {
    resources: [{ name: "subtitles", types: ["series", "movie"], idPrefixes: ["tt"] }],
  };
  assert.equal(servesSubtitles(os), true);
  assert.deepEqual(idsForSubs(os, ["kitsu:7442:1", "tt2560140:1:1"]), ["tt2560140:1:1"]);
});

test("a spin-off is not an alternative encode of the episode", () => {
  // Every one of these came back from TorrentClaw for One Piece's own id.
  const reject = [
    "One Piece Fan Letter S01E01 VOSTFR 1080p WEB x264 AAC -Tsundere-Raws (CR).mkv",
    "One Piece Log Fish-Man Island Saga S01E01 VOSTFR 1080p WEB x264 AAC.mkv",
  ];
  for (const f of reject) assert.equal(wrongWork(f, "One Piece"), true, f);

  const keep = [
    "One Piece Season 01 (East Blue) EP 001-062 DUB 1080P",
    "One Piece Season 1,2,3 {EnG SubbeD} [Episode 1-92] L@mBerT",
    "One Piece - 1ª Temporada [1080p]  (HDTV-1080p)",
    "One Piece [4k 2160p][Cap.101](wolfmax4k.com)",
    "ONE PIECE 2023 S01E01 Romance Dawn REPACK 1080p NF WEB DL",
    "[SubsPlease] One Piece - 1122 (1080p) [ABCD1234].mkv",
  ];
  for (const f of keep) assert.equal(wrongWork(f, "One Piece"), false, f);

  // Unjudgeable, so allowed: an alternate romanisation shares no words with ours.
  assert.equal(wrongWork("Shingeki no Kyojin S01E01 1080p.mkv", "Attack on Titan"), false);
  // …but the same show plus a side story is still rejected.
  assert.equal(
    wrongWork("Attack on Titan Junior High S01E01 1080p.mkv", "Attack on Titan"),
    true,
  );

  assert.equal(releaseTitle("ONE PIECE 2023 S01E01 Romance Dawn 1080p NF"), "ONE PIECE 2023");
  assert.equal(releaseTitle("One Piece Fan Letter S01E01 VOSTFR.mkv"), "One Piece Fan Letter");
});

test("a filename that is a path is judged on its last segment", () => {
  /* TorrentClaw's best-seeded Attack on Titan files are stored under a folder
     naming the work, so judging the whole path saw one title carrying two names
     and threw away a 260-seeder release as a different show. */
  assert.equal(
    releaseTitle("Attack on Titan/Shingeki no Kyojin - S01E01 [1080p].mkv"),
    "Shingeki no Kyojin -",
  );
  assert.equal(
    wrongWork("Attack on Titan/Shingeki no Kyojin - S01E01 [1080p].mkv", "Attack on Titan"),
    false,
  );
  // The rule still holds on a real spin-off inside a folder.
  assert.equal(
    wrongWork("Attack on Titan/Attack on Titan Junior High S01E01.mkv", "Attack on Titan"),
    true,
  );
});

test("a bare season marker ends the title", () => {
  assert.equal(releaseTitle("Death.Note.S01.720p.BluRay.x264-TSR"), "Death.Note.");
  assert.equal(releaseTitle("Death Note S1 1080p"), "Death Note");
  // A season-shaped tail must not eat an episode-shaped one.
  assert.equal(releaseTitle("ONE PIECE 2023 S01E01 Romance Dawn 1080p"), "ONE PIECE 2023");
});

test("an addon is only asked for ids it declares", () => {
  const ids = ["tt2560140:1:1", "kitsu:7442:1"];
  assert.deepEqual(idsFor({ idPrefixes: ["ap"] }, ids), []);
  assert.deepEqual(idsFor({ idPrefixes: ["tt", "kitsu", "mal"] }, ids), ids);
  assert.deepEqual(idsFor({}, ids), ids);

  /* Peerflix's real manifest: nothing at the top level, `tt` only on the stream
     resource. Reading just the top level sent it the kitsu id we synthesise. */
  const peerflix = {
    types: ["movie", "series"],
    resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  };
  assert.deepEqual(idsFor(peerflix, ids), ["tt2560140:1:1"]);
  assert.deepEqual(streamTypes(peerflix), ["series", "movie"]);
  // A bare `resources: ["stream"]` string form still falls back to the top level.
  assert.deepEqual(idsFor({ resources: ["stream"], idPrefixes: ["kitsu"] }, ids), [
    "kitsu:7442:1",
  ]);
});

test("stream paths are narrowed to declared types, series first", () => {
  assert.deepEqual(streamTypes({ types: ["anime", "series", "movie"] }), ["series", "anime", "movie"]);
  assert.deepEqual(streamTypes({ types: ["series", "movie"] }), ["series", "movie"]);
  assert.deepEqual(streamTypes({}), ["series", "anime", "movie"]);
});

test("bare imdb ids are treated as movies", () => {
  assert.equal(isBareMovieId("tt0245429"), true);
  assert.equal(isBareMovieId("tt2560140:1:1"), false);
  assert.deepEqual(streamTypesFor({ types: ["anime", "series", "movie"] }, "tt0245429"), [
    "movie",
    "series",
    "anime",
  ]);
});

const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });

test("a fast empty addon does not starve a slower playable one", async () => {
  const want = { season: 1, episode: 1 };
  const bags = await raceFirstPlayable(
    [
      { name: "empty", run: async () => ({ name: "empty", streams: [] }) },
      {
        name: "slow",
        run: async () => {
          await wait(40);
          return { name: "slow", streams: [{ title: "S01E01 ENG", infoHash: HASH_A }] };
        },
      },
    ],
    want,
    1_000,
  );
  assert.ok(bags.some((b) => b.streams.some((s) => s.infoHash === HASH_A)));
});

test("a playable answer still waits for a slower sibling", async () => {
  const want = { season: 1, episode: 1 };
  let aborted = false;
  const bags = await raceFirstPlayable(
    [
      {
        name: "fast",
        run: async () => ({
          name: "fast",
          streams: [{ title: "S01E01 ENG AAC", url: "https://cdn.example/ep.mp4" }],
        }),
      },
      {
        name: "slow",
        run: async (signal) => {
          try {
            await wait(40, signal);
          } catch {
            aborted = true;
          }
          return { name: "slow", streams: [{ title: "S01E01 ENG AAC", infoHash: HASH_B }] };
        },
      },
    ],
    want,
    1_000,
  );
  assert.equal(aborted, false);
  assert.ok(bags.some((b) => b.streams.some((s) => s.url?.includes("cdn.example"))));
  assert.ok(bags.some((b) => b.streams.some((s) => s.infoHash === HASH_B)));
});

test("a torrent answer waits for a slower HTTP addon", async () => {
  const want = { season: 1, episode: 1 };
  let aborted = false;
  const bags = await raceFirstPlayable(
    [
      {
        name: "torrent",
        run: async () => ({ name: "torrent", streams: [{ title: "S01E01 ENG", infoHash: HASH_A }] }),
      },
      {
        name: "http",
        run: async (signal) => {
          try {
            await wait(40, signal);
          } catch {
            aborted = true;
          }
          return {
            name: "http",
            streams: [{ title: "S01E01 ENG", url: "https://cdn.example/ep.mp4" }],
          };
        },
      },
    ],
    want,
    1_000,
  );
  assert.equal(aborted, false);
  assert.ok(bags.some((b) => b.streams.some((s) => s.url?.includes("cdn.example"))));
});

test("a fast wrong-episode reply does not count as a win", async () => {
  const want = { season: 1, episode: 1 };
  const bags = await raceFirstPlayable(
    [
      {
        name: "wrong",
        run: async () => ({
          name: "wrong",
          streams: [{ title: "S03E38 GERMAN", infoHash: HASH_A }],
        }),
      },
      {
        name: "right",
        run: async () => {
          await wait(40);
          return { name: "right", streams: [{ title: "S01E01 ENG", infoHash: HASH_B }] };
        },
      },
    ],
    want,
    1_000,
  );
  assert.ok(bags.some((b) => b.streams.some((s) => s.infoHash === HASH_B)));
});

test("an unlabelled dump does not win an English language race", async () => {
  const want = { season: 1, episode: 1 };
  const bags = await raceFirstPlayable(
    [
      {
        name: "fast",
        run: async () => ({ name: "fast", streams: [{ title: "AoT S01E01 1080p", infoHash: HASH_A }] }),
      },
      {
        name: "slow",
        run: async () => {
          await wait(40);
          return { name: "slow", streams: [{ title: "AoT S01E01 English Dub", infoHash: HASH_B }] };
        },
      },
    ],
    want,
    1_000,
  );
  assert.ok(bags.some((b) => b.streams.some((s) => s.infoHash === HASH_B)));
});

test("a season spelled out beats the SxxExx beside it", () => {
  const want = { season: 1, episode: 2 };
  /* Real 4KHDHub listing for One-Punch Man S1E2: these number every cour from
     S01, so the SxxExx says nothing about which season it belongs to. */
  assert.equal(
    episodeMatches({ title: "One-Punch.Man.Season.3.S01E02.Episode.25.-.Strategy.Meeting" }, want),
    false,
  );
  assert.equal(namedSeason("One-Punch.Man.Season.3.S01E02"), 3);
  assert.equal(namedSeason("One Punch Man Season 1 S01E02"), 1);
  assert.equal(namedSeason("[Judas] One-Punch Man - S01E02.mkv"), null);

  // Agreeing, or silent, still plays.
  assert.equal(
    episodeMatches({ title: "One Punch Man Season 1 S01E02 1080p WEB-DL AAC" }, want),
    true,
  );
  assert.equal(episodeMatches({ title: "[Judas] One-Punch Man - S01E02.mkv" }, want), true);
  // A complete-series pack names season 1 first and holds the episode.
  assert.equal(episodeMatches({ title: "One Piece Season 01 (East Blue) EP 002" }, want), true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserPlayable,
  fromProviders,
  isMixedRaceUrl,
  isTorrentRaceUrl,
  mixedRaceUrl,
  present,
  seeders,
  sizeGb,
  torrentRaceUrl,
  srcDeadlineMs,
  withRaceTry,
  TORRENT_RACE_MAX,
  langChoices,
  qualitiesForLang,
} from "./streams.ts";

test("a listing that describes nothing never outranks one we can read", () => {
  /* Peerflix really does answer with only this — no title, no filename, no
     description — so every text rule passes it by default. */
  const pl = present([
    // No language marker at all, so it lands in the Japanese default bucket.
    { text: "Peerflix 1080p", url: "/api/stream?ih=opaque", provider: "Peerflix", described: false },
    {
      text: "[SubsPlease] One Piece - 01 (1080p) [WEB-DL x264 AAC]",
      url: "/api/stream?ih=described",
      provider: "TorrentClaw",
      described: true,
    },
  ]);
  const ja = pl.groups.find((g) => g.lang === "ja");
  assert.equal(ja?.picks[0].url, "/api/stream?ih=described");
  // It is still offered — it may be the only thing that plays.
  assert.equal(ja?.picks.length, 2);

  // A listing that does carry its flag is bucketed by it, not defaulted to Japanese.
  const flagged = present([
    { text: "Peerflix 🇪🇸 1080p", url: "/api/stream?ih=es", provider: "Peerflix", described: false },
  ]);
  assert.deepEqual(
    flagged.groups.map((g) => g.lang),
    ["es"],
  );
});

test("audio the browser cannot decode is no longer a reason to discard a source", () => {
  /* All of these used to be rejected outright for playing picture with no sound.
     The relay re-encodes the audio track, so they are ordinary candidates now —
     and between them they cover most of the best releases the sources carry. */
  for (const text of [
    "OPM S01E01 1080p AMZN WEB-DL DDP2.0 H.264",
    "OPM S01E01 1080p FLAC Dual Audio",
    "OPM S01E01 2160p HDR DTS",
    "Your Name [MicroHD 1080p][AC3 5.1-Castellano-AC3 5.1-Japones+Subs][ES-EN]",
    "OPM S01E01 1080p BluRay x264 AC-3",
    "Death Note (2006) - S01E01 - Rebirth [Bluray-1080p][EAC3 2.0][x264]",
    "OPM S01E01 1080p WEB-DL E-AC-3 H.264",
    "OPM S01E01 1080p WEB-DL DD5.1 H.264",
    // ffmpeg demuxes AVI perfectly well, even though no browser does.
    "Your Name (2016) BluRay Rip Castellano.avi",
    "OPM S01E01 1080p x264 AAC",
    "OPM S01E01 1080p HEVC Dual Audio",
    "OPM S01E01 1080p AV1 dual audio",
  ]) {
    assert.equal(browserPlayable(text), true, text);
  }

  // A cam is about what the picture is worth, not what the browser can decode.
  assert.equal(browserPlayable("One Punch Man S01E01 CAM 480p"), false);
  assert.equal(browserPlayable("One Punch Man S01E01 TELESYNC"), false);
});

test("audio still ranks: a track needing no re-encode is preferred", () => {
  const { groups } = present(
    [
      {
        text: "🌐 1080p 🎞️ h264 🔊 dts · 🇯🇵 👤 20 💾 1.4 GB | OPM S01E01",
        url: "/api/stream?ih=dts",
        provider: "T",
      },
      {
        text: "🌐 1080p 🎞️ h264 🔊 aac · 2.0 · 🇯🇵 👤 20 💾 1.4 GB | OPM S01E01",
        url: "/api/stream?ih=aac",
        provider: "T",
      },
    ],
    "ja",
  );
  const ja = groups.find((g) => g.lang === "ja")!;
  assert.equal(ja.picks[0].url, "/api/stream?ih=aac");
  // But the DTS one is offered, not thrown away.
  assert.ok(ja.picks.some((p) => p.url === "/api/stream?ih=dts"));
});

test("the menu is quality and language, not providers", () => {
  const { groups } = present(
    [
      {
        text: "Torrentio 1080p DualDub/Subs HEVC",
        url: "/api/stream?ih=aa",
        provider: "Torrentio",
      },
      {
        text: "PenguPlay 1080p 4KHDHub DDP2.0 H.264",
        url: "/api/stream?url=ddp",
        provider: "PenguPlay",
      },
      {
        text: "One Punch Man S01E01 1080p WEB-DL AAC H.264",
        url: "/api/stream?url=aac",
        provider: "PenguPlay",
      },
      {
        text: "One Punch Man S01E01 1080p English Dub AAC x264",
        url: "/api/stream?url=dub",
        provider: "Torrentio",
      },
    ],
    "ja",
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["1080p · Japanese", "1080p · English"],
  );
  assert.equal(groups[0].picks[0].url, "/api/stream?url=aac");
  assert.equal(groups[0].picks[0].provider, "PenguPlay");
  assert.notEqual(groups[0].picks[0].url, "/api/stream?url=ddp");
  assert.equal(groups.find((g) => g.lang === "en")?.picks[0].url, "/api/stream?url=dub");
});

test("WEB-DL HTTP AAC outranks a torrent of the same language", () => {
  const { groups } = present(
    [
      { text: "OPM S01E01 1080p AAC", url: "/api/stream?ih=aa", provider: "Torrentio" },
      { text: "OPM S01E01 1080p WEB-DL x264 AAC", url: "/api/stream?url=http", provider: "PenguPlay" },
    ],
    "ja",
  );
  assert.equal(groups[0].picks[0].url, "/api/stream?url=http");
  assert.equal(groups[0].picks[0].provider, "PenguPlay");
});

test("torrents outrank PenguPlay scrapes for Japanese", () => {
  const { groups } = present(
    [
      {
        text: "🐧 PenguPlay 🧊 1080p • Miruro | 🎧 Audio: Japanese 1080pMP4",
        url: "/api/stream?url=scrape",
        provider: "PenguPlay",
      },
      {
        text: "🌐 1080p 🔊 aac · 2.0 · 🇯🇵 | HorribleSubs One-Punch Man - 03 [1080p].mkv",
        url: "/api/stream?ih=hs",
        provider: "TorrentClaw",
      },
    ],
    "ja",
  );
  assert.equal(groups.find((g) => g.lang === "ja")?.picks[0].url, "/api/stream?ih=hs");
});

test("English sub is Japanese audio; English dub is English", () => {
  const { groups } = present(
    [
      { text: "AoT S01E01 1080p English Sub AAC x264", url: "/api/stream?ih=sub", provider: "A" },
      { text: "AoT S01E01 1080p English Dub AAC x264", url: "/api/stream?ih=dub", provider: "B" },
    ],
    "ja",
  );
  assert.ok(groups.find((g) => g.lang === "ja")?.picks.some((p) => p.url === "/api/stream?ih=sub"));
  assert.ok(!groups.find((g) => g.lang === "ja")?.picks.some((p) => p.url === "/api/stream?ih=dub"));
  assert.ok(groups.find((g) => g.lang === "en")?.picks.some((p) => p.url === "/api/stream?ih=dub"));
});

test("Japanese playback prefers and records an advertised English subtitle track", () => {
  const { groups } = present([
    {
      text: "🌐 1080p 🔊 aac · 🇯🇵 💬 🇫🇷 👤 200 Re.Zero.S04E13",
      url: "/api/stream?ih=fr",
      provider: "A",
    },
    {
      text: "🌐 1080p 🔊 aac · 🇯🇵 💬 🇺🇸 👤 180 Re.Zero.S04E13",
      url: "/api/stream?ih=en",
      provider: "A",
    },
  ]);
  const picks = groups.find((g) => g.lang === "ja")!.picks;
  assert.equal(picks[0].url, "/api/stream?ih=en");
  assert.deepEqual(picks[0].subtitles, ["en"]);
});

test("a Hindi multi-dub appears in every language it actually carries", () => {
  /* The relay picks the audio track, so this file legitimately serves Hindi,
     English and Japanese. Hiding it from two of them lost the only working
     source those languages had. */
  const { groups } = present(
    [
      {
        text: "OPM S01E03 1080p [Hindi AAC + English-Japanese AAC] x264 AAC",
        url: "/api/stream?ih=hi",
        provider: "TorrentClaw",
      },
      {
        text: "OPM S01E03 1080p AAC x264",
        url: "/api/stream?ih=ja",
        provider: "PenguPlay",
      },
    ],
    "ja",
  );
  for (const lang of ["hi", "ja", "en"]) {
    assert.ok(
      groups.find((g) => g.lang === lang)?.picks.some((p) => p.url === "/api/stream?ih=hi"),
      `missing from ${lang}`,
    );
  }
  // The Japanese-only file is still there, and still leads its own group.
  assert.equal(groups.find((g) => g.lang === "ja")?.picks[0].url, "/api/stream?ih=ja");
});

test("English dub outranks dual audio in the English group", () => {
  const { groups } = present(
    [
      { text: "OPM S01E03 1080p Dual Audio AAC x264", url: "/api/stream?ih=dual", provider: "A" },
      { text: "OPM S01E03 1080p English Dub AAC x264", url: "/api/stream?ih=dub", provider: "B" },
    ],
    "en",
  );
  const en = groups.find((g) => g.lang === "en")!;
  assert.equal(en.picks[0].url, "/api/stream?ih=dub");
});

test("an unlabelled MULTi does not outrank a described Japanese torrent", () => {
  const { groups } = present(
    [
      {
        text: "🐧 PenguPlay 🧊 1080p • 4KHDHub · R2 | One-Punch.Man.S01E03.CR.WEB-DL.MULTi.AAC2.0.H.264-4kHdHub.Com.mkv",
        url: "/api/stream?url=multi",
        provider: "PenguPlay",
      },
      {
        text: "🐧 PenguPlay 🧊 1080p • Miruro | 🎧 Audio: Japanese",
        url: "/api/stream?url=scrape",
        provider: "PenguPlay",
      },
      {
        text: "🌐 1080p 🔊 aac · 2.0 · 🇯🇵 | KaNNa One-Punch Man S01 1080p x265 AAC",
        url: "/api/stream?ih=tc",
        provider: "TorrentClaw",
      },
    ],
    "ja",
  );
  const ja = groups.find((g) => g.lang === "ja")!;
  /* The MULTi names no language, so it lands in the default pair instead of being
     guessed at, and as a direct link whose Japanese track the relay can select it
     leads — a torrent has to find peers before it plays at all. */
  assert.equal(ja.picks[0].url, "/api/stream?url=multi");
  assert.ok(ja.picks.some((p) => p.url === "/api/stream?ih=tc"));
  // A scraper known to rot still ranks last, direct link or not.
  assert.equal(ja.picks.at(-1)!.url, "/api/stream?url=scrape");
});

test("every spoken language with a stream gets a menu row", () => {
  const { groups } = present(
    [
      { text: "AoT S01E01 1080p ITA AAC x264", url: "/api/stream?ih=it", provider: "A" },
      { text: "AoT S01E01 1080p Hindi AAC x264", url: "/api/stream?ih=hi", provider: "B" },
      { text: "AoT S01E01 1080p AAC x264", url: "/api/stream?ih=ja", provider: "C" },
    ],
    "ja",
  );
  assert.ok(groups.some((g) => g.lang === "it" && g.label === "1080p · Italian"));
  assert.ok(groups.some((g) => g.lang === "hi" && g.label === "1080p · Hindi"));
  assert.ok(groups.some((g) => g.lang === "ja" && g.label === "1080p · Japanese"));
});

test("mixed race url combines the best http pick with a torrent batch", () => {
  const http = [
    {
      url: "/api/stream?url=https%3A%2F%2Fcdn.example%2Fep.mkv&referer=https%3A%2F%2Fsite.example",
      provider: "PenguPlay",
    },
  ];
  const torrent = [
    { url: "/api/stream?ih=aa&s=1&e=3", provider: "A" },
    { url: "/api/stream?ih=bb&s=1&e=3", provider: "B" },
  ];
  const race = mixedRaceUrl(http, torrent)!;
  assert.ok(isMixedRaceUrl(race));
  const u = new URL(race, "http://lacrima.local");
  assert.equal(u.searchParams.get("url"), "https://cdn.example/ep.mkv");
  assert.equal(u.searchParams.get("referer"), "https://site.example");
  assert.deepEqual(u.searchParams.getAll("ih"), ["aa", "bb"]);
  assert.equal(mixedRaceUrl([], torrent), null);
  assert.equal(mixedRaceUrl(http, []), null);

  /* An HLS pick must race alone: the player commits to a demuxer up front, so a
     mixed race won by the torrent side handed hls.js an MKV. */
  const hls = [{ url: "/api/stream?url=https%3A%2F%2Fcdn.example%2Fep.m3u8&hls=1", provider: "P" }];
  assert.equal(mixedRaceUrl(hls, torrent), null);
});

test("withRaceTry appends try only on multi-torrent races", () => {
  const race = "/api/stream?ih=aa&ih=bb&s=1&e=3";
  assert.equal(withRaceTry(race, 0), race);
  assert.equal(
    withRaceTry(race, 2),
    "/api/stream?ih=aa&ih=bb&s=1&e=3&try=2",
  );
  assert.equal(withRaceTry("/api/stream?ih=aa", 1), "/api/stream?ih=aa");
});

test("srcDeadlineMs is short on warm tries and bounded on a fresh race", () => {
  const race = "/api/stream?ih=aa&ih=bb";
  assert.equal(srcDeadlineMs(race), 45_000);
  assert.equal(srcDeadlineMs(`${race}&try=1`), 12_000);
  assert.equal(srcDeadlineMs("/api/stream?url=https://cdn.example/ep.mp4"), 15_000);
  /* A mixed race holds a direct link that answers in about a second; inheriting
     the torrent budget meant 45s spent on a host that stalls on a resume seek. */
  assert.equal(srcDeadlineMs(`${race}&url=https%3A%2F%2Fcdn.example%2Fep.mkv`), 15_000);
  assert.equal(
    srcDeadlineMs(`${race}&url=https%3A%2F%2Fcdn.example%2Fep.mkv&remux=1&cv=anilist`),
    15_000,
  );
  assert.equal(srcDeadlineMs("/api/stream?ih=aa&remux=1&cv=anilist"), 45_000);
  assert.equal(srcDeadlineMs("/api/stream?remux=1&cv=anilist"), 120_000);
});

test("torrent picks in one bucket become a single race URL", () => {
  const picks = Array.from({ length: 8 }, (_, i) => ({
    url: `/api/stream?ih=${"a".repeat(39)}${i}&i=${i}&s=1&e=3`,
    provider: "TorrentClaw",
    hint: `1080p pick ${i}`,
  }));
  const race = torrentRaceUrl(picks)!;
  assert.ok(isTorrentRaceUrl(race));
  assert.equal(new URL(race, "http://lacrima.local").searchParams.getAll("ih").length, TORRENT_RACE_MAX);
  const batch2 = torrentRaceUrl(picks, 1)!;
  assert.equal(new URL(batch2, "http://lacrima.local").searchParams.getAll("ih").length, 2);
  assert.equal(
    torrentRaceUrl([{ url: "/api/stream?ih=aa", provider: "A" }]),
    "/api/stream?ih=aa",
  );
});

test("seeders and size are read off the listing", () => {
  // Real TorrentClaw and AniScraper listings.
  assert.equal(seeders("🌐 1080p | 🔵 67/100 · 👤 226 ✅ TrueSpec 🎞️ hevc 💾 16.3 GB"), 226);
  assert.equal(seeders("👤 7 ✅ TrueSpec Verified 🎞️ h264"), 7);
  assert.equal(seeders("Torrentio 1080p S:1,234 / L:12"), 1234);
  // HTTP listings have no seeders and must not be treated as having none.
  assert.equal(seeders("One Punch Man S01E01 1080p WEB-DL AAC H.264"), null);
  assert.equal(seeders("Peerflix 🇪🇸 1080p"), null);

  assert.equal(sizeGb("💾 16.3 GB"), 16.3);
  assert.equal(sizeGb("📏 259.9 MiB")?.toFixed(3), "0.254");
  assert.equal(sizeGb("💾 1.5 TB"), 1536);
  assert.equal(sizeGb("no size here"), null);
});

test("a direct link beats a torrent unless the swarm is genuinely large", () => {
  /* An HTTP stream plays in about a second; a torrent batch can burn 22s finding
     peers. Only a very well seeded torrent is worth that wait. */
  const beat = present(
    [
      {
        text: "🌐 1080p 🎞️ h264 🔊 aac · 2.0 · 🇯🇵 👤 16 💾 1.4 GB | OPM S01E01",
        url: "/api/stream?ih=mid",
        provider: "TorrentClaw",
      },
      {
        text: "[HS+] Sootio 1080p | One-Punch Man S01E01 1080p WEB-DL x264 AAC 🇯🇵",
        url: "/api/stream?url=direct",
        provider: "Sootio",
      },
    ],
    "ja",
  );
  assert.equal(beat.groups.find((g) => g.lang === "ja")!.picks[0].url, "/api/stream?url=direct");

  /* Even a huge swarm loses: metadata, handshake and buffering still cost more
     than a link that just serves bytes. Seeders decide among torrents only. */
  const huge = present(
    [
      {
        text: "🌐 1080p 🎞️ h264 🔊 aac · 2.0 · 🇯🇵 👤 400 💾 1.4 GB | OPM S01E01",
        url: "/api/stream?ih=huge",
        provider: "TorrentClaw",
      },
      {
        text: "[HS+] Sootio 1080p | One-Punch.Man.S01E01.1080p.CR.WEB-DL.MULTi.AAC2.0.H.264",
        url: "/api/stream?url=direct",
        provider: "Sootio",
      },
    ],
    "ja",
  );
  assert.equal(huge.groups.find((g) => g.lang === "ja")!.picks[0].url, "/api/stream?url=direct");

  // But a scraper known to rot still ranks below torrents, head start withheld.
  const rotten = present(
    [
      {
        text: "🌐 1080p 🎞️ h264 🔊 aac · 2.0 · 🇯🇵 👤 4 | OPM S01E01",
        url: "/api/stream?ih=few",
        provider: "TorrentClaw",
      },
      {
        text: "🐧 PenguPlay 🧊 1080p • Miruro | 🎧 Audio: Japanese",
        url: "/api/stream?url=scrape",
        provider: "PenguPlay",
      },
    ],
    "ja",
  );
  assert.equal(rotten.groups.find((g) => g.lang === "ja")!.picks[0].url, "/api/stream?ih=few");
});

test("a well-seeded torrent beats a starved one in the same bucket", () => {
  /* raceTorrentFiles waits 22s for first bytes, so this is not a preference —
     ranking the 2-seeder first spends that whole window on an empty swarm. */
  const { groups } = present(
    [
      {
        text: "🌐 1080p 🔊 aac · 2.0 · 🇯🇵 👤 2 💾 1.4 GB | [Grp] OPM - 01 x264 AAC",
        url: "/api/stream?ih=starved",
        provider: "TorrentClaw",
      },
      {
        text: "🌐 1080p 🔊 aac · 2.0 · 🇯🇵 👤 108 💾 1.5 GB | [SubsPlease] OPM - 01 x264 AAC",
        url: "/api/stream?ih=healthy",
        provider: "TorrentClaw",
      },
    ],
    "ja",
  );
  const ja = groups.find((g) => g.lang === "ja")!;
  assert.equal(ja.picks[0].url, "/api/stream?ih=healthy");
  assert.equal(ja.picks.length, 2);
});

test("a 145 GB remux does not lead a 1.5 GB episode", () => {
  const { groups } = present(
    [
      {
        text: "🌐 1080p 🔊 aac · 🇯🇵 👤 10 💾 145.4 GB | Death Note [BD 1080p x264 AAC]",
        url: "/api/stream?ih=remux",
        provider: "TorrentClaw",
      },
      {
        text: "🌐 1080p 🔊 aac · 🇯🇵 👤 10 💾 1.5 GB | [Erai-raws] Death Note - 01 x264 AAC",
        url: "/api/stream?ih=episode",
        provider: "TorrentClaw",
      },
    ],
    "ja",
  );
  assert.equal(groups.find((g) => g.lang === "ja")!.picks[0].url, "/api/stream?ih=episode");
});

test("10-bit HEVC ranks below anything that can actually decode", () => {
  const { groups } = present(
    [
      {
        text: "🌐 1080p 🎞️ hevc · 10-bit 🔊 opus · 2.0 · 🇯🇵 👤 26 💾 1.2 GB",
        url: "/api/stream?ih=main10",
        provider: "TorrentClaw",
      },
      {
        text: "🌐 1080p 🎞️ h264 🔊 aac · 2.0 · 🇯🇵 👤 26 💾 1.4 GB",
        url: "/api/stream?ih=avc",
        provider: "TorrentClaw",
      },
    ],
    "ja",
  );
  const ja = groups.find((g) => g.lang === "ja")!;
  assert.equal(ja.picks[0].url, "/api/stream?ih=avc");
  // Still offered — it may be the only thing there.
  assert.ok(ja.picks.some((p) => p.url === "/api/stream?ih=main10"));
});

test("naming the exact work settles a tie but does not outrank a dead codec", () => {
  // All else equal, the file that names our work exactly still wins.
  const tie = present(
    [
      {
        text: "🌐 1080p 🎞️ h264 🔊 aac · 🇯🇵 👤 20 💾 1.4 GB",
        url: "/api/stream?ih=liveaction",
        provider: "T",
        sameWork: false,
      },
      {
        text: "🌐 1080p 🎞️ h264 🔊 aac · 🇯🇵 👤 20 💾 1.4 GB",
        url: "/api/stream?ih=anime",
        provider: "T",
        sameWork: true,
      },
    ],
    "ja",
  );
  assert.equal(tie.groups.find((g) => g.lang === "ja")!.picks[0].url, "/api/stream?ih=anime");

  /* But an alternate romanisation is unjudgeable, not wrong: "Shingeki no Kyojin"
     scores no bonus, and used to lose to a 10-bit HEVC that cannot decode. */
  const codec = present(
    [
      {
        text: "🌐 1080p 🎞️ hevc · 10-bit 🔊 opus · 🇯🇵 👤 26 💾 2.2 GB",
        url: "/api/stream?ih=main10",
        provider: "T",
        sameWork: true,
      },
      {
        text: "🌐 1080p 🎞️ x264 🔊 aac · 🇯🇵 👤 14 💾 0.4 GB",
        url: "/api/stream?ih=avc",
        provider: "T",
        sameWork: false,
      },
    ],
    "ja",
  );
  assert.equal(codec.groups.find((g) => g.lang === "ja")!.picks[0].url, "/api/stream?ih=avc");
});

test("removing a source drops its picks from the saved playlist", () => {
  const pl = present([
    { text: "OPM S01E01 1080p AAC x264", url: "/api/stream?ih=good", provider: "TorrentClaw" },
    { text: "OPM S01E01 1080p AAC x264", url: "/api/stream?url=bad", provider: "Flix-Streams Free" },
  ]);
  const kept = fromProviders(pl, new Set(["TorrentClaw"]))!;
  const picks = kept.groups.flatMap((g) => g.picks);
  assert.ok(picks.every((p) => p.provider === "TorrentClaw"));
  assert.ok(kept.groups.some((g) => g.id === kept.preferred));

  // Every pick gone means the playlist is a miss, so the caller re-resolves.
  assert.equal(fromProviders(pl, new Set(["Nothing installed"])), null);
  // Not knowing what is installed must never empty a good playlist.
  assert.equal(fromProviders(pl, null), pl);
  assert.equal(fromProviders(null, new Set(["TorrentClaw"])), null);
});

test("an SD listing is not filed as 1080p", () => {
  const { groups } = present(
    [{ text: "🌐 SD 👤 19 💾 3.6 GB One Piece [Episode 1-92]", url: "/api/stream?ih=sd", provider: "T" }],
    "ja",
  );
  assert.deepEqual(
    groups.map((g) => g.quality),
    ["480p"],
  );
});

test("exclusive Japanese outranks dual audio in the Japanese group", () => {
  const { groups } = present(
    [
      { text: "OPM S01E01 1080p Dual Audio AAC x264", url: "/api/stream?ih=dual", provider: "A" },
      { text: "OPM S01E01 1080p AAC x264", url: "/api/stream?ih=ja", provider: "B" },
    ],
    "ja",
  );
  const ja = groups.find((g) => g.lang === "ja")!;
  assert.equal(ja.picks[0].url, "/api/stream?ih=ja");
  assert.ok(ja.picks.some((p) => p.url === "/api/stream?ih=dual"));
});

test("langChoices and qualitiesForLang split a mixed playlist the way the dock does", () => {
  const { groups } = present(
    [
      { text: "Show S01E01 1080p Japanese AAC", url: "/api/stream?ih=ja1080", provider: "A" },
      { text: "Show S01E01 720p Japanese AAC", url: "/api/stream?ih=ja720", provider: "B" },
      { text: "Show S01E01 1080p English Dual Audio", url: "/api/stream?ih=en1080", provider: "C" },
    ],
    "ja",
  );
  const langs = langChoices(groups);
  assert.deepEqual(
    langs.map((l) => l.lang),
    ["ja", "en"],
  );
  assert.equal(langs[0].id, groups.find((g) => g.lang === "ja")?.id);
  const jaQ = qualitiesForLang(groups, "ja").map((g) => g.quality);
  const enQ = qualitiesForLang(groups, "en").map((g) => g.quality);
  assert.ok(jaQ.includes("1080p") && jaQ.includes("720p"));
  assert.deepEqual(enQ, ["1080p"]);
  assert.equal(qualitiesForLang(groups, "fr").length, 0);
});

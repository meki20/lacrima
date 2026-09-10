import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { rankRaceTry , claimsEpisode } from "./torrent.ts";

describe("rankRaceTry", () => {
  test("prefers more downloaded bytes, then original pick order", () => {
    const entries = [
      { ih: "aa", downloaded: 1000, order: 0 },
      { ih: "bb", downloaded: 5000, order: 1 },
      { ih: "cc", downloaded: 2000, order: 2 },
    ];
    assert.equal(rankRaceTry(entries, 0), "bb");
    assert.equal(rankRaceTry(entries, 1), "cc");
    assert.equal(rankRaceTry(entries, 2), "aa");
    assert.equal(rankRaceTry(entries, 3), null);
  });

  test("breaks downloaded ties on pick order", () => {
    const entries = [
      { ih: "aa", downloaded: 100, order: 2 },
      { ih: "bb", downloaded: 100, order: 0 },
      { ih: "cc", downloaded: 100, order: 1 },
    ];
    assert.equal(rankRaceTry(entries, 0), "bb");
    assert.equal(rankRaceTry(entries, 1), "cc");
    assert.equal(rankRaceTry(entries, 2), "aa");
  });
});

test("a single-file torrent is not believed about which episode it is", () => {
  const want = { season: 1, episode: 1 };
  // The exact shape that served "One Piece Fan Letter" for episode 1.
  assert.equal(claimsEpisode("One Piece - 1122 (1080p).mkv"), 1122);
  assert.equal(claimsEpisode("One Piece S01E01 1080p.mkv"), 1);
  assert.equal(claimsEpisode("[SubsPlease] One Piece - 01 (1080p).mkv"), 1);
  assert.equal(claimsEpisode("One Piece 1x05 HDTV.mkv"), 5);
  // Names no episode: still played, because plenty of good files do not.
  assert.equal(claimsEpisode("video.mkv"), null);
  assert.equal(claimsEpisode("One Piece Complete 1080p.mkv"), null);
  // A year is not an episode number.
  assert.equal(claimsEpisode("Your Name - 2016 1080p.mkv"), null);
  assert.equal(want.episode, 1);
});

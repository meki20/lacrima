package app.lacrima.android.feature.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerModelsTest {
    @Test fun `android remux urls ask for mpeg-ts`() {
        assertEquals(
            "/api/stream?ih=aa&remux=1&lang=ja&pack=ts",
            withTsPack("/api/stream?ih=aa&remux=1&lang=ja"),
        )
        assertEquals("/api/stream?ih=aa", withTsPack("/api/stream?ih=aa"))
        assertEquals(
            "/api/stream?ih=aa&remux=1&pack=ts",
            withTsPack("/api/stream?ih=aa&remux=1&pack=ts"),
        )
    }

    @Test fun `decoder fallback asks the server for 8-bit h264`() {
        assertEquals(
            "/api/stream?ih=aa&remux=1&pack=ts&video=h264",
            withH264Video("/api/stream?ih=aa&remux=1&pack=ts"),
        )
        assertEquals(
            "/api/stream?ih=aa&remux=1&video=h264",
            withH264Video("/api/stream?ih=aa&remux=1&video=h264"),
        )
        assertTrue(needsH264Fallback("ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES"))
        assertTrue(needsH264Fallback("ERROR_CODE_DECODING_FAILED"))
        assertFalse(needsH264Fallback("ERROR_CODE_IO_BAD_HTTP_STATUS"))
    }

    @Test fun `start deadline matches the web player`() {
        assertEquals(12_000L, startDeadlineMs("/api/stream?ih=aa&ih=bb&try=1"))
        assertEquals(45_000L, startDeadlineMs("/api/stream?ih=aa&ih=bb"))
        assertEquals(15_000L, startDeadlineMs("/api/stream?url=https://cdn.example/ep.mp4"))
        assertEquals(15_000L, startDeadlineMs("/api/stream?ih=aa&url=https://cdn.example/ep.mkv"))
        assertEquals(
            15_000L,
            startDeadlineMs("/api/stream?ih=aa&ih=bb&url=https://cdn.example/ep.mkv&remux=1&cv=anilist"),
        )
        assertEquals(45_000L, startDeadlineMs("/api/stream?ih=aa&remux=1&cv=anilist"))
        assertEquals(120_000L, startDeadlineMs("/api/stream?remux=1&cv=anilist"))
    }

    @Test fun `warm torrent tries reuse the in-flight race`() {
        val race = "/api/stream?ih=aa&ih=bb&ih=cc&remux=1"
        assertEquals(race, withRaceTry(race, 0))
        assertEquals("$race&try=1", withRaceTry(race, 1))
        assertEquals(1, nextRaceTry(race, 0))
        assertEquals(2, nextRaceTry(race, 1))
        assertEquals(null, nextRaceTry(race, 2))
        assertEquals(null, nextRaceTry("/api/stream?ih=aa&remux=1", 0))
    }

    @Test fun `next up appears during the exact ending segment or a credible natural end`() {
        assertTrue(shouldOfferNextEpisode(true, true, 30_000, 1_440_000, 1_430_000))
        assertFalse(shouldOfferNextEpisode(false, true, 30_000, 1_440_000, 1_430_000))
        val ending = SkipSegment("ed", 1_320_000, 1_420_000)
        assertTrue(shouldOfferNextEpisode(false, true, 10_000, 1_440_000, 1_350_000, ending))
        assertFalse(shouldOfferNextEpisode(true, true, 10_000, 1_440_000, 1_430_000))
        assertFalse(shouldOfferNextEpisode(true, true, 30_000, 60_000, 60_000))
        assertFalse(shouldOfferNextEpisode(true, false, 30_000, 1_440_000, 1_430_000))
    }

    @Test fun `nearby timeline taps land on the exact marker`() {
        assertEquals(90_000L, snapToSkipMarker(93_000, listOf(90_000L, 180_000L), 1_440_000, 1_440f))
        assertEquals(300_000L, snapToSkipMarker(300_000, listOf(90_000L, 180_000L), 1_440_000, 1_440f))
    }

    @Test fun `parseCues reads VTT SRT and ASS on episode time`() {
        val vtt = parseCues("WEBVTT\n\n00:03:00.000 --> 00:03:02.500\nHello\n")
        assertEquals(listOf(TimedCue(180.0, 182.5, "Hello")), vtt)
        val srt = parseCues("1\n00:03:00,000 --> 00:03:02,500\nHello\n")
        assertEquals(listOf(TimedCue(180.0, 182.5, "Hello")), srt)
        val ass = parseCues("Dialogue: 0,0:03:00.00,0:03:02.50,Default,,0,0,0,,Hello")
        assertEquals(listOf(TimedCue(180.0, 182.5, "Hello")), ass)
        assertEquals(null, cueAt(vtt, 179.9))
        assertEquals("Hello", cueAt(vtt, 180.0)?.text)
        assertEquals(null, cueAt(vtt, 182.5))
    }

    @Test fun `in-buffer seeks stay on the remux clock`() {
        val inBuffer = decideSeek(
            targetAbsoluteMs = 80_000,
            streamStartMs = 60_000,
            bufferedStartAbsoluteMs = 60_000,
            bufferedEndAbsoluteMs = 180_000,
        )
        assertEquals(20_000L, inBuffer.localPositionMs)
        assertEquals(null, inBuffer.restartAtMs)
        val outside = decideSeek(
            targetAbsoluteMs = 400_000,
            streamStartMs = 60_000,
            bufferedStartAbsoluteMs = 60_000,
            bufferedEndAbsoluteMs = 180_000,
        )
        assertEquals(null, outside.localPositionMs)
        assertEquals(400_000L, outside.restartAtMs)
    }

    @Test fun `unset live buffer times do not collapse the window to the origin`() {
        assertEquals(90_000L, remuxBufferedEndMs(60_000, 30_000, -1, -1))
        assertEquals(150_000L, remuxBufferedEndMs(60_000, 30_000, 90_000, 20_000))
        assertEquals(120_000L, remuxBufferedEndMs(60_000, 30_000, -1, 30_000))
    }

    @Test fun `remux cache maps time onto cached bytes`() {
        assertEquals(0L, remuxByteForTime(10_000_000, 0, 0, 1_000_000))
        assertEquals(399_876L, remuxByteForTime(20_000_000, 10_000_000, 200_000, 1_000_000))
        assertEquals(30_000_000L, remuxCachedEndUs(10_000_000, 200_000, 600_000))
    }

    @Test fun `pickSubLang prefers English on Japanese audio`() {
        val en = SubtitleChoice("en", "en", "English", "https://x/en.srt", "srt")
        val it = SubtitleChoice("it", "it", "Italian", "https://x/it.srt", "srt")
        val cues = listOf(en, it)
        assertEquals("en", pickSubLang(cues, "ja", null))
        assertEquals("off", pickSubLang(cues, "en", null))
        assertEquals("off", pickSubLang(cues, "ja", "off"))
        assertEquals("it", pickSubLang(cues, "ja", "it"))
    }
}

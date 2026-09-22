package app.lacrima.android.feature.player

import app.lacrima.android.model.Media
import app.lacrima.android.model.Settings
import org.json.JSONObject

data class PlaybackRoute(val via: String, val mediaId: Int, val chapterId: String)

data class PlaybackEpisode(
    val id: String,
    val number: Double,
    val name: String,
    val season: Int? = null,
)

data class SkipSegment(val type: String, val startMs: Long, val endMs: Long)

internal fun activeSkipSegment(segments: List<SkipSegment>, positionMs: Long): SkipSegment? =
    segments.firstOrNull { positionMs in it.startMs until it.endMs }

internal fun outroSegment(segments: List<SkipSegment>, positionMs: Long): SkipSegment? =
    activeSkipSegment(segments, positionMs)?.takeIf { it.type == "ed" || it.type == "mixed-ed" }

internal fun skipLabel(segment: SkipSegment): String = when (segment.type) {
    "op", "mixed-op" -> "opening"
    "ed", "mixed-ed" -> "ending"
    "recap" -> "recap"
    else -> "segment"
}

internal fun skipMarkers(segments: List<SkipSegment>): List<Long> =
    segments.flatMap { listOf(it.startMs, it.endMs) }.distinct()

/** Tap targets are generous in pixels but always resolve to the exact source timestamp. */
internal fun snapToSkipMarker(
    targetMs: Long,
    markers: List<Long>,
    durationMs: Long,
    widthPx: Float,
    radiusPx: Float = 14f,
): Long {
    if (markers.isEmpty() || durationMs <= 0 || widthPx <= 0f) return targetMs
    val radiusMs = (durationMs * radiusPx / widthPx).toLong()
    val nearest = markers.minByOrNull { kotlin.math.abs(it - targetMs) } ?: return targetMs
    return if (kotlin.math.abs(nearest - targetMs) <= radiusMs) nearest else targetMs
}

data class StreamAttempt(
    val url: String,
    val provider: String,
    val commit: JSONObject,
)

data class PlaybackStreamGroup(
    val id: String,
    val quality: String,
    val lang: String,
    val label: String,
    val attempts: List<StreamAttempt>,
)

data class SubtitleChoice(
    val id: String,
    val lang: String,
    val label: String,
    val url: String,
    val type: String,
)

data class TimedCue(val start: Double, val end: Double, val text: String)

private val CLOCK = Regex("(?:\\d{1,2}:)?\\d{2}:\\d{2}[.,]\\d{2,3}")
private val PAIR = Regex("(${CLOCK.pattern})\\s*-->\\s*(${CLOCK.pattern})")

internal fun clockToSec(raw: String): Double {
    val parts = raw.replace(',', '.').split(':')
    return if (parts.size == 2) parts[0].toDouble() * 60 + parts[1].toDouble()
    else parts[0].toDouble() * 3600 + parts[1].toDouble() * 60 + parts[2].toDouble()
}

internal fun parseCues(text: String): List<TimedCue> {
    val src = text.replace("\uFEFF", "").replace("\r", "")
    return if (Regex("^Dialogue:", RegexOption.MULTILINE).containsMatchIn(src)) parseAss(src) else parseBlocks(src)
}

private fun cleanCueText(raw: String): String = raw
    .replace(Regex("\\{[^}]*\\}"), "")
    .replace(Regex("<[^>]+>"), "")
    .replace("\\N", "\n")
    .replace("\\n", "\n")
    .replace("&gt;", ">")
    .replace("&lt;", "<")
    .replace("&amp;", "&")
    .trim()

private fun parseBlocks(src: String): List<TimedCue> {
    val out = mutableListOf<TimedCue>()
    for (block in src.split(Regex("\n\\s*\n+"))) {
        val lines = block.split('\n')
        val i = lines.indexOfFirst { it.contains("-->") }
        if (i < 0) continue
        val m = PAIR.find(lines[i]) ?: continue
        val start = clockToSec(m.groupValues[1])
        val end = clockToSec(m.groupValues[2])
        val cueText = cleanCueText(lines.drop(i + 1).joinToString("\n"))
        if (cueText.isNotBlank() && end > start) out += TimedCue(start, end, cueText)
    }
    return out
}

private fun parseAss(src: String): List<TimedCue> {
    val out = mutableListOf<TimedCue>()
    for (line in src.lineSequence()) {
        if (!line.startsWith("Dialogue:")) continue
        val parts = line.substring("Dialogue:".length).split(',')
        if (parts.size < 10) continue
        val start = clockToSec(parts[1].trim())
        val end = clockToSec(parts[2].trim())
        val cueText = cleanCueText(parts.drop(9).joinToString(","))
        if (cueText.isNotBlank() && end > start) out += TimedCue(start, end, cueText)
    }
    return out
}

internal fun cueAt(cues: List<TimedCue>, at: Double): TimedCue? {
    for (i in cues.indices.reversed()) {
        val c = cues[i]
        if (at >= c.start && at < c.end) return c
    }
    return null
}

internal fun pickSubLang(cues: List<SubtitleChoice>, audio: String, saved: String?): String {
    if (saved == "off") return "off"
    val hit = saved?.let { choice -> cues.find { it.id == choice } ?: cues.find { it.lang == choice } }
    if (hit != null) return hit.id
    if (audio == "en") return "off"
    return cues.find { it.lang == "en" }?.id ?: "off"
}

internal fun parseSubSync(raw: Double): Double {
    val stepped = Math.round(raw / 0.25) * 0.25
    return stepped.coerceIn(-10.0, 10.0)
}

internal fun parseCaptionScale(raw: Float): Float = when (raw) {
    1.2f, 1.45f -> raw
    else -> 1f
}

internal fun captionScaleLabel(scale: Float): String = when (scale) {
    1.45f -> "Large"
    1.2f -> "Medium"
    else -> "Small"
}

internal fun qualitiesForLang(groups: List<PlaybackStreamGroup>, lang: String) =
    groups.filter { it.lang == lang }

internal fun langChoices(groups: List<PlaybackStreamGroup>): List<PlaybackStreamGroup> {
    val seen = mutableSetOf<String>()
    return groups.filter { seen.add(it.lang) }
}

internal fun langLabel(id: String): String = when (id) {
    "ja" -> "Japanese"
    "en" -> "English"
    "it" -> "Italian"
    "de" -> "German"
    "fr" -> "French"
    "es" -> "Spanish"
    "pt" -> "Portuguese"
    "hi" -> "Hindi"
    "ko" -> "Korean"
    "zh" -> "Chinese"
    "ru" -> "Russian"
    else -> id.uppercase()
}

data class PlaybackProgress(
    val via: String,
    val mediaId: Int,
    val title: String,
    val cover: String?,
    val unit: Int,
    val chapterId: String,
    val chapterName: String,
    val season: Int? = null,
    val episode: Double? = null,
    val durationSeconds: Int? = null,
    val seriesParts: List<PlaybackSeriesPart> = emptyList(),
    val partIndex: Int? = null,
)

data class PlaybackSeriesPart(val mediaId: Int, val title: String, val cover: String?, val units: Int)

data class PlaybackDocument(
    val media: Media,
    val route: PlaybackRoute,
    val episode: PlaybackEpisode,
    val episodes: List<PlaybackEpisode>,
    val previousEpisodeId: String?,
    val nextEpisodeId: String?,
    val initialTimeMs: Long,
    val durationMs: Long?,
    val streamGroups: List<PlaybackStreamGroup>,
    val preferredStreamGroup: String?,
    val subtitlesUrl: String?,
    val nextPlaybackUrl: String?,
    val progress: PlaybackProgress,
    val settings: Settings,
)

internal data class SeekDecision(val localPositionMs: Long?, val restartAtMs: Long?)

/** Keep reading the live remux so seeks inside this window are currentTime only. */
internal const val REMUX_MIN_BUFFER_MS = 5_000
internal const val REMUX_MAX_BUFFER_MS = 60_000
internal const val REMUX_PLAYBACK_BUFFER_MS = 1_000
internal const val REMUX_REBUFFER_MS = 2_000
internal const val REMUX_BACK_BUFFER_MS = 60_000
internal const val REMUX_TARGET_BUFFER_BYTES = 32 * 1024 * 1024
internal const val REMUX_DISK_CACHE_BYTES = 1024L * 1024 * 1024

internal fun remuxDurationUs(durationMs: Long?, startAtMs: Long = 0): Long {
    val total = durationMs?.takeIf { it > 0 } ?: 6 * 60 * 60 * 1000L
    return (total - startAtMs).coerceAtLeast(1_000) * 1_000
}

internal fun remuxByteForTime(
    timeUs: Long,
    indexedTimeUs: Long,
    indexedPosition: Long,
    cachedBytes: Long,
): Long {
    if (indexedTimeUs <= 0 || indexedPosition <= 0) return 0
    val raw = timeUs.coerceAtLeast(0) * indexedPosition / indexedTimeUs
    val cap = (cachedBytes - 188).coerceAtLeast(0)
    return (raw.coerceAtMost(cap) / 188) * 188
}

internal fun remuxCachedEndUs(indexedTimeUs: Long, indexedPosition: Long, cachedBytes: Long): Long {
    if (indexedPosition <= 0 || indexedTimeUs <= 0) return 0
    return cachedBytes * indexedTimeUs / indexedPosition
}

/** ExoPlayer reports TIME_UNSET as a negative; that must not collapse the buffer to 0. */
internal fun remuxBufferedEndMs(
    streamStartMs: Long,
    currentPositionMs: Long,
    bufferedPositionMs: Long,
    totalBufferedDurationMs: Long,
): Long {
    val current = currentPositionMs.coerceAtLeast(0)
    var localEnd = current
    if (bufferedPositionMs >= 0) localEnd = maxOf(localEnd, bufferedPositionMs)
    if (totalBufferedDurationMs >= 0) localEnd = maxOf(localEnd, current + totalBufferedDurationMs)
    return streamStartMs + localEnd
}

/** In-buffer seeks never rebuild the remux. */
internal fun decideSeek(
    targetAbsoluteMs: Long,
    streamStartMs: Long,
    bufferedStartAbsoluteMs: Long,
    bufferedEndAbsoluteMs: Long,
): SeekDecision {
    val target = targetAbsoluteMs.coerceAtLeast(0)
    return if (target in bufferedStartAbsoluteMs..bufferedEndAbsoluteMs) {
        SeekDecision(localPositionMs = (target - streamStartMs).coerceAtLeast(0), restartAtMs = null)
    } else {
        SeekDecision(localPositionMs = null, restartAtMs = target)
    }
}

internal fun nextPlayableAttempt(
    groups: List<PlaybackStreamGroup>,
    groupIndex: Int,
    attemptIndex: Int,
): Pair<Int, Int>? {
    val group = groups.getOrNull(groupIndex) ?: return null
    if (attemptIndex + 1 < group.attempts.size) return groupIndex to attemptIndex + 1
    for (i in groupIndex + 1 until groups.size) {
        if (groups[i].lang == group.lang && groups[i].attempts.isNotEmpty()) return i to 0
    }
    return null
}

/** Native players ingest MPEG-TS. Leave web remux URLs as fragmented MP4. */
internal fun withTsPack(url: String): String {
    if ("remux=1" !in url || Regex("(?:^|[?&])pack=").containsMatchIn(url)) return url
    return if ("?" in url) "$url&pack=ts" else "$url?pack=ts"
}

/** Retry exactly once with 8-bit H.264 after the device rejects the source video. */
internal fun withH264Video(url: String): String {
    if (queryValues(url, "video").contains("h264")) return url
    return if ("?" in url) "$url&video=h264" else "$url?video=h264"
}

/** These are the Media3 decoder errors a server-side 8-bit H.264 retry can fix. */
internal fun needsH264Fallback(errorCodeName: String): Boolean = errorCodeName in setOf(
    "ERROR_CODE_DECODER_INIT_FAILED",
    "ERROR_CODE_DECODING_FAILED",
    "ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES",
    "ERROR_CODE_DECODING_FORMAT_UNSUPPORTED",
)

internal fun queryValues(url: String, key: String): List<String> {
    val query = url.substringAfter('?', "")
    if (query.isEmpty()) return emptyList()
    return query.split('&').mapNotNull { part ->
        val at = part.indexOf('=')
        val name = if (at < 0) part else part.substring(0, at)
        if (name != key) null else if (at < 0) "" else part.substring(at + 1)
    }
}

internal fun isRaceUrl(url: String): Boolean {
    val hashes = queryValues(url, "ih")
    return hashes.size > 1 || (queryValues(url, "url").isNotEmpty() && hashes.isNotEmpty())
}

internal fun withRaceTry(url: String, tryN: Int): String {
    if (tryN <= 0 || !isRaceUrl(url)) return url
    val base = url.substringBefore('?')
    val rest = url.substringAfter('?', "")
        .split('&')
        .filter { it.isNotEmpty() && !it.startsWith("try=") }
    return "$base?${(rest + "try=$tryN").joinToString("&")}"
}

internal fun nextRaceTry(url: String, tryN: Int): Int? {
    val next = tryN + 1
    val size = queryValues(url, "ih").size
    return if (isRaceUrl(url) && size > 1 && next < size) next else null
}

/**
 * How long the player may wait before this URL is a bust.
 * Mirrors `srcDeadlineMs` in lib/streams.ts.
 */
internal fun startDeadlineMs(url: String): Long {
    val tryN = queryValues(url, "try").firstOrNull()?.toIntOrNull() ?: 0
    if (tryN > 0) return 12_000L
    val hasUrl = queryValues(url, "url").isNotEmpty()
    val hasIh = queryValues(url, "ih").isNotEmpty()
    if (hasUrl && hasIh) return 15_000L
    if (hasIh) return 45_000L
    if (queryValues(url, "remux").firstOrNull() == "1" && queryValues(url, "cv").isNotEmpty()) {
        return 120_000L
    }
    return 15_000L
}

/** Never treat a short or failed remux as a finished episode. */
internal fun shouldOfferNextEpisode(
    ended: Boolean,
    hasNext: Boolean,
    watchedMs: Long,
    durationMs: Long?,
    positionMs: Long,
    outro: SkipSegment? = null,
): Boolean {
    if (!hasNext) return false
    if (outro != null && positionMs in outro.startMs until outro.endMs) return true
    return ended && watchedMs >= 30_000 && (durationMs ?: 0) >= 90_000 &&
        positionMs >= (durationMs ?: Long.MAX_VALUE) - 15_000
}

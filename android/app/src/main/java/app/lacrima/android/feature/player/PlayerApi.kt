package app.lacrima.android.feature.player

import app.lacrima.android.data.ApiClient
import app.lacrima.android.model.ApiResult
import app.lacrima.android.model.toMedia
import app.lacrima.android.model.toSettings
import app.lacrima.android.model.wireString
import org.json.JSONArray
import org.json.JSONObject

class PlayerApi(private val client: ApiClient) {
    fun load(
        route: PlaybackRoute,
        lang: String? = null,
        startAtMs: Long = 0,
        subtitleLang: String? = null,
        fresh: Boolean = false,
    ): ApiResult<PlaybackDocument> {
        val query = buildList {
            lang?.let { add("lang=${ApiClient.encode(it)}") }
            if (startAtMs > 0) add("t=${startAtMs / 1000.0}")
            subtitleLang?.takeUnless { it == "off" || it == "auto" }?.let { add("sub=${ApiClient.encode(it)}") }
            if (fresh) add("fresh=1")
        }.joinToString("&").let { if (it.isEmpty()) "" else "?$it" }
        val path = "playback/${ApiClient.encode(route.via)}/anime/${route.mediaId}/${ApiClient.encode(route.chapterId)}$query"
        return when (val result = client.get(path)) {
            is ApiResult.Failure -> result
            is ApiResult.Success -> runCatching { parseDocument(result.data, route) }
                .fold(
                    onSuccess = { ApiResult.Success(it) },
                    onFailure = { ApiResult.Failure("invalid_playback", it.message ?: "Unreadable playback response.") },
                )
        }
    }

    fun commit(route: PlaybackRoute, attempt: StreamAttempt): ApiResult<Any> =
        client.post(
            "playback/${ApiClient.encode(route.via)}/anime/${route.mediaId}/${ApiClient.encode(route.chapterId)}/commit",
            attempt.commit,
        )

    fun subtitles(route: PlaybackRoute, fresh: Boolean = false): ApiResult<List<SubtitleChoice>> {
        val path = "playback/${ApiClient.encode(route.via)}/anime/${route.mediaId}/${ApiClient.encode(route.chapterId)}/subtitles${if (fresh) "?fresh=1" else ""}"
        return when (val result = client.get(path)) {
            is ApiResult.Failure -> result
            is ApiResult.Success -> runCatching {
                val root = result.data as? JSONObject ?: error("Subtitle data is not an object.")
                root.optJSONArray("subtitles")?.objects()?.mapNotNull { cue ->
                    val original = cue.stringOrNull("url") ?: return@mapNotNull null
                    val src = cue.stringOrNull("src")?.let(client::absolute) ?: return@mapNotNull null
                    SubtitleChoice(
                        id = cue.optString("id", original),
                        lang = cue.optString("lang"),
                        label = cue.optString("label", cue.optString("lang")),
                        url = original,
                        type = cue.optString("type", "vtt"),
                        src = src,
                    )
                }.orEmpty()
            }.fold(
                onSuccess = { ApiResult.Success(it) },
                onFailure = { ApiResult.Failure("invalid_subtitles", it.message ?: "Unreadable subtitle response.") },
            )
        }
    }

    fun skipTimes(route: PlaybackRoute): ApiResult<List<SkipSegment>> {
        val path = "playback/${ApiClient.encode(route.via)}/anime/${route.mediaId}/${ApiClient.encode(route.chapterId)}/skip-times"
        return when (val result = client.get(path)) {
            is ApiResult.Failure -> result
            is ApiResult.Success -> runCatching {
                val root = result.data as? JSONObject ?: error("Skip-time data is not an object.")
                root.optJSONArray("segments")?.objects()?.mapNotNull { segment ->
                    val start = segment.doubleOrNull("start")?.times(1000)?.toLong()
                    val end = segment.doubleOrNull("end")?.times(1000)?.toLong()
                    val type = segment.stringOrNull("type")
                    if (start == null || end == null || end <= start || type == null) null
                    else SkipSegment(type, start, end)
                }.orEmpty()
            }.fold(
                onSuccess = { ApiResult.Success(it) },
                onFailure = { ApiResult.Failure("invalid_skip_times", it.message ?: "Unreadable skip-time response.") },
            )
        }
    }

    fun writeProgress(progress: PlaybackProgress, absoluteMs: Long, watchedDelta: Int): ApiResult<Any> =
        client.put("progress", JSONObject().apply {
            put("via", progress.via)
            put("mediaId", progress.mediaId)
            put("kind", "anime")
            put("title", progress.title)
            put("cover", progress.cover)
            put("unit", progress.unit)
            put("chapterId", progress.chapterId)
            put("chapterName", progress.chapterName)
            progress.season?.let { put("season", it) }
            progress.episode?.let { put("episode", it) }
            progress.durationSeconds?.let { put("durationSeconds", it) }
            progress.partIndex?.let { put("partIndex", it) }
            if (progress.seriesParts.isNotEmpty()) put("seriesParts", JSONArray(progress.seriesParts.map {
                JSONObject().apply {
                    put("mediaId", it.mediaId)
                    put("title", it.title)
                    put("cover", it.cover)
                    put("units", it.units)
                }
            }))
            if (watchedDelta > 0) put("watchedDelta", watchedDelta.coerceIn(0, 30))
            put("anchor", JSONObject().apply {
                put("kind", "seconds")
                put("at", absoluteMs.coerceAtLeast(0) / 1000.0)
                put("chapterId", progress.chapterId)
                put("chapterName", progress.chapterName)
                progress.durationSeconds?.let { put("duration", it) }
                progress.season?.takeIf { it > 0 }?.let { put("season", it) }
                progress.episode?.takeIf { it > 0 }?.let { put("episode", it) }
            })
        })

    fun subtitleText(choice: SubtitleChoice): ApiResult<String> = client.getTextAbsolute(choice.src)

    fun absolute(url: String): String = client.absolute(url)

    /** Warm only after the current episode can play; the server owns all source work. */
    fun warmNext(document: PlaybackDocument) {
        document.nextPlaybackUrl?.let { client.getAbsoluteJson(it) }
    }

    private fun parseDocument(raw: Any, route: PlaybackRoute): PlaybackDocument {
        val root = raw as? JSONObject ?: error("Playback data is not an object.")
        val media = root.optJSONObject("media")?.toMedia() ?: error("Playback media is missing.")
        val episode = (root.optJSONObject("episode") ?: JSONObject()).toEpisode(route.chapterId)
        val episodes = root.optJSONArray("episodes")?.objects()?.map { it.toEpisode() }.orEmpty()
        val groups = root.optJSONArray("streamGroups")?.objects()?.map { group ->
            PlaybackStreamGroup(
                id = group.optString("id"),
                quality = group.optString("quality"),
                lang = group.optString("lang"),
                label = group.optString("label", "${group.optString("quality")} · ${group.optString("lang").uppercase()}"),
                attempts = group.optJSONArray("attempts")?.objects()?.mapNotNull { attempt ->
                    attempt.stringOrNull("url")?.let { url ->
                        StreamAttempt(
                            url = client.absolute(withTsPack(url)),
                            provider = attempt.optString("provider", "Source"),
                            commit = attempt.optJSONObject("commit") ?: JSONObject().apply {
                                put("groupId", group.optString("id"))
                            },
                        )
                    }
                }.orEmpty(),
            )
        }.orEmpty().filter { it.attempts.isNotEmpty() }
        if (groups.isEmpty()) error("No playable stream groups.")
        val progressJson = root.optJSONObject("progress") ?: JSONObject()
        val parts = progressJson.optJSONArray("seriesParts")?.objects().orEmpty()
        return PlaybackDocument(
            media = media,
            route = route,
            episode = episode,
            episodes = episodes,
            previousEpisodeId = root.stringOrNull("previousEpisodeId"),
            nextEpisodeId = root.stringOrNull("nextEpisodeId"),
            initialTimeMs = (root.optDouble("initialTime", 0.0) * 1000).toLong().coerceAtLeast(0),
            durationMs = root.doubleOrNull("durationSeconds")?.takeIf { it > 0 }?.times(1000)?.toLong(),
            streamGroups = groups,
            preferredStreamGroup = root.stringOrNull("preferredStreamGroup"),
            subtitlesUrl = root.stringOrNull("subtitlesUrl")?.let(client::absolute),
            nextPlaybackUrl = root.stringOrNull("nextPlaybackUrl")?.let(client::absolute),
            progress = PlaybackProgress(
                via = progressJson.optString("via", media.via),
                mediaId = progressJson.optInt("mediaId", media.id),
                title = progressJson.optString("title", media.title),
                cover = progressJson.stringOrNull("cover") ?: media.cover,
                unit = progressJson.optInt("unit", episodes.indexOfFirst { it.id == route.chapterId }.takeIf { it >= 0 }?.plus(1) ?: 0),
                chapterId = progressJson.optString("chapterId", route.chapterId),
                chapterName = progressJson.optString("chapterName", episode.name),
                season = progressJson.intOrNull("season") ?: episode.season,
                episode = progressJson.doubleOrNull("episode") ?: episode.number,
                durationSeconds = progressJson.intOrNull("durationSeconds")
                    ?: root.doubleOrNull("durationSeconds")?.toInt(),
                seriesParts = parts.map {
                    PlaybackSeriesPart(
                        mediaId = it.optInt("mediaId"),
                        title = it.optString("title"),
                        cover = it.stringOrNull("cover"),
                        units = it.optInt("units"),
                    )
                },
                partIndex = progressJson.intOrNull("partIndex"),
            ),
            settings = (root.optJSONObject("settings") ?: JSONObject()).toSettings(),
        )
    }
}

private fun JSONObject.toEpisode(fallbackId: String = "") = PlaybackEpisode(
    id = wireString("id").ifBlank { fallbackId },
    number = if (has("number") && !isNull("number")) optDouble("number") else 0.0,
    name = optString("name", "Episode ${optString("number")}"),
    season = intOrNull("season"),
)

private fun JSONObject.stringOrNull(name: String): String? =
    if (has(name) && !isNull(name)) optString(name).takeIf(String::isNotBlank) else null

private fun JSONObject.intOrNull(name: String): Int? =
    if (has(name) && !isNull(name)) optInt(name) else null

private fun JSONObject.doubleOrNull(name: String): Double? =
    if (has(name) && !isNull(name)) optDouble(name).takeUnless(Double::isNaN) else null

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull(::optJSONObject)

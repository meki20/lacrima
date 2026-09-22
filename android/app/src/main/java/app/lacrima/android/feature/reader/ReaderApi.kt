package app.lacrima.android.feature.reader

import app.lacrima.android.data.ApiClient
import app.lacrima.android.model.ApiResult
import app.lacrima.android.model.MediaKind
import app.lacrima.android.model.toMedia
import app.lacrima.android.model.toSettings
import app.lacrima.android.model.wireString
import org.json.JSONArray
import org.json.JSONObject

class ReaderApi(private val client: ApiClient) {
    private val cache = object : LinkedHashMap<ReaderRoute, ReaderDocument>(5, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<ReaderRoute, ReaderDocument>?) = size > 5
    }

    @Synchronized
    fun cached(route: ReaderRoute): ReaderDocument? = cache[route]

    @Synchronized
    fun takeCached(route: ReaderRoute): ReaderDocument? = cache.remove(route)

    @Synchronized
    fun putCached(route: ReaderRoute, document: ReaderDocument) {
        cache[route] = document
    }

    fun load(route: ReaderRoute, cacheResult: Boolean = true): ApiResult<ReaderDocument> {
        if (cacheResult) cached(route)?.let { return ApiResult.Success(it) }
        val path = "reader/${ApiClient.encode(route.via)}/${ApiClient.encode(route.kind)}/${route.mediaId}/${ApiClient.encode(route.chapterId)}"
        return when (val result = client.get(path)) {
            is ApiResult.Failure -> result
            is ApiResult.Success -> runCatching { parseDocument(result.data, route) }
                .fold(
                    onSuccess = {
                        if (cacheResult) putCached(route, it)
                        ApiResult.Success(it)
                    },
                    onFailure = { ApiResult.Failure("invalid_reader", it.message ?: "Unreadable reader response.") },
                )
        }
    }

    fun writeProgress(
        target: ProgressTarget,
        anchor: ReaderAnchor,
        skipAhead: Boolean = false,
        exact: Boolean = false,
    ): ApiResult<Any> = client.put("progress", progressJson(target, anchor, skipAhead, exact))

    fun absolute(url: String): String = client.absolute(url)

    private fun parseDocument(raw: Any, route: ReaderRoute): ReaderDocument {
        val root = raw as? JSONObject ?: error("Reader data is not an object.")
        val media = root.optJSONObject("media")?.toMedia() ?: error("Reader media is missing.")
        val chapterJson = root.optJSONObject("chapter") ?: JSONObject()
        val chapter = chapterJson.toReaderChapter(route.chapterId)
        val chapterEnvelope = root.optJSONObject("chapters")
        val chapterData = when {
            chapterEnvelope == null -> root.optJSONArray("chapterList") ?: JSONArray()
            chapterEnvelope.optBoolean("ok", false) -> chapterEnvelope.optJSONArray("data")
                ?: chapterEnvelope.optJSONArray("value")
                ?: JSONArray()
            else -> JSONArray()
        }
        val chapterError = chapterEnvelope?.takeUnless { it.optBoolean("ok", false) }
            ?.optJSONObject("error")?.optString("message")
            ?.takeIf(String::isNotBlank)
            ?: chapterEnvelope?.takeUnless { it.optBoolean("ok", false) }
                ?.optString("reason")?.takeIf(String::isNotBlank)
        val chapters = (0 until chapterData.length()).mapNotNull {
            chapterData.optJSONObject(it)?.toReaderChapter()
        }
        val initialAnchor = parseAnchor(root.optJSONObject("initialAnchor"), route.kind)
        val contentJson = root.optJSONObject("content") ?: error("Reader content is missing.")
        val content = when (contentJson.optString("type")) {
            "pages" -> ReaderContent.Pages(contentJson.optJSONArray("urls").strings())
            "html" -> ReaderContent.Html(contentJson.optString("html"))
            else -> error("Unsupported reader content.")
        }
        val progress = parseProgress(root.optJSONObject("progress"), media, chapter, chapters, route)
        return ReaderDocument(
            media = media,
            route = route.copy(kind = media.kind.wire),
            chapter = chapter,
            chapters = chapters,
            chapterError = chapterError,
            previousChapterId = root.stringOrNull("previousChapterId"),
            nextChapterId = root.stringOrNull("nextChapterId"),
            initialAnchor = initialAnchor,
            content = content,
            progress = progress,
            trackProgress = root.optBoolean("trackProgress", true),
            settings = (root.optJSONObject("settings") ?: JSONObject()).toSettings(),
        )
    }

    private fun parseProgress(
        raw: JSONObject?,
        media: app.lacrima.android.model.Media,
        chapter: ReaderChapter,
        chapters: List<ReaderChapter>,
        route: ReaderRoute,
    ): ProgressTarget {
        val p = raw ?: JSONObject()
        val unit = p.optInt("unit", chapters.indexOfFirst { it.id == route.chapterId }.takeIf { it >= 0 }?.plus(1)
            ?: chapter.number.toInt().coerceAtLeast(0))
        val parts = p.optJSONArray("seriesParts") ?: JSONArray()
        return ProgressTarget(
            via = p.optString("via", media.via),
            mediaId = p.optInt("mediaId", media.id),
            kind = p.optString("kind", media.kind.wire),
            title = p.optString("title", media.title),
            cover = p.stringOrNull("cover") ?: media.cover,
            unit = unit,
            chapterId = p.optString("chapterId", route.chapterId),
            chapterName = p.optString("chapterName", chapter.name),
            pages = p.intOrNull("pages") ?: chapter.pageCount,
            season = p.intOrNull("season") ?: chapter.season,
            episode = p.doubleOrNull("episode"),
            durationSeconds = p.intOrNull("durationSeconds"),
            seriesParts = (0 until parts.length()).mapNotNull { i ->
                parts.optJSONObject(i)?.let {
                    ProgressSeriesPart(
                        mediaId = it.optInt("mediaId"),
                        title = it.optString("title"),
                        cover = it.stringOrNull("cover"),
                        units = it.optInt("units"),
                    )
                }
            },
            partIndex = p.intOrNull("partIndex"),
        )
    }
}

private fun JSONObject.toReaderChapter(fallbackId: String = ""): ReaderChapter = ReaderChapter(
    id = wireString("id").ifBlank { fallbackId },
    number = if (has("number") && !isNull("number")) optDouble("number") else 0.0,
    name = optString("name", "Chapter ${optString("number")}"),
    scanlator = stringOrNull("scanlator"),
    pageCount = intOrNull("pageCount") ?: intOrNull("page_count"),
    season = intOrNull("season"),
)

private fun parseAnchor(raw: JSONObject?, kind: String): ReaderAnchor {
    if (raw == null) return if (kind == MediaKind.NOVEL.wire) ReaderAnchor.Paragraph(0) else ReaderAnchor.Page(0, null)
    return when (raw.optString("kind")) {
        "page" -> ReaderAnchor.Page(raw.optInt("index").coerceAtLeast(0), raw.intOrNull("pages"))
        "paragraph" -> ReaderAnchor.Paragraph(paragraphIndex(raw.optString("cfi")))
        else -> if (kind == MediaKind.NOVEL.wire) ReaderAnchor.Paragraph(0) else ReaderAnchor.Page(0, null)
    }
}

internal fun paragraphIndex(cfi: String?): Int =
    cfi?.substringAfterLast(':')?.toIntOrNull()?.coerceAtLeast(0) ?: 0

private fun progressJson(
    p: ProgressTarget,
    anchor: ReaderAnchor,
    skipAhead: Boolean,
    exact: Boolean,
) = JSONObject().apply {
    put("via", p.via)
    put("mediaId", p.mediaId)
    put("kind", p.kind)
    put("title", p.title)
    put("cover", p.cover)
    put("unit", p.unit)
    put("chapterId", p.chapterId)
    put("chapterName", p.chapterName)
    p.pages?.let { put("pages", it) }
    p.season?.let { put("season", it) }
    p.episode?.let { put("episode", it) }
    p.durationSeconds?.let { put("durationSeconds", it) }
    p.partIndex?.let { put("partIndex", it) }
    if (p.seriesParts.isNotEmpty()) put("seriesParts", JSONArray(p.seriesParts.map {
        JSONObject().apply {
            put("mediaId", it.mediaId)
            put("title", it.title)
            put("cover", it.cover)
            put("units", it.units)
        }
    }))
    if (skipAhead) put("skipAhead", true)
    if (exact) put("exact", true)
    put("anchor", when (anchor) {
        is ReaderAnchor.Page -> JSONObject().apply {
            put("kind", "page")
            put("index", anchor.index)
            put("chapterId", p.chapterId)
            put("chapterName", p.chapterName)
            anchor.pages?.let { put("pages", it) }
        }
        is ReaderAnchor.Paragraph -> JSONObject().apply {
            put("kind", "paragraph")
            put("cfi", "p:${anchor.index}")
            put("chapterId", p.chapterId)
            put("chapterName", p.chapterName)
        }
    })
}

private fun JSONObject.stringOrNull(name: String): String? =
    if (has(name) && !isNull(name)) optString(name).takeIf(String::isNotBlank) else null

private fun JSONObject.intOrNull(name: String): Int? =
    if (has(name) && !isNull(name)) optInt(name) else null

private fun JSONObject.doubleOrNull(name: String): Double? =
    if (has(name) && !isNull(name)) optDouble(name).takeUnless(Double::isNaN) else null

private fun JSONArray.strings(): List<String> =
    (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }

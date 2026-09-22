package app.lacrima.android.feature.reader

import app.lacrima.android.model.Media
import app.lacrima.android.model.Settings

data class ReaderRoute(
    val via: String,
    val kind: String,
    val mediaId: Int,
    val chapterId: String,
)

data class ReaderChapter(
    val id: String,
    val number: Double,
    val name: String,
    val scanlator: String? = null,
    val pageCount: Int? = null,
    val season: Int? = null,
)

sealed interface ReaderContent {
    data class Pages(val urls: List<String>) : ReaderContent
    data class Html(val html: String) : ReaderContent
}

sealed interface ReaderAnchor {
    data class Page(val index: Int, val pages: Int?) : ReaderAnchor
    data class Paragraph(val index: Int) : ReaderAnchor
}

data class ProgressTarget(
    val via: String,
    val mediaId: Int,
    val kind: String,
    val title: String,
    val cover: String?,
    val unit: Int,
    val chapterId: String,
    val chapterName: String,
    val pages: Int? = null,
    val season: Int? = null,
    val episode: Double? = null,
    val durationSeconds: Int? = null,
    val seriesParts: List<ProgressSeriesPart> = emptyList(),
    val partIndex: Int? = null,
)

data class ProgressSeriesPart(
    val mediaId: Int,
    val title: String,
    val cover: String?,
    val units: Int,
)

data class ReaderDocument(
    val media: Media,
    val route: ReaderRoute,
    val chapter: ReaderChapter,
    val chapters: List<ReaderChapter>,
    val chapterError: String? = null,
    val previousChapterId: String?,
    val nextChapterId: String?,
    val initialAnchor: ReaderAnchor,
    val content: ReaderContent,
    val progress: ProgressTarget,
    val trackProgress: Boolean = true,
    val settings: Settings,
)

data class ChapterPreview(
    val chapterId: String,
    val urls: List<String>,
    val stacks: List<List<Int>>,
)

data class ReaderPrefs(
    val mode: String = "paged",
    val rtl: Boolean = true,
    val fit: String = "height",
    val spread: String = "single",
)

internal fun safePage(index: Int, count: Int): Int =
    if (count <= 0) 0 else index.coerceIn(0, count - 1)

/** Slider coordinates grow left-to-right; RTL reading grows right-to-left. */
internal fun seekbarPage(page: Int, count: Int, rtl: Boolean): Int {
    val safe = safePage(page, count)
    return if (rtl && count > 0) count - 1 - safe else safe
}

internal fun pageStep(index: Int, delta: Int, count: Int, spread: String): Int {
    val step = if (spread == "double") 2 else 1
    return safePage(index + delta * step, count)
}

/** Step across stitched page groups; `page` is still an index into the flat URL list. */
internal fun pageStepGroups(page: Int, delta: Int, groups: List<List<Int>>, spread: String): Int {
    if (groups.isEmpty()) return 0
    val step = if (spread == "double") 2 else 1
    val next = (groupIndexForPage(groups, page) + delta * step).coerceIn(0, groups.lastIndex)
    return groups[next].first()
}

internal fun tapZone(x: Float, y: Float, width: Float, height: Float): String {
    if (height > 0f && y / height < 0.18f) return "top"
    if (width <= 0f) return "mid"
    val nx = x / width
    if (nx < 0.33f) return "left"
    if (nx > 0.67f) return "right"
    return "mid"
}

/**
 * Sources sometimes split one print page into a tall body and a stub footer.
 * Glue a short image onto the previous group when it is under 35% of that
 * group's lead height — normal pages stay separate; spreads of similar height
 * stay separate.
 */
internal fun stitchPageGroups(heights: List<Int>): List<List<Int>> {
    if (heights.isEmpty()) return emptyList()
    val groups = mutableListOf<MutableList<Int>>()
    for (i in heights.indices) {
        val h = heights[i]
        val prev = groups.lastOrNull()
        val lead = prev?.firstOrNull()?.let { heights[it] } ?: 0
        if (prev != null && lead > 0 && h > 0 && h < lead * 0.35) prev.add(i)
        else groups.add(mutableListOf(i))
    }
    return groups
}

internal fun groupIndexForPage(groups: List<List<Int>>, page: Int): Int {
    if (groups.isEmpty()) return 0
    val at = groups.indexOfFirst { page in it }
    return if (at >= 0) at else 0
}

internal fun isBufferedSeek(targetMs: Long, bufferedStartMs: Long, bufferedEndMs: Long): Boolean =
    targetMs in bufferedStartMs..bufferedEndMs

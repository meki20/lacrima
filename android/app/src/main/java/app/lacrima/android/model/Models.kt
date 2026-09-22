package app.lacrima.android.model

import org.json.JSONArray
import org.json.JSONObject

enum class MediaKind {
    ANIME, MANGA, NOVEL;

    val wire: String get() = name.lowercase()

    companion object { fun from(value: String) = entries.firstOrNull { it.wire == value } ?: ANIME }
}

data class Media(
    val id: Int,
    val via: String,
    val kind: MediaKind,
    val title: String,
    val aliases: List<String> = emptyList(),
    val cover: String? = null,
    val banner: String? = null,
    val color: String? = null,
    val description: String? = null,
    val genres: List<String> = emptyList(),
    val units: Int? = null,
    val unitLabel: String = "",
    val unitMinutes: Int? = null,
    val score: Int? = null,
    val pip: String? = null,
    val progress: Float? = null,
    val href: String? = null,
    val detail: String? = null,
)

data class Rail(val title: String, val items: List<Media>)
data class Served<T>(val data: T, val via: String, val degraded: Boolean)
data class HomeCatalog(
    val hero: Media?,
    val popularAnime: List<Media>,
    val popularManga: List<Media>,
    val novels: List<Media>,
    val forYou: List<Media>,
)

data class HomeData(
    val continueItems: List<Media>,
    val catalogResult: ApiResult<Served<HomeCatalog>>,
    val sourceHealthResult: ApiResult<SourceHealth>,
) {
    val hero: Media? get() = (catalogResult as? ApiResult.Success)?.data?.data?.hero
    val degradedVia: String? get() = (catalogResult as? ApiResult.Success)?.data?.takeIf { it.degraded }?.via
    val rails: List<Rail> get() = buildList {
        if (continueItems.isNotEmpty()) add(Rail("Continue", continueItems))
        val catalog = (catalogResult as? ApiResult.Success)?.data?.data ?: return@buildList
        if (catalog.popularAnime.isNotEmpty()) add(Rail("Popular this week", catalog.popularAnime))
        if (catalog.forYou.isNotEmpty()) add(Rail("Because you might like it", catalog.forYou))
        if (catalog.popularManga.isNotEmpty()) add(Rail("Popular manga", catalog.popularManga))
        if (catalog.novels.isNotEmpty()) add(Rail("Top novels", catalog.novels))
    }
}

data class BrowseData(
    val kind: MediaKind,
    val rails: List<Rail>,
    val grid: List<Media>,
    val hasMore: Boolean,
    val providerVia: String,
    val degradedVia: String? = null,
)

data class SearchData(
    val query: String,
    val groups: List<Rail>,
    val providerVia: String = "",
    val degradedVia: String? = null,
)

data class Profile(
    val id: Int,
    val name: String,
    val avatarColor: String = "#630E19",
    val accent: String = "#630E19",
    val wallpaper: String? = null,
    val createdAt: Long = 0,
    val hasPin: Boolean = false,
)

data class Capabilities(
    val anime: Boolean, val manga: Boolean, val novels: Boolean, val profiles: Boolean,
    val sourceManagement: Boolean, val stickers: Boolean, val downloads: Boolean,
)

data class SourceInfo(
    val id: String,
    val name: String,
    val lang: String,
    val iconUrl: String?,
    val kind: MediaKind,
    val isLocal: Boolean,
    val enabled: Boolean = true,
)

data class SourceHealth(
    val total: Int = 0,
    val counts: Map<MediaKind, Int> = emptyMap(),
    val sources: List<SourceInfo> = emptyList(),
    val detail: String = "",
) {
    val state: String get() = if (detail.isBlank()) "ok" else "down"
    val label: String get() = "$total ${if (total == 1) "source" else "sources"}"
}

data class Settings(
    val audioLang: String = "ja",
    val subtitleLang: String = "auto",
    val captionScale: Float = 1f,
    val readerMode: String = "paged",
    val readerRtl: Boolean = true,
    val readerFit: String = "height",
    val readerSpread: String = "single",
)

data class Bootstrap(
    val profiles: List<Profile>,
    val selectedProfile: Profile?,
    val settings: Settings?,
    val sourceHealthResult: ApiResult<SourceHealth>,
    val serverVersion: String,
    val apiVersion: Int,
    val capabilities: Capabilities,
) {
    val health: SourceHealth get() = when (sourceHealthResult) {
        is ApiResult.Success -> sourceHealthResult.data
        is ApiResult.Failure -> SourceHealth(detail = sourceHealthResult.message)
    }
}

data class LibraryItem(
    val media: Media,
    val status: String,
    val rating: Int? = null,
    val pinned: Boolean = false,
    val addedAt: Long = 0,
    val unit: Double? = null,
    val href: String? = null,
) {
    val score: Int? get() = rating
    val pin: Int get() = if (pinned) 1 else 0
}

data class ProfileFacts(
    val titles: Int, val chapters: Double, val episodes: Double, val hours: Double,
    val watchedSeconds: Double, val streak: Int,
)
data class MixShare(val kind: MediaKind, val label: String, val count: Int, val percent: Int)
data class LibraryData(
    val items: List<LibraryItem>,
    val total: Int,
    val shelf: List<LibraryItem>,
    val genres: List<String>,
    val facts: ProfileFacts,
    val monthMix: List<MixShare>,
    val stickersEarned: Int,
)

data class Chapter(
    val id: String,
    val name: String,
    val number: Double? = null,
    val scanlator: String? = null,
    val uploadedAt: Long? = null,
    val pageCount: Int? = null,
    val season: Int? = null,
    val thumbnailUrl: String? = null,
    val overview: String? = null,
)

data class Binding(
    val sourceName: String,
    val sourceTitle: String,
    val confidence: Double,
    val pinned: Boolean,
    val sourceId: String = "",
    val sourceMangaId: String = "",
    val backend: String = "",
    val kind: MediaKind = MediaKind.MANGA,
)
data class SourceCandidate(
    val id: String,
    val sourceId: String,
    val sourceName: String,
    val title: String,
    val thumbnailUrl: String?,
    val chapterCount: Int?,
    val confidence: Double,
)
data class Resolution(
    val binding: Binding?,
    val candidates: List<SourceCandidate>,
    val tier: String,
    val failures: List<String>,
)
data class SeriesPart(val id: Int, val title: String, val label: String, val kind: String)
data class SeriesData(val rootId: Int, val title: String, val parts: List<SeriesPart>, val specials: List<SeriesPart>)
data class CanonicalTitle(val via: String, val kind: MediaKind, val id: Int, val part: Int)
data class SelectedPart(
    val id: Int,
    val part: SeriesPart?,
    val specials: Boolean,
    val episodeOffset: Int,
    val episodeCount: Int?,
    val seasonHint: Int?,
)

sealed interface ProgressAnchor {
    data class Seconds(
        val at: Double, val chapterId: String, val chapterName: String,
        val duration: Double? = null, val season: Int? = null, val episode: Int? = null,
    ) : ProgressAnchor
    data class Page(
        val index: Int, val chapterId: String, val chapterName: String, val pages: Int? = null,
    ) : ProgressAnchor
    data class Paragraph(val cfi: String, val chapterId: String? = null, val chapterName: String? = null) : ProgressAnchor
}

data class Progress(
    val profileId: Int,
    val via: String,
    val mediaId: Int,
    val kind: MediaKind,
    val unit: Double,
    val anchor: ProgressAnchor?,
    val title: String?,
    val cover: String?,
    val updatedAt: Long,
    val watchedSeconds: Double,
)
data class Resume(val chapterId: String, val anchor: ProgressAnchor?)
data class ProgressSeriesPart(val mediaId: Int, val title: String, val cover: String?, val units: Int)
data class ProgressTree(val seriesParts: List<ProgressSeriesPart>, val partIndex: Int?)
data class TitleData(
    val media: Media,
    val selectedMedia: Media,
    val heading: String,
    val canonical: CanonicalTitle?,
    val seriesResult: ApiResult<SeriesData>,
    val selected: SelectedPart,
    val resolutionResult: ApiResult<Resolution>?,
    val chaptersResult: ApiResult<List<Chapter>>?,
    val progress: Progress?,
    val library: LibraryItem?,
    val resume: Resume?,
    val progressTree: ProgressTree,
) {
    val parts: List<Media> get() = (seriesResult as? ApiResult.Success)?.data?.parts.orEmpty().map {
        selectedMedia.copy(id = it.id, title = it.title)
    }
    val chapters: List<Chapter> get() = (chaptersResult as? ApiResult.Success)?.data.orEmpty()
    val binding: Binding? get() = (resolutionResult as? ApiResult.Success)?.data?.binding
    val candidates: List<SourceCandidate> get() = (resolutionResult as? ApiResult.Success)?.data?.candidates.orEmpty()
    val failures: List<String> get() = (resolutionResult as? ApiResult.Success)?.data?.failures.orEmpty()
    val matchTier: String get() = (resolutionResult as? ApiResult.Success)?.data?.tier ?: "none"
    val resumeChapterId: String? get() = resume?.chapterId
}

data class SourceRepo(
    val indexUrl: String, val name: String?, val kind: MediaKind,
    val isLegacy: Boolean, val extensionCount: Int,
)
data class SourceExtension(
    val pkgName: String, val name: String, val lang: String, val version: String,
    val iconUrl: String?, val isInstalled: Boolean, val hasUpdate: Boolean, val kind: MediaKind,
)
data class ExtensionsData(val extensions: List<SourceExtension>, val total: Int, val truncated: Boolean)
data class SourceAdminData(
    val kind: MediaKind,
    val sources: List<SourceInfo>,
    val repos: List<SourceRepo>,
    val extensions: List<SourceExtension>,
    val total: Int,
    val truncated: Boolean,
)
data class SourceToggle(val id: String, val kind: MediaKind, val enabled: Boolean)
data class RepoAddResult(val indexUrl: String, val kind: MediaKind, val refreshed: ApiResult<Int>)

data class Sticker(val id: String, val name: String, val secret: Boolean, val earned: Boolean, val src: String?)
data class StickerGroup(val title: String, val stickers: List<Sticker>)
data class StickerSlot(
    val id: String, val name: String, val image: String?, val secret: Boolean,
    val earned: Boolean, val src: String?,
)
data class TitleStickers(
    val via: String, val id: Int, val kind: MediaKind, val title: String, val href: String,
    val watched: Double, val earned: Int, val slots: List<StickerSlot>,
)
data class StickersData(val collection: List<TitleStickers>, val earned: List<StickerGroup>, val earnedCount: Int)
data class StickerPlacement(
    val id: Int, val stickerId: String, val path: String, val x: Double, val y: Double,
    val scale: Double, val rot: Double, val name: String, val src: String,
)

sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>
    data class Failure(val code: String, val message: String, val lastSuccess: Long? = null) : ApiResult<Nothing>
}

internal fun JSONObject.stringOrNull(name: String): String? =
    if (has(name) && !isNull(name)) optString(name).takeIf { it.isNotBlank() } else null
internal fun JSONObject.wireString(vararg names: String): String {
    for (name in names) {
        if (!has(name) || isNull(name)) continue
        when (val value = opt(name)) {
            is Number -> return value.toString()
            is String -> if (value.isNotBlank() && value != "null") return value
            else -> value?.toString()?.takeIf { it.isNotBlank() && it != "null" }?.let { return it }
        }
    }
    return ""
}
internal fun JSONObject.intOrNull(name: String): Int? = if (has(name) && !isNull(name)) optInt(name) else null
internal fun JSONObject.longOrNull(name: String): Long? = if (has(name) && !isNull(name)) optLong(name) else null
internal fun JSONObject.doubleOrNull(name: String): Double? =
    if (has(name) && !isNull(name)) optDouble(name).takeUnless { it.isNaN() } else null
internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
internal fun JSONArray.strings(): List<String> = (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }

fun JSONObject.toMedia(): Media = Media(
    id = optInt("id"),
    via = optString("via", "anilist"),
    kind = MediaKind.from(optString("kind", optString("media_type", "anime"))),
    title = optString("title", "Untitled"),
    aliases = optJSONArray("aliases")?.strings().orEmpty(),
    cover = stringOrNull("cover"), banner = stringOrNull("banner"), color = stringOrNull("color"),
    description = stringOrNull("description"), genres = optJSONArray("genres")?.strings().orEmpty(),
    units = intOrNull("units"), unitLabel = optString("unitLabel", optString("unit_label", "")),
    unitMinutes = intOrNull("unitMinutes"), score = intOrNull("score"), pip = stringOrNull("pip"),
    progress = doubleOrNull("progress")?.toFloat() ?: doubleOrNull("ratio")?.toFloat(),
    href = stringOrNull("href"), detail = stringOrNull("detail"),
)

fun JSONObject.toProfile(): Profile = Profile(
    id = optInt("id"), name = optString("name", "Profile"),
    avatarColor = optString("avatarColor", optString("avatar_color", "#630E19")),
    accent = optString("accent", "#630E19"), wallpaper = stringOrNull("wallpaper"),
    createdAt = optLong("createdAt", optLong("created_at", 0)),
    hasPin = optBoolean("hasPin", optBoolean("has_pin", false)),
)

fun JSONObject.toSettings() = Settings(
    audioLang = optString("audioLang", optString("audio_lang", "ja")),
    subtitleLang = optString("subtitleLang", optString("subtitle_lang", "auto")),
    captionScale = optDouble("captionScale", optDouble("caption_scale", 1.0)).toFloat(),
    readerMode = optString("readerMode", optString("reader_mode", "paged")),
    readerRtl = optBoolean("readerRtl", optInt("reader_rtl", 1) != 0),
    readerFit = optString("readerFit", optString("reader_fit", "height")),
    readerSpread = optString("readerSpread", optString("reader_spread", "single")),
)

fun JSONObject.toSourceInfo() = SourceInfo(
    id = wireString("id"), name = optString("name", "Source"), lang = optString("lang", "all"),
    iconUrl = stringOrNull("iconUrl"), kind = MediaKind.from(optString("kind")),
    isLocal = optBoolean("isLocal"), enabled = optBoolean("enabled", true),
)

fun JSONObject.toHealth() = SourceHealth(
    total = optInt("total"),
    counts = MediaKind.entries.associateWith { optJSONObject("counts")?.optInt(it.wire) ?: 0 },
    sources = optJSONArray("sources")?.objects()?.map(JSONObject::toSourceInfo).orEmpty(),
)

fun JSONObject.toLibraryItem(): LibraryItem {
    val mediaJson = optJSONObject("media") ?: this
    return LibraryItem(
        media = mediaJson.toMedia(), status = optString("status", "reading"),
        rating = intOrNull("score") ?: intOrNull("rating"),
        pinned = optInt("pin", if (optBoolean("pinned")) 1 else 0) > 0,
        addedAt = optLong("addedAt", optLong("added_at", 0)), unit = doubleOrNull("unit"),
        href = stringOrNull("href"),
    )
}

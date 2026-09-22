package app.lacrima.android.data

import app.lacrima.android.model.*
import org.json.JSONArray
import org.json.JSONObject

class LacrimaRepository(private val api: ApiClient) {
    fun bootstrap(): ApiResult<Bootstrap> = api.get("bootstrap").mapObject { root ->
        val caps = root.objectOrEmpty("capabilities")
        Bootstrap(
            profiles = root.array("profiles").objects().map(JSONObject::toProfile),
            selectedProfile = root.optJSONObject("selectedProfile")?.toProfile(),
            settings = root.optJSONObject("settings")?.toSettings(),
            sourceHealthResult = root.objectOrEmpty("sourceHealth").embedded { value ->
                (value as? JSONObject ?: error("Health data is not an object.")).toHealth()
            },
            serverVersion = root.optJSONObject("server")?.optString("version").orEmpty(),
            apiVersion = root.optInt("apiVersion"),
            capabilities = Capabilities(
                anime = caps.optBoolean("anime"), manga = caps.optBoolean("manga"),
                novels = caps.optBoolean("novels"), profiles = caps.optBoolean("profiles"),
                sourceManagement = caps.optBoolean("sourceManagement"), stickers = caps.optBoolean("stickers"),
                downloads = caps.optBoolean("downloads"),
            ),
        )
    }

    fun home(): ApiResult<HomeData> = api.get("home").mapObject { root ->
        HomeData(
            continueItems = root.array("continue").media(),
            catalogResult = root.objectOrEmpty("catalog").embedded { value ->
                val served = value as? JSONObject ?: error("Catalog data is not an object.")
                served.toServed { catalog ->
                    HomeCatalog(
                        hero = catalog.optJSONObject("hero")?.toMedia(),
                        popularAnime = catalog.array("popularAnime").media(),
                        popularManga = catalog.array("popularManga").media(),
                        novels = catalog.array("novels").media(),
                        forYou = catalog.array("forYou").media(),
                    )
                }
            },
            sourceHealthResult = root.objectOrEmpty("sourceHealth").embedded { value ->
                (value as? JSONObject ?: error("Health data is not an object.")).toHealth()
            },
        )
    }

    fun browse(kind: MediaKind, genre: String?, page: Int): ApiResult<BrowseData> {
        val query = buildList {
            genre?.let { add("genre=${ApiClient.encode(it)}") }
            add("page=$page")
        }.joinToString("&")
        return api.get("browse/${kind.wire}?$query").mapObject { served ->
            val payload = served.objectOrEmpty("data")
            val rails = buildList {
                addRail("Popular now", payload.array("popular"))
                payload.array("rails").objects().forEach {
                    add(Rail(it.optString("genre", "Browse"), it.array("items").media()))
                }
                addRail("Recommended", payload.array("recommended"))
                addRail("Recently added", payload.array("recent"))
            }
            val via = served.optString("via")
            BrowseData(
                kind = kind, rails = rails, grid = payload.array("grid").media(),
                hasMore = payload.optBoolean("hasMore"), providerVia = via,
                degradedVia = via.takeIf { served.optBoolean("degraded") },
            )
        }
    }

    fun search(query: String): ApiResult<SearchData> =
        api.get("search?q=${ApiClient.encode(query)}").mapObject { served ->
            val payload = served.objectOrEmpty("data")
            val via = served.optString("via")
            SearchData(
                query = query,
                groups = listOf(
                    Rail("Anime", payload.array("anime").media()),
                    Rail("Manga", payload.array("manga").media()),
                    Rail("Novels", payload.array("novels").media()),
                ).filter { it.items.isNotEmpty() },
                providerVia = via,
                degradedVia = via.takeIf { served.optBoolean("degraded") },
            )
        }

    fun title(
        media: Media,
        part: String? = null,
        change: Boolean = false,
        sourceQuery: String? = null,
    ): ApiResult<TitleData> {
        val query = buildList {
            part?.let { add("part=${ApiClient.encode(it)}") }
            if (change) add("change=1")
            sourceQuery?.trim()?.takeIf(String::isNotEmpty)?.let { add("sourceQuery=${ApiClient.encode(it)}") }
        }.joinToString("&").let { if (it.isEmpty()) "" else "?$it" }
        return api.get("titles/${ApiClient.encode(media.via)}/${media.kind.wire}/${media.id}$query")
            .mapObject(::parseTitle)
    }

    fun bindTitle(media: Media, candidate: SourceCandidate): ApiResult<Binding> = api.put(
        "titles/${ApiClient.encode(media.via)}/${media.kind.wire}/${media.id}/binding",
        JSONObject().put("sourceId", candidate.sourceId).put("sourceTitle", candidate.title)
            .put("sourceMangaId", candidate.id).put("confidence", candidate.confidence),
    ).mapObject { it.objectOrEmpty("binding").toBinding(candidate.sourceName) }

    fun refreshChapters(media: Media): ApiResult<List<Chapter>> = api.post(
        "titles/${ApiClient.encode(media.via)}/${media.kind.wire}/${media.id}/chapters/refresh",
        JSONObject(),
    ).mapArray { it.objects().map(JSONObject::toChapter) }

    fun library(
        kind: MediaKind? = null,
        status: String? = null,
        genre: String? = null,
        sort: String? = null,
        query: String? = null,
    ): ApiResult<LibraryData> {
        val params = buildList {
            kind?.let { add("kind=${it.wire}") }
            status?.let { add("status=${ApiClient.encode(it)}") }
            genre?.let { add("genre=${ApiClient.encode(it)}") }
            sort?.let { add("sort=${ApiClient.encode(it)}") }
            query?.let { add("q=${ApiClient.encode(it)}") }
        }.joinToString("&").let { if (it.isEmpty()) "" else "?$it" }
        return api.get("library$params").mapObject(JSONObject::toLibraryData)
    }

    fun updateLibrary(media: Media, status: String, rating: Int?, pinned: Boolean): ApiResult<LibraryItem> {
        val body = media.libraryJson().put("status", status).put("score", rating ?: JSONObject.NULL).put("pin", pinned)
        return api.put("library", body).mapObject {
            it.optJSONObject("entry")?.toLibraryItem() ?: error("Library entry is missing.")
        }
    }

    fun deleteLibrary(media: Media): ApiResult<Unit> = api.delete(
        "library",
        JSONObject().put("via", media.via).put("id", media.id).put("kind", media.kind.wire),
    ).mapObject {
        check(it.has("entry") && it.isNull("entry")) { "The server did not confirm removal." }
    }

    fun removeHistory(media: Media): ApiResult<Unit> = api.put(
        "library",
        JSONObject().put("via", media.via).put("id", media.id).put("kind", media.kind.wire).put("removeHistory", true),
    ).mapObject {
        check(it.has("entry") && it.isNull("entry")) { "The server did not confirm history removal." }
    }

    fun progress(via: String, mediaId: Int): ApiResult<Progress?> =
        api.get("progress?via=${ApiClient.encode(via)}&mediaId=$mediaId").mapObject {
            it.optJSONObject("progress")?.toProgress()
        }

    fun writeProgress(
        media: Media,
        chapter: Chapter,
        unit: Int,
        skipAhead: Boolean = false,
        exact: Boolean = false,
        seriesParts: List<ProgressSeriesPart> = emptyList(),
        partIndex: Int? = null,
    ): ApiResult<Any> {
        val body = JSONObject().apply {
            put("via", media.via)
            put("mediaId", media.id)
            put("kind", media.kind.wire)
            put("title", media.title)
            put("cover", media.cover)
            put("unit", unit)
            put("chapterId", chapter.id)
            put("chapterName", chapter.name)
            chapter.pageCount?.let { put("pages", it) }
            chapter.season?.let { put("season", it) }
            chapter.number?.let { put("episode", it) }
            media.unitMinutes?.let { put("durationSeconds", it * 60) }
            partIndex?.let { put("partIndex", it) }
            if (seriesParts.isNotEmpty()) {
                put("seriesParts", JSONArray(seriesParts.map {
                    JSONObject().apply {
                        put("mediaId", it.mediaId)
                        put("title", it.title)
                        put("cover", it.cover)
                        put("units", it.units)
                    }
                }))
            }
            if (skipAhead) put("skipAhead", true)
            if (exact) put("exact", true)
            put("anchor", when (media.kind) {
                MediaKind.ANIME -> JSONObject().apply {
                    put("kind", "seconds")
                    put("at", 0)
                    put("chapterId", chapter.id)
                    put("chapterName", chapter.name)
                    chapter.season?.takeIf { it > 0 }?.let { put("season", it) }
                    chapter.number?.takeIf { it > 0 }?.let { put("episode", it) }
                }
                MediaKind.NOVEL -> JSONObject().apply {
                    put("kind", "paragraph")
                    put("cfi", "0")
                    put("chapterId", chapter.id)
                    put("chapterName", chapter.name)
                }
                MediaKind.MANGA -> JSONObject().apply {
                    put("kind", "page")
                    put("index", 0)
                    put("chapterId", chapter.id)
                    put("chapterName", chapter.name)
                    chapter.pageCount?.let { put("pages", it) }
                }
            })
        }
        return api.put("progress", body)
    }

    fun reorderShelf(items: List<Media>): ApiResult<Unit> = api.put(
        "library",
        JSONObject().put("reorder", JSONArray(items.map { JSONObject().put("via", it.via).put("id", it.id) })),
    ).mapAny { Unit }

    fun settings(): ApiResult<Settings> = api.get("settings").mapObject {
        it.objectOrEmpty("settings").toSettings()
    }

    fun updateSettings(settings: Settings): ApiResult<Settings> = api.patch("settings", settings.json()).mapObject {
        it.objectOrEmpty("settings").toSettings()
    }

    fun profiles(): ApiResult<List<Profile>> = api.get("profiles").mapObject {
        it.array("profiles").objects().map(JSONObject::toProfile)
    }

    fun createProfile(name: String, accent: String? = null): ApiResult<Profile> {
        val body = JSONObject().put("name", name)
        accent?.let { body.put("accent", it) }
        return api.post("profiles", body).mapObject {
            it.optJSONObject("profile")?.toProfile() ?: error("Created profile is missing.")
        }
    }

    fun updateProfile(
        name: String? = null,
        accent: String? = null,
        avatarColor: String? = null,
        wallpaper: String? = null,
        clearWallpaper: Boolean = false,
    ): ApiResult<Profile> {
        val body = JSONObject()
        name?.let { body.put("name", it) }
        accent?.let { body.put("accent", it) }
        avatarColor?.let { body.put("avatar_color", it) }
        if (clearWallpaper) body.put("wallpaper", JSONObject.NULL) else wallpaper?.let { body.put("wallpaper", it) }
        return api.patch("profiles", body).mapObject {
            it.optJSONObject("profile")?.toProfile() ?: error("Updated profile is missing.")
        }
    }

    fun updateProfile(profile: Profile): ApiResult<Profile> = updateProfile(
        name = profile.name, accent = profile.accent, avatarColor = profile.avatarColor,
        wallpaper = profile.wallpaper, clearWallpaper = profile.wallpaper == null,
    )

    fun deleteProfile(id: Int): ApiResult<Int> = api.delete("profiles", JSONObject().put("id", id)).mapObject {
        it.optInt("deleted").also { deleted -> check(deleted == id) { "The wrong profile was deleted." } }
    }

    fun health(): ApiResult<SourceHealth> = api.get("sources/health").mapObject(JSONObject::toHealth)

    fun sources(kind: MediaKind): ApiResult<List<SourceInfo>> =
        api.get("sources?kind=${kind.wire}").mapObject { it.array("sources").objects().map(JSONObject::toSourceInfo) }

    fun repos(kind: MediaKind): ApiResult<List<SourceRepo>> =
        api.get("sources/repos?kind=${kind.wire}").mapArray { it.objects().map(JSONObject::toSourceRepo) }

    fun extensions(kind: MediaKind, query: String = "", limit: Int = 100): ApiResult<ExtensionsData> {
        val q = if (query.isBlank()) "" else "&q=${ApiClient.encode(query)}"
        return api.get("sources/extensions?kind=${kind.wire}&limit=${limit.coerceIn(1, 200)}$q").mapObject {
            ExtensionsData(
                extensions = it.array("extensions").objects().map(JSONObject::toSourceExtension),
                total = it.optInt("total"), truncated = it.optBoolean("truncated"),
            )
        }
    }

    fun sourceAdmin(kind: MediaKind, query: String = "", limit: Int = 100): ApiResult<SourceAdminData> {
        val sources = sources(kind)
        val repos = repos(kind)
        if (sources is ApiResult.Failure && repos is ApiResult.Failure) return sources
        val listed = if (kind == MediaKind.MANGA && query.isBlank()) {
            ExtensionsData(emptyList(), 0, false)
        } else (extensions(kind, query, limit) as? ApiResult.Success)?.data ?: ExtensionsData(emptyList(), 0, false)
        return ApiResult.Success(
            SourceAdminData(
                kind,
                (sources as? ApiResult.Success)?.data.orEmpty(),
                (repos as? ApiResult.Success)?.data.orEmpty(),
                listed.extensions,
                listed.total,
                listed.truncated,
            ),
        )
    }

    fun setSourceEnabled(kind: MediaKind, id: String, enabled: Boolean): ApiResult<SourceToggle> =
        api.patch("sources", JSONObject().put("kind", kind.wire).put("id", id).put("enabled", enabled))
            .mapObject { SourceToggle(it.optString("id"), MediaKind.from(it.optString("kind")), it.optBoolean("enabled")) }

    fun addRepo(kind: MediaKind, indexUrl: String): ApiResult<RepoAddResult> = api.post(
        "sources/repos", JSONObject().put("kind", kind.wire).put("indexUrl", indexUrl),
    ).mapObject {
        val refreshed = it.optJSONObject("refreshed")
        RepoAddResult(
            indexUrl = it.optString("indexUrl"), kind = MediaKind.from(it.optString("kind")),
            refreshed = refreshed?.embedded { value -> (value as? Number)?.toInt() ?: 0 } ?: ApiResult.Success(0),
        )
    }

    fun removeRepo(kind: MediaKind, indexUrl: String): ApiResult<Boolean> = api.delete(
        "sources/repos", JSONObject().put("kind", kind.wire).put("indexUrl", indexUrl),
    ).mapAny { it == true || it == JSONObject.NULL || it is JSONObject }

    fun refreshRepos(kind: MediaKind): ApiResult<Int> =
        api.post("sources/repos/refresh", JSONObject().put("kind", kind.wire)).mapAny {
            (it as? Number)?.toInt() ?: 0
        }

    fun setExtensionInstalled(kind: MediaKind, pkgName: String, installed: Boolean): ApiResult<Boolean> = api.patch(
        "sources/extensions", JSONObject().put("kind", kind.wire).put("pkgName", pkgName).put("installed", installed),
    ).mapAny { it == true || it is JSONObject }

    fun stickers(): ApiResult<StickersData> = api.get("stickers").mapObject { root ->
        StickersData(
            collection = root.array("collection").objects().map { it.toTitleStickers(api::absolute) },
            earned = root.array("earned").objects().map { group ->
                StickerGroup(
                    title = group.optString("title"),
                    stickers = group.array("stickers").objects().map { it.toSticker(api::absolute) },
                )
            },
            earnedCount = root.optInt("earnedCount"),
        )
    }

    fun toggleSticker(id: String): ApiResult<Sticker> = api.patch("stickers", JSONObject().put("id", id)).mapObject {
        it.optJSONObject("sticker")?.toSticker(api::absolute) ?: error("Sticker is missing.")
    }

    fun placements(path: String, surface: String? = null): ApiResult<List<StickerPlacement>> {
        val query = "path=${ApiClient.encode(path)}" + (surface?.let { "&surface=${ApiClient.encode(it)}" } ?: "")
        return api.get("stickers/placements?$query").mapObject {
            it.array("placements").objects().map { item -> item.toPlacement(api::absolute) }
        }
    }

    fun addPlacement(
        stickerId: String, path: String, x: Double, y: Double,
        scale: Double = 1.0, rot: Double = 0.0, surface: String? = null,
    ): ApiResult<StickerPlacement> {
        val body = JSONObject().put("stickerId", stickerId).put("path", path).put("x", x).put("y", y)
            .put("scale", scale).put("rot", rot)
        surface?.let { body.put("surface", it) }
        return api.post("stickers/placements", body).mapObject {
            it.optJSONObject("placement")?.toPlacement(api::absolute) ?: error("Placement is missing.")
        }
    }

    fun updatePlacement(
        id: Int, x: Double? = null, y: Double? = null, scale: Double? = null,
        rot: Double? = null, path: String? = null,
    ): ApiResult<StickerPlacement> {
        val body = JSONObject().put("id", id)
        x?.let { body.put("x", it) }; y?.let { body.put("y", it) }; scale?.let { body.put("scale", it) }
        rot?.let { body.put("rot", it) }; path?.let { body.put("path", it) }
        return api.patch("stickers/placements", body).mapObject {
            it.optJSONObject("placement")?.toPlacement(api::absolute) ?: error("Placement is missing.")
        }
    }

    fun deletePlacement(id: Int): ApiResult<Int> =
        api.delete("stickers/placements", JSONObject().put("id", id)).mapObject { it.optInt("deleted") }

    private fun MutableList<Rail>.addRail(title: String, array: JSONArray) {
        val items = array.media()
        if (items.isNotEmpty()) add(Rail(title, items))
    }
}

internal fun parseTitle(root: JSONObject): TitleData {
    val baseMedia = root.optJSONObject("media")?.toMedia() ?: error("Title media is missing.")
    val selectedMedia = root.optJSONObject("selectedMedia")?.toMedia() ?: baseMedia
    val selectedJson = root.objectOrEmpty("selected")
    val progress = root.optJSONObject("progress")?.toProgress()
    val resumeJson = root.optJSONObject("resume")
    val tree = root.objectOrEmpty("progressTree")
    return TitleData(
        media = baseMedia,
        selectedMedia = selectedMedia,
        heading = root.optString("heading", selectedMedia.title),
        canonical = root.optJSONObject("canonical")?.let {
            CanonicalTitle(it.optString("via"), MediaKind.from(it.optString("kind")), it.optInt("id"), it.optInt("part"))
        },
        seriesResult = root.objectOrEmpty("series").embedded { value ->
            (value as? JSONObject ?: error("Series data is not an object.")).toSeries()
        },
        selected = SelectedPart(
            id = selectedJson.optInt("id", selectedMedia.id),
            part = selectedJson.optJSONObject("part")?.toSeriesPart(),
            specials = selectedJson.optBoolean("specials"),
            episodeOffset = selectedJson.optInt("episodeOffset"),
            episodeCount = selectedJson.intOrNull("episodeCount"),
            seasonHint = selectedJson.intOrNull("seasonHint"),
        ),
        resolutionResult = root.optJSONObject("resolution")?.embedded { value ->
            (value as? JSONObject ?: error("Resolution data is not an object.")).toResolution()
        },
        chaptersResult = root.optJSONObject("chapters")?.embedded { value ->
            (value as? JSONArray ?: error("Chapter data is not an array.")).objects().map(JSONObject::toChapter)
        },
        progress = progress,
        library = root.optJSONObject("library")?.toLibraryItem(),
        resume = resumeJson?.let { Resume(it.optString("chapterId"), it.optJSONObject("anchor")?.toAnchor()) },
        progressTree = ProgressTree(
            seriesParts = tree.array("seriesParts").objects().map {
                ProgressSeriesPart(it.optInt("mediaId"), it.optString("title"), it.stringOrNull("cover"), it.optInt("units"))
            },
            partIndex = tree.intOrNull("partIndex"),
        ),
    )
}

private fun JSONObject.toServed(parse: (JSONObject) -> HomeCatalog): Served<HomeCatalog> =
    Served(parse(objectOrEmpty("data")), optString("via"), optBoolean("degraded"))

private fun JSONObject.toSeries() = SeriesData(
    rootId = optInt("rootId"), title = optString("title"),
    parts = array("parts").objects().map(JSONObject::toSeriesPart),
    specials = array("specials").objects().map(JSONObject::toSeriesPart),
)

private fun JSONObject.toSeriesPart() = SeriesPart(
    id = optInt("id"), title = optString("title"), label = optString("label"), kind = optString("kind", "part"),
)

private fun JSONObject.toResolution() = Resolution(
    binding = optJSONObject("binding")?.toBinding(),
    candidates = array("candidates").objects().map { scored ->
        val manga = scored.objectOrEmpty("manga")
        SourceCandidate(
            id = manga.wireString("id"), sourceId = manga.wireString("sourceId", "source_id"),
            sourceName = manga.wireString("sourceName", "source_name").ifBlank { "Source" },
            title = manga.wireString("title"),
            thumbnailUrl = manga.stringOrNull("thumbnailUrl"), chapterCount = manga.intOrNull("chapterCount"),
            confidence = scored.optDouble("confidence"),
        )
    },
    tier = optString("tier", "none"), failures = array("failures").strings(),
)

private fun JSONObject.toBinding(fallbackName: String = "") = Binding(
    sourceName = wireString("sourceName").ifBlank {
        fallbackName.ifBlank { wireString("source_title", "sourceTitle", "source_id", "sourceId").ifBlank { "Source" } }
    },
    sourceTitle = wireString("sourceTitle", "source_title"),
    confidence = optDouble("confidence"), pinned = optBoolean("pinned", optInt("pinned") > 0),
    sourceId = wireString("sourceId", "source_id"),
    sourceMangaId = wireString("sourceMangaId", "source_manga_id"),
    backend = wireString("backend"), kind = MediaKind.from(optString("kind")),
)

private fun JSONObject.toChapter() = Chapter(
    id = wireString("id"), name = optString("name").ifBlank { "Chapter ${wireString("number")}" },
    number = doubleOrNull("number"), scanlator = stringOrNull("scanlator"),
    uploadedAt = longOrNull("uploadDate") ?: longOrNull("uploadedAt"),
    pageCount = intOrNull("pageCount"), season = intOrNull("season"),
    thumbnailUrl = stringOrNull("thumbnailUrl"), overview = stringOrNull("overview"),
)

private fun JSONObject.toAnchor(): ProgressAnchor? = when (optString("kind")) {
    "seconds" -> ProgressAnchor.Seconds(
        at = optDouble("at"), chapterId = optString("chapterId"), chapterName = optString("chapterName"),
        duration = doubleOrNull("duration"), season = intOrNull("season"), episode = intOrNull("episode"),
    )
    "page" -> ProgressAnchor.Page(
        index = optInt("index"), chapterId = optString("chapterId"), chapterName = optString("chapterName"),
        pages = intOrNull("pages"),
    )
    "paragraph" -> ProgressAnchor.Paragraph(optString("cfi"), stringOrNull("chapterId"), stringOrNull("chapterName"))
    else -> null
}

private fun JSONObject.toProgress() = Progress(
    profileId = optInt("profile_id", optInt("profileId")), via = optString("via"),
    mediaId = optInt("media_id", optInt("mediaId")),
    kind = MediaKind.from(optString("media_type", optString("kind"))), unit = optDouble("unit"),
    anchor = optJSONObject("anchor")?.toAnchor(), title = stringOrNull("title"), cover = stringOrNull("cover"),
    updatedAt = optLong("updated_at", optLong("updatedAt")),
    watchedSeconds = optDouble("watched_seconds", optDouble("watchedSeconds")),
)

private fun JSONObject.toLibraryData(): LibraryData {
    val facts = objectOrEmpty("facts")
    return LibraryData(
        items = array("items").objects().map(JSONObject::toLibraryItem), total = optInt("total"),
        shelf = array("shelf").objects().map(JSONObject::toLibraryItem), genres = array("genres").strings(),
        facts = ProfileFacts(
            facts.optInt("titles"), facts.optDouble("chapters"), facts.optDouble("episodes"),
            facts.optDouble("hours"), facts.optDouble("watchedSeconds"), facts.optInt("streak"),
        ),
        monthMix = array("monthMix").objects().map {
            MixShare(MediaKind.from(it.optString("kind")), it.optString("label"), it.optInt("n"), it.optInt("pct"))
        },
        stickersEarned = optInt("stickersEarned"),
    )
}

private fun JSONObject.toSourceRepo() = SourceRepo(
    indexUrl = optString("indexUrl"), name = stringOrNull("name"), kind = MediaKind.from(optString("kind")),
    isLegacy = optBoolean("isLegacy"), extensionCount = optInt("extensionCount"),
)

private fun JSONObject.toSourceExtension() = SourceExtension(
    pkgName = optString("pkgName"), name = optString("name"), lang = optString("lang"),
    version = optString("version"), iconUrl = stringOrNull("iconUrl"),
    isInstalled = optBoolean("isInstalled"), hasUpdate = optBoolean("hasUpdate"),
    kind = MediaKind.from(optString("kind")),
)

private fun JSONObject.toSticker(link: (String) -> String = { it }) = Sticker(
    id = optString("id"), name = optString("name"), secret = optBoolean("secret"),
    earned = optBoolean("earned"), src = stringOrNull("src")?.let(link),
)

private fun JSONObject.toStickerSlot(link: (String) -> String = { it }) = StickerSlot(
    id = optString("id"), name = optString("name"), image = stringOrNull("image"),
    secret = optBoolean("secret"), earned = optBoolean("earned"), src = stringOrNull("src")?.let(link),
)

private fun JSONObject.toTitleStickers(link: (String) -> String = { it }) = TitleStickers(
    via = optString("via"), id = optInt("id"), kind = MediaKind.from(optString("kind")),
    title = optString("title"), href = optString("href"), watched = optDouble("watched"),
    earned = optInt("earned"), slots = array("slots").objects().map { it.toStickerSlot(link) },
)

private fun JSONObject.toPlacement(link: (String) -> String = { it }) = StickerPlacement(
    id = optInt("id"), stickerId = optString("stickerId"), path = optString("path"),
    x = optDouble("x"), y = optDouble("y"), scale = optDouble("scale", 1.0), rot = optDouble("rot"),
    name = optString("name"), src = link(optString("src")),
)

private fun Media.libraryJson() = JSONObject()
    .put("via", via).put("id", id).put("kind", kind.wire).put("title", title)
    .put("cover", cover ?: JSONObject.NULL).put("color", color ?: JSONObject.NULL)
    .put("units", units ?: JSONObject.NULL).put("genres", JSONArray(genres))

private fun Settings.json() = JSONObject()
    .put("audio_lang", audioLang).put("subtitle_lang", subtitleLang).put("caption_scale", captionScale)
    .put("reader_mode", readerMode).put("reader_rtl", if (readerRtl) 1 else 0)
    .put("reader_fit", readerFit).put("reader_spread", readerSpread)

private fun JSONObject.array(name: String): JSONArray = optJSONArray(name) ?: JSONArray()
private fun JSONObject.objectOrEmpty(name: String): JSONObject = optJSONObject(name) ?: JSONObject()
private fun JSONArray.media(): List<Media> = objects().map(JSONObject::toMedia)

private inline fun <T> JSONObject.embedded(parse: (Any) -> T): ApiResult<T> {
    if (!optBoolean("ok")) {
        val error = optJSONObject("error")
        return ApiResult.Failure(
            error?.optString("code")?.takeIf(String::isNotBlank) ?: "upstream_unavailable",
            error?.optString("message")?.takeIf(String::isNotBlank) ?: "The source is unavailable.",
            error?.longOrNull("lastSuccess"),
        )
    }
    return runCatching { ApiResult.Success(parse(opt("data"))) }.getOrElse {
        ApiResult.Failure("invalid_response", it.message ?: "The server response did not match this client.")
    }
}

private inline fun <T> ApiResult<Any>.mapAny(block: (Any) -> T): ApiResult<T> = when (this) {
    is ApiResult.Success -> runCatching { ApiResult.Success(block(data)) }.getOrElse {
        ApiResult.Failure("invalid_response", it.message ?: "The server response did not match this client.")
    }
    is ApiResult.Failure -> this
}

private inline fun <T> ApiResult<Any>.mapObject(block: (JSONObject) -> T): ApiResult<T> =
    mapAny { block(it as? JSONObject ?: error("Expected an object.")) }

private inline fun <T> ApiResult<Any>.mapArray(block: (JSONArray) -> T): ApiResult<T> =
    mapAny { block(it as? JSONArray ?: error("Expected an array.")) }

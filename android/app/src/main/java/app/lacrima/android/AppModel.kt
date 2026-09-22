package app.lacrima.android

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.lacrima.android.data.*
import app.lacrima.android.model.*
import app.lacrima.android.navigation.Destination
import java.util.concurrent.Executors

sealed interface LoadState<out T> {
    data object Idle : LoadState<Nothing>
    data object Loading : LoadState<Nothing>
    data class Ready<T>(val value: T) : LoadState<T>
    data class Failed(val error: ApiResult.Failure) : LoadState<Nothing>
}

class AppModel(context: Context) {
    private val store = LacrimaStore(context.applicationContext)
    private val executor = Executors.newFixedThreadPool(3)
    private val main = Handler(Looper.getMainLooper())
    private val history = ArrayDeque<Destination>()
    private var featureClientKey: Pair<String, Int?>? = null
    private var featureClient: ApiClient? = null
    private var connectionRevision = 0

    var serverUrl by mutableStateOf(store.serverUrl)
        private set
    var profileId by mutableStateOf(store.profileId)
        private set
    var destination by mutableStateOf<Destination>(Destination.Home)
        private set
    var bootstrap by mutableStateOf<LoadState<Bootstrap>>(LoadState.Idle)
        private set
    var home by mutableStateOf<LoadState<HomeData>>(LoadState.Idle)
        private set
    var browse by mutableStateOf<LoadState<BrowseData>>(LoadState.Idle)
        private set
    var search by mutableStateOf<LoadState<SearchData>>(LoadState.Idle)
        private set
    var title by mutableStateOf<LoadState<TitleData>>(LoadState.Idle)
        private set
    var library by mutableStateOf<LoadState<LibraryData>>(LoadState.Idle)
        private set
    var settings by mutableStateOf<LoadState<Settings>>(LoadState.Idle)
        private set
    var health by mutableStateOf<LoadState<SourceHealth>>(LoadState.Idle)
        private set
    var sourceAdmin by mutableStateOf<LoadState<SourceAdminData>>(LoadState.Idle)
        private set
    var sourceKind by mutableStateOf(MediaKind.MANGA)
        private set
    var stickers by mutableStateOf<LoadState<StickersData>>(LoadState.Idle)
        private set
    var stickerPlacements by mutableStateOf<LoadState<List<StickerPlacement>>>(LoadState.Idle)
        private set
    var actionError by mutableStateOf<ApiResult.Failure?>(null)
        private set

    init { if (serverUrl != null) bootstrap() }

    val currentProfile: Profile?
        get() = (bootstrap as? LoadState.Ready)?.value?.profiles?.firstOrNull { it.id == profileId }

    fun connect(raw: String, onInvalid: () -> Unit) {
        val normalized = ServerAddress.normalize(raw) ?: return onInvalid()
        connectionRevision++
        store.serverUrl = normalized
        store.profileId = null
        serverUrl = normalized
        profileId = null
        bootstrap()
    }

    fun disconnect() {
        connectionRevision++
        store.disconnect()
        serverUrl = null
        profileId = null
        bootstrap = LoadState.Idle
        history.clear()
        destination = Destination.Home
    }

    fun bootstrap() {
        val repo = repository() ?: return
        bootstrap = LoadState.Loading
        run({ repo.bootstrap() }) { result ->
            bootstrap = result.state()
            if (result is ApiResult.Success) {
                val savedValid = result.data.profiles.any { it.id == profileId }
                if (!savedValid) {
                    profileId = result.data.selectedProfile?.id
                    store.profileId = profileId
                }
                if (profileId != null) load(Destination.Home)
            }
        }
    }

    fun selectProfile(profile: Profile) {
        profileId = profile.id
        store.profileId = profile.id
        goHome()
        bootstrap()
    }

    fun clearActionError() { actionError = null }

    fun navigate(next: Destination, replace: Boolean = false) {
        if (!replace && next != destination) history.addLast(destination)
        destination = next
        load(next)
    }

    fun back(): Boolean {
        val previous = history.removeLastOrNull() ?: return false
        destination = previous
        load(previous)
        return true
    }

    fun retry() = load(destination)

    fun search(query: String) {
        val q = query.trim()
        navigate(Destination.Search(q), replace = destination is Destination.Search)
    }

    fun updateLibrary(media: Media, status: String, rating: Int?, pinned: Boolean, done: (ApiResult<LibraryItem>) -> Unit = {}) {
        val repo = repository() ?: return
        run({ repo.updateLibrary(media, status, rating, pinned) }) { result ->
            done(result)
            if (destination is Destination.Title) load(destination)
            if (destination == Destination.Yours) load(destination)
        }
    }

    fun removeLibrary(media: Media) {
        val repo = repository() ?: return
        run({ repo.deleteLibrary(media) }) { if (it is ApiResult.Success) load(Destination.Yours) }
    }

    fun removeHistory(media: Media) {
        val repo = repository() ?: return
        run({ repo.removeHistory(media) }) { result ->
            if (result is ApiResult.Failure) actionError = result else {
                if (destination is Destination.Title) load(destination)
                if (destination == Destination.Yours) load(destination)
            }
        }
    }

    fun browsePage(kind: MediaKind, genre: String?, page: Int) =
        navigate(Destination.Browse(kind, genre, page.coerceAtLeast(1)), replace = true)

    fun researchTitle(query: String = "") {
        val target = destination as? Destination.Title ?: return
        val repo = repository() ?: return
        run({ repo.title(target.media, change = true, sourceQuery = query.takeIf(String::isNotBlank)) }) { result ->
            when (result) {
                is ApiResult.Success -> title = result.state()
                is ApiResult.Failure -> actionError = result
            }
        }
    }

    fun selectTitlePart(part: String?) {
        val target = destination as? Destination.Title ?: return
        title = LoadState.Loading
        val repo = repository() ?: return
        run({ repo.title(target.media, part = part) }) { title = it.state() }
    }

    fun bindTitle(candidate: SourceCandidate) {
        val target = destination as? Destination.Title ?: return
        val repo = repository() ?: return
        run({ repo.bindTitle(target.media, candidate) }) { result ->
            if (result is ApiResult.Failure) actionError = result else load(target)
        }
    }

    fun refreshChapters() {
        val target = destination as? Destination.Title ?: return
        val repo = repository() ?: return
        title = LoadState.Loading
        run({ repo.refreshChapters(target.media) }) { result ->
            if (result is ApiResult.Failure) {
                title = LoadState.Failed(result)
            } else load(target)
        }
    }

    fun markTitleProgress(chapter: Chapter, unit: Int, skipAhead: Boolean, exact: Boolean) {
        val target = destination as? Destination.Title ?: return
        val current = (title as? LoadState.Ready)?.value ?: return
        val repo = repository() ?: return
        run({
            val anchor = if (exact) chapter.copy(id = "-", name = "") else chapter
            repo.writeProgress(
                media = current.selectedMedia,
                chapter = anchor,
                unit = unit,
                skipAhead = skipAhead,
                exact = exact,
                seriesParts = current.progressTree.seriesParts,
                partIndex = current.progressTree.partIndex,
            )
        }) { result ->
            if (result is ApiResult.Failure) actionError = result else load(target)
        }
    }

    fun saveSettings(value: Settings) {
        val repo = repository() ?: return
        settings = LoadState.Loading
        run({ repo.updateSettings(value) }) { settings = it.state() }
    }

    fun createProfile(name: String, accent: String) {
        val repo = repository() ?: return
        run({ repo.createProfile(name, accent) }) { result ->
            when (result) {
                is ApiResult.Failure -> actionError = result
                is ApiResult.Success -> {
                    profileId = result.data.id
                    store.profileId = result.data.id
                    goHome()
                    bootstrap()
                }
            }
        }
    }

    fun updateProfile(profile: Profile) {
        val repo = repository() ?: return
        run({ repo.updateProfile(profile) }) { result ->
            if (result is ApiResult.Failure) actionError = result else bootstrap()
        }
    }

    fun deleteCurrentProfile() {
        val repo = repository() ?: return
        val id = profileId ?: return
        run({ repo.deleteProfile(id) }) { result ->
            if (result is ApiResult.Failure) actionError = result
            else {
                profileId = null
                store.profileId = null
                goHome()
                bootstrap()
            }
        }
    }

    fun loadSources(kind: MediaKind = sourceKind, query: String = "") {
        sourceKind = kind
        val repo = repository() ?: return
        sourceAdmin = LoadState.Loading
        run({ repo.sourceAdmin(kind, query) }) { sourceAdmin = it.state() }
    }

    fun setSourceEnabled(source: SourceInfo, enabled: Boolean) = sourceAction {
        it.setSourceEnabled(source.kind, source.id, enabled)
    }

    fun setExtensionInstalled(extension: SourceExtension, installed: Boolean) = sourceAction {
        it.setExtensionInstalled(sourceKind, extension.pkgName, installed)
    }

    fun addRepo(indexUrl: String) = sourceAction { it.addRepo(sourceKind, indexUrl) }
    fun removeRepo(indexUrl: String) = sourceAction { it.removeRepo(sourceKind, indexUrl) }
    fun refreshRepos() = sourceAction { it.refreshRepos(sourceKind) }

    private fun sourceAction(work: (LacrimaRepository) -> ApiResult<*> ) {
        val repo = repository() ?: return
        run({ work(repo) }) { result ->
            if (result is ApiResult.Failure) actionError = result else loadSources()
        }
    }

    fun toggleSticker(id: String) {
        val repo = repository() ?: return
        run({ repo.toggleSticker(id) }) { result ->
            if (result is ApiResult.Failure) actionError = result else load(Destination.Stickers)
        }
    }

    fun addStickerPlacement(stickerId: String, path: String = "/yours") {
        val repo = repository() ?: return
        run({ repo.addPlacement(stickerId, path, .82, .82) }) { result ->
            if (result is ApiResult.Failure) actionError = result else loadStickerPlacements(path)
        }
    }

    fun updateStickerPlacement(placement: StickerPlacement, x: Double = placement.x, y: Double = placement.y, scale: Double = placement.scale, rot: Double = placement.rot) {
        val repo = repository() ?: return
        run({ repo.updatePlacement(placement.id, x, y, scale, rot) }) { result ->
            if (result is ApiResult.Failure) actionError = result else loadStickerPlacements(placement.path)
        }
    }

    fun deleteStickerPlacement(placement: StickerPlacement) {
        val repo = repository() ?: return
        run({ repo.deletePlacement(placement.id) }) { result ->
            if (result is ApiResult.Failure) actionError = result else loadStickerPlacements(placement.path)
        }
    }

    private fun loadStickerPlacements(path: String = "/yours") {
        val repo = repository() ?: return
        stickerPlacements = LoadState.Loading
        run({ repo.placements(path) }) { stickerPlacements = it.state() }
    }

    private fun load(target: Destination) {
        val repo = repository() ?: return
        when (target) {
            Destination.Home -> {
                home = LoadState.Loading
                run({ repo.home() }) { home = it.state() }
            }
            is Destination.Browse -> {
                browse = LoadState.Loading
                run({ repo.browse(target.kind, target.genre, target.page) }) { browse = it.state() }
            }
            is Destination.Search -> {
                if (target.query.isBlank()) search = LoadState.Ready(SearchData("", emptyList()))
                else {
                    search = LoadState.Loading
                    run({ repo.search(target.query) }) { search = it.state() }
                }
            }
            is Destination.Title -> {
                title = LoadState.Loading
                run({ repo.title(target.media) }) { title = it.state() }
            }
            Destination.Yours -> {
                library = LoadState.Loading
                run({ repo.library() }) { library = it.state() }
            }
            Destination.Settings -> {
                settings = LoadState.Loading
                run({ repo.settings() }) { settings = it.state() }
            }
            Destination.Sources -> {
                health = LoadState.Loading
                sourceAdmin = LoadState.Loading
                run({ repo.health() }) { result ->
                    health = result.state()
                    val counts = (result as? ApiResult.Success)?.data?.counts
                    val kind = when {
                        (counts?.get(MediaKind.ANIME) ?: 0) > 0 -> MediaKind.ANIME
                        (counts?.get(MediaKind.MANGA) ?: 0) > 0 -> MediaKind.MANGA
                        (counts?.get(MediaKind.NOVEL) ?: 0) > 0 -> MediaKind.NOVEL
                        else -> sourceKind
                    }
                    loadSources(kind)
                }
            }
            Destination.Stickers -> {
                stickers = LoadState.Loading
                run({ repo.stickers() }) { stickers = it.state() }
                loadStickerPlacements()
            }
            Destination.Profiles, is Destination.Player, is Destination.Reader -> Unit
        }
    }

    private fun goHome() {
        history.clear()
        destination = Destination.Home
    }

    private fun repository(): LacrimaRepository? = serverUrl?.let { LacrimaRepository(ApiClient(it, profileId)) }

    fun apiClient(): ApiClient? {
        val url = serverUrl ?: return null
        val key = url to profileId
        if (featureClientKey != key) {
            featureClientKey = key
            featureClient = ApiClient(url, profileId)
        }
        return featureClient
    }

    private fun <T> run(work: () -> ApiResult<T>, complete: (ApiResult<T>) -> Unit) {
        val revision = connectionRevision
        executor.execute {
            val result = runCatching(work).getOrElse {
                ApiResult.Failure("client_error", it.message ?: "The request could not be completed.")
            }
            main.post { if (revision == connectionRevision) complete(result) }
        }
    }

    fun close() = executor.shutdownNow()
}

private fun <T> ApiResult<T>.state(): LoadState<T> = when (this) {
    is ApiResult.Success -> LoadState.Ready(data)
    is ApiResult.Failure -> LoadState.Failed(this)
}

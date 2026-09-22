package app.lacrima.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import android.app.Activity
import app.lacrima.android.AppModel
import app.lacrima.android.LoadState
import app.lacrima.android.feature.player.PlaybackRoute
import app.lacrima.android.feature.player.PlayerApi
import app.lacrima.android.feature.player.PlayerScreen
import app.lacrima.android.feature.reader.ReaderApi
import app.lacrima.android.feature.reader.ReaderRoute
import app.lacrima.android.feature.reader.ReaderScreen
import app.lacrima.android.model.MediaKind
import app.lacrima.android.navigation.Destination
import app.lacrima.android.ui.theme.LacrimaTheme
import app.lacrima.android.ui.theme.accent

@Composable
fun LacrimaApp(
    model: AppModel,
    onFullscreenChanged: (Boolean) -> Unit = {},
    onPictureInPictureRequested: () -> Unit = {},
) {
    val activity = LocalContext.current as? Activity
    fun goBack() {
        if (!model.back()) activity?.finish()
    }
    val profile = model.currentProfile
    LacrimaTheme(accent(profile?.accent)) {
        when {
            model.serverUrl == null -> ConnectionScreen(model)
            model.bootstrap is LoadState.Loading || model.bootstrap is LoadState.Idle ->
                Column(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator()
                    TextButton(model::disconnect) { Text("Change server URL") }
                }
            model.bootstrap is LoadState.Failed -> {
                val error = (model.bootstrap as LoadState.Failed).error
                FailureCard(error, model::bootstrap, model::disconnect)
            }
            profile == null -> {
                val boot = model.bootstrap as? LoadState.Ready
                ProfileManagementScreen(
                    profiles = boot?.value?.profiles.orEmpty(),
                    current = null,
                    error = model.actionError,
                    select = model::selectProfile,
                    create = { name, color -> model.createProfile(name, color) },
                    update = model::updateProfile,
                    deleteCurrent = model::deleteCurrentProfile,
                    dismissError = model::clearActionError,
                    disconnect = model::disconnect,
                )
            }
            else -> {
                val boot = (model.bootstrap as LoadState.Ready).value
                if (model.destination == Destination.Profiles) {
                    ProfileManagementScreen(
                        profiles = boot.profiles,
                        current = profile,
                        error = model.actionError,
                        select = model::selectProfile,
                        create = { name, color -> model.createProfile(name, color) },
                        update = model::updateProfile,
                        deleteCurrent = model::deleteCurrentProfile,
                        dismissError = model::clearActionError,
                        disconnect = model::disconnect,
                        done = { model.navigate(Destination.Home, replace = true) },
                    )
                } else {
                    val featureClient = model.apiClient()
                    val readerApi = remember(featureClient) { featureClient?.let(::ReaderApi) }
                    when (val feature = model.destination) {
                        is Destination.Player -> if (featureClient != null) PlayerScreen(
                            api = PlayerApi(featureClient),
                            route = PlaybackRoute(feature.media.via, feature.media.id, feature.chapterId),
                            onBack = ::goBack,
                            onOpenEpisode = { id -> model.navigate(feature.copy(chapterId = id), replace = true) },
                            onFullscreenChanged = onFullscreenChanged,
                            onPictureInPictureRequested = onPictureInPictureRequested,
                        )
                        is Destination.Reader -> if (readerApi != null) ReaderScreen(
                            api = readerApi,
                            route = ReaderRoute(feature.media.via, feature.media.kind.wire, feature.media.id, feature.chapterId),
                            onBack = ::goBack,
                            startAtEnd = feature.startAtEnd,
                            onOpenChapter = { id, atEnd ->
                                model.navigate(feature.copy(chapterId = id, startAtEnd = atEnd), replace = true)
                            },
                            onFullscreenChanged = onFullscreenChanged,
                        )
                        else -> LacrimaScaffold(model.destination, profile, boot.health, model::navigate, model::back) { padding ->
                            Box(Modifier.padding(padding).fillMaxSize()) {
                                when (val destination = model.destination) {
                                    Destination.Home -> HomeScreen(model.home, model::retry) { model.navigate(Destination.Title(it)) }
                                    is Destination.Browse -> BrowseScreen(
                                        destination,
                                        model.browse,
                                        model::retry,
                                        { model.navigate(destination.copy(genre = it, page = 1), replace = true) },
                                        { model.navigate(Destination.Title(it)) },
                                        { model.browsePage(destination.kind, destination.genre, it) },
                                    )
                                    Destination.Yours -> YoursScreen(
                                        model.library,
                                        model::retry,
                                        { model.navigate(Destination.Title(it)) },
                                        { model.updateLibrary(it.media, it.status, it.rating, !it.pinned) },
                                        wallpaper = profile.wallpaper,
                                        openStickers = { model.navigate(Destination.Stickers) },
                                    )
                                    is Destination.Search -> SearchScreen(destination.query, model.search, model::search, model::retry) { model.navigate(Destination.Title(it)) }
                                    is Destination.Title -> TitleScreen(
                                        model.title,
                                        model::retry,
                                        { media, chapter ->
                                            model.navigate(if (media.kind == MediaKind.ANIME) Destination.Player(media, chapter) else Destination.Reader(media, chapter))
                                        },
                                        model::updateLibrary,
                                        removeHistory = model::removeHistory,
                                        research = model::researchTitle,
                                        bind = model::bindTitle,
                                        refreshChapters = model::refreshChapters,
                                        selectPart = model::selectTitlePart,
                                        openSources = { model.navigate(Destination.Sources) },
                                        markProgress = model::markTitleProgress,
                                        error = model.actionError,
                                        dismissError = model::clearActionError,
                                    )
                                    Destination.Settings -> SettingsScreen(model.settings, model::retry, model::saveSettings, model::disconnect)
                                    Destination.Sources -> SourceAdminScreen(
                                        model.sourceAdmin,
                                        model.sourceKind,
                                        model::retry,
                                        { model.loadSources(it) },
                                        { model.loadSources(model.sourceKind, it) },
                                        model::setSourceEnabled,
                                        model::setExtensionInstalled,
                                        model::addRepo,
                                        model::removeRepo,
                                        model::refreshRepos,
                                        model.actionError,
                                        model::clearActionError,
                                    )
                                    Destination.Stickers -> StickersScreen(
                                        model.stickers,
                                        model.stickerPlacements,
                                        model::retry,
                                        model::toggleSticker,
                                        { model.addStickerPlacement(it) },
                                        model::updateStickerPlacement,
                                        model::deleteStickerPlacement,
                                        { model.back() },
                                        model.actionError,
                                        model::clearActionError,
                                    )
                                    is Destination.Player, is Destination.Reader -> Unit
                                    Destination.Profiles -> Unit
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

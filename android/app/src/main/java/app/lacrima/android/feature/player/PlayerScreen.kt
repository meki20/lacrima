package app.lacrima.android.feature.player

import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.ui.PlayerView
import app.lacrima.android.model.ApiResult
import app.lacrima.android.ui.FadeSlideBar
import app.lacrima.android.ui.GlassCard
import app.lacrima.android.ui.Glyph
import app.lacrima.android.ui.IconHit
import app.lacrima.android.ui.LacrimaIcon
import app.lacrima.android.ui.OverlayMenu
import app.lacrima.android.ui.OverlayNote
import app.lacrima.android.ui.QuietLabel
import app.lacrima.android.ui.SegmentTabs
import app.lacrima.android.ui.SelectRow
import app.lacrima.android.ui.theme.Highlight
import app.lacrima.android.ui.theme.Text
import app.lacrima.android.ui.theme.Text2
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.max

private val CaptionScales = listOf(1f, 1.2f, 1.45f)

@Composable
fun PlayerScreen(
    api: PlayerApi,
    route: PlaybackRoute,
    onBack: () -> Unit,
    onOpenEpisode: (String) -> Unit,
    modifier: Modifier = Modifier,
    onFullscreenChanged: (Boolean) -> Unit = {},
    onPictureInPictureRequested: () -> Unit = {},
) {
    val result by produceState<ApiResult<PlaybackDocument>?>(null, route) {
        value = withContext(Dispatchers.IO) { api.load(route) }
    }
    when (val state = result) {
        null -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is ApiResult.Failure -> PlayerFailure(state.message, onBack, modifier)
        is ApiResult.Success -> NativePlayer(
            api = api,
            initialDocument = state.data,
            onBack = onBack,
            onOpenEpisode = onOpenEpisode,
            modifier = modifier,
            onFullscreenChanged = onFullscreenChanged,
            onPictureInPictureRequested = onPictureInPictureRequested,
        )
    }
}

@Composable
private fun PlayerFailure(message: String, onBack: () -> Unit, modifier: Modifier) {
    Box(modifier.fillMaxSize().background(Color(0xFF0C0908)), contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Can't play this", style = MaterialTheme.typography.headlineSmall)
            Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = onBack) { Text("Back to title") }
        }
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun NativePlayer(
    api: PlayerApi,
    initialDocument: PlaybackDocument,
    onBack: () -> Unit,
    onOpenEpisode: (String) -> Unit,
    modifier: Modifier,
    onFullscreenChanged: (Boolean) -> Unit,
    onPictureInPictureRequested: () -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val flushScope = remember { CoroutineScope(SupervisorJob() + Dispatchers.IO) }
    val seekClock = remember { RemuxSeekClock() }
    val httpFactory = remember {
        DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(120_000)
            .setReadTimeoutMs(120_000)
            .setAllowCrossProtocolRedirects(true)
    }
    val player = remember {
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                REMUX_MIN_BUFFER_MS,
                REMUX_MAX_BUFFER_MS,
                REMUX_PLAYBACK_BUFFER_MS,
                REMUX_REBUFFER_MS,
            )
            .setTargetBufferBytes(REMUX_TARGET_BUFFER_BYTES)
            .setPrioritizeTimeOverSizeThresholds(false)
            .setBackBuffer(REMUX_BACK_BUFFER_MS, true)
            .build()
        val extractors = ExtractorsFactory {
            DefaultExtractorsFactory().createExtractors().map { extractor ->
                BufferedSeekExtractor(extractor, seekClock)
            }.toTypedArray()
        }
        val sources = DefaultMediaSourceFactory(httpFactory, extractors)
            .setLoadErrorHandlingPolicy(object : DefaultLoadErrorHandlingPolicy() {
                override fun getMinimumLoadableRetryCount(dataType: Int) = 0
            })
        val renderers = DefaultRenderersFactory(context).setEnableDecoderFallback(true)
        ExoPlayer.Builder(context)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(sources)
            .setRenderersFactory(renderers)
            .build()
    }
    var document by remember(initialDocument.route) { mutableStateOf(initialDocument) }
    var groupIndex by remember(initialDocument.route) {
        mutableIntStateOf(initialDocument.streamGroups.indexOfFirst { it.id == initialDocument.preferredStreamGroup }.coerceAtLeast(0))
    }
    var attemptIndex by remember(initialDocument.route) { mutableIntStateOf(0) }
    var raceTry by remember(initialDocument.route) { mutableIntStateOf(0) }
    var h264Fallback by remember(initialDocument.route) { mutableStateOf(false) }
    var streamStartMs by remember(initialDocument.route) { mutableLongStateOf(initialDocument.initialTimeMs) }
    seekClock.durationUs = remuxDurationUs(document.durationMs, streamStartMs)
    var positionMs by remember(initialDocument.route) { mutableLongStateOf(initialDocument.initialTimeMs) }
    var bufferedEndMs by remember(initialDocument.route) { mutableLongStateOf(initialDocument.initialTimeMs) }
    var controlsVisible by remember { mutableStateOf(true) }
    var dockOpen by remember { mutableStateOf(false) }
    var dockTab by remember { mutableStateOf("quality") }
    var episodesOpen by remember { mutableStateOf(false) }
    var fullscreen by remember { mutableStateOf(true) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var isPlaying by remember { mutableStateOf(false) }
    var ended by remember { mutableStateOf(false) }
    var nextCancelled by remember(document.route) { mutableStateOf(false) }
    var skipSegments by remember(document.route) { mutableStateOf<List<SkipSegment>>(emptyList()) }
    var subtitles by remember(document.route) { mutableStateOf<List<SubtitleChoice>>(emptyList()) }
    var subtitleListError by remember(document.route) { mutableStateOf<String?>(null) }
    var subtitleBodyError by remember(document.route) { mutableStateOf<String?>(null) }
    var selectedSubtitle by remember(document.route) { mutableStateOf<SubtitleChoice?>(null) }
    var subtitleOff by remember(document.route) { mutableStateOf(document.settings.subtitleLang == "off") }
    var timedCues by remember(document.route) { mutableStateOf<List<TimedCue>>(emptyList()) }
    var subSync by remember(document.route) { mutableStateOf(0.0) }
    var captionScale by remember(document.route) { mutableFloatStateOf(parseCaptionScale(document.settings.captionScale)) }
    var committedUrl by remember(document.route) { mutableStateOf<String?>(null) }
    var warmedFor by remember(document.route) { mutableStateOf<String?>(null) }
    var playedMs by remember(document.route) { mutableLongStateOf(0) }
    var pendingWatchMs by remember(document.route) { mutableLongStateOf(0) }
    var dragPosition by remember { mutableStateOf<Long?>(null) }

    val group = document.streamGroups.getOrNull(groupIndex)
    val attempt = group?.attempts?.getOrNull(attemptIndex)

    fun reloadAt(
        targetMs: Long,
        lang: String = group?.lang ?: document.settings.audioLang,
        fresh: Boolean = false,
        wantedGroup: String? = null,
        wantedAttempt: Int = 0,
    ) {
        if (loading) return
        loading = true
        error = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                api.load(
                    route = document.route,
                    lang = lang,
                    startAtMs = targetMs,
                    subtitleLang = selectedSubtitle?.lang,
                    fresh = fresh,
                )
            }
            when (result) {
                is ApiResult.Failure -> error = result.message
                is ApiResult.Success -> {
                    document = result.data
                    groupIndex = result.data.streamGroups.indexOfFirst {
                        it.id == wantedGroup || (wantedGroup == null && it.id == result.data.preferredStreamGroup)
                    }.coerceAtLeast(0)
                    attemptIndex = wantedAttempt.coerceIn(
                        0,
                        (result.data.streamGroups.getOrNull(groupIndex)?.attempts?.lastIndex ?: 0).coerceAtLeast(0),
                    )
                    raceTry = 0
                    streamStartMs = targetMs
                    positionMs = targetMs
                    bufferedEndMs = targetMs
                    ended = false
                }
            }
            loading = false
        }
    }

    fun seekAbsolute(targetMs: Long) {
        val memoryEnd = remuxBufferedEndMs(
            streamStartMs = streamStartMs,
            currentPositionMs = player.currentPosition,
            bufferedPositionMs = player.bufferedPosition,
            totalBufferedDurationMs = player.totalBufferedDuration,
        )
        val diskEnd = streamStartMs + seekClock.cachedEndUs() / 1_000
        val bufferedStart = if (seekClock.cachedBytes > 0) streamStartMs else max(streamStartMs, streamStartMs + player.currentPosition.coerceAtLeast(0) - REMUX_BACK_BUFFER_MS)
        val bufferedEnd = max(memoryEnd, diskEnd)
        val decision = decideSeek(targetMs, streamStartMs, bufferedStart, bufferedEnd)
        if (decision.localPositionMs != null) {
            player.seekTo(decision.localPositionMs)
            positionMs = targetMs.coerceAtLeast(0)
        } else {
            reloadAt(decision.restartAtMs!!)
        }
    }

    fun failOver(message: String = "This source did not start.") {
        val selected = attempt
        val nextTry = selected?.url?.let { nextRaceTry(it, raceTry) }
        if (nextTry != null) {
            raceTry = nextTry
            error = null
            return
        }
        val next = nextPlayableAttempt(document.streamGroups, groupIndex, attemptIndex)
        if (next == null) {
            error = "$message Try another quality or refresh the source list."
            return
        }
        raceTry = 0
        val nextGroup = document.streamGroups[next.first]
        val absolute = streamStartMs + player.currentPosition.coerceAtLeast(0)
        if (player.currentPosition < 500 && playedMs == 0L) {
            groupIndex = next.first
            attemptIndex = next.second
            error = null
            return
        }
        reloadAt(
            targetMs = absolute,
            lang = nextGroup.lang,
            wantedGroup = nextGroup.id,
            wantedAttempt = next.second,
        )
    }
    val currentFailOver = rememberUpdatedState(::failOver)
    fun handlePlaybackError(playerError: PlaybackException) {
        if (
            !h264Fallback &&
            attempt?.url?.contains("remux=1") == true &&
            needsH264Fallback(playerError.errorCodeName)
        ) {
            h264Fallback = true
            error = null
            return
        }
        val status = (playerError.cause as? HttpDataSource.InvalidResponseCodeException)
            ?.responseCode
        failOver(listOfNotNull(playerError.errorCodeName, status?.let { "HTTP $it" }).joinToString(" · "))
    }
    val currentPlaybackError = rememberUpdatedState(::handlePlaybackError)
    val streamUrl = attempt?.url?.let { selected ->
        withRaceTry(selected, raceTry).let { if (h264Fallback) withH264Video(it) else it }
    }

    LaunchedEffect(Unit) { onFullscreenChanged(true) }

    LaunchedEffect(streamUrl) {
        if (streamUrl == null) return@LaunchedEffect
        seekClock.reset(remuxDurationUs(document.durationMs, streamStartMs))
        player.setMediaItem(MediaItem.fromUri(streamUrl))
        player.prepare()
        player.playWhenReady = true
    }

    LaunchedEffect(attempt?.url) {
        val selected = attempt ?: return@LaunchedEffect
        while (player.playbackState != Player.STATE_READY) delay(250)
        if (warmedFor != selected.url) {
            warmedFor = selected.url
            withContext(Dispatchers.IO) { api.warmNext(document) }
        }
    }

    LaunchedEffect(streamUrl) {
        if (streamUrl == null) return@LaunchedEffect
        delay(startDeadlineMs(streamUrl))
        if (player.playbackState != Player.STATE_READY && player.currentPosition < 500) {
            currentFailOver.value("This source took too long to start.")
        }
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(value: Boolean) { isPlaying = value }
            override fun onPlayerError(playerError: PlaybackException) {
                currentPlaybackError.value(playerError)
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) ended = true
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            val absolute = streamStartMs + player.currentPosition.coerceAtLeast(0)
            val delta = (pendingWatchMs / 1000).toInt().coerceIn(0, 30)
            flushScope.launch { api.writeProgress(document.progress, absolute, delta) }
            player.release()
            onFullscreenChanged(false)
        }
    }

    LaunchedEffect(document.route) {
        when (val result = withContext(Dispatchers.IO) { api.subtitles(document.route) }) {
            is ApiResult.Failure -> subtitleListError = result.message
            is ApiResult.Success -> {
                subtitles = result.data
                subtitleListError = null
                val pick = pickSubLang(result.data, group?.lang ?: document.settings.audioLang, document.settings.subtitleLang)
                subtitleOff = pick == "off"
                selectedSubtitle = result.data.find { it.id == pick }
            }
        }
    }

    LaunchedEffect(document.route) {
        skipSegments = when (val result = withContext(Dispatchers.IO) { api.skipTimes(document.route) }) {
            is ApiResult.Success -> result.data
            is ApiResult.Failure -> emptyList()
        }
    }

    LaunchedEffect(selectedSubtitle?.id, selectedSubtitle?.src, subtitleOff, document.route) {
        timedCues = emptyList()
        subtitleBodyError = null
        val choice = selectedSubtitle
        if (subtitleOff || choice == null) return@LaunchedEffect
        when (val result = withContext(Dispatchers.IO) { api.subtitleText(choice) }) {
            is ApiResult.Failure -> subtitleBodyError = result.message
            is ApiResult.Success -> {
                timedCues = parseCues(result.data)
                if (timedCues.isEmpty()) subtitleBodyError = "This file has no readable cues."
            }
        }
    }

    LaunchedEffect(player, document.route, attempt?.url) {
        var lastWall = System.currentTimeMillis()
        var lastWrite = lastWall
        while (true) {
            delay(500)
            val now = System.currentTimeMillis()
            val elapsed = (now - lastWall).coerceIn(0, 2_000)
            lastWall = now
            if (player.isPlaying && player.currentPosition > 200) {
                playedMs += elapsed
                pendingWatchMs += elapsed
            }
            positionMs = streamStartMs + player.currentPosition.coerceAtLeast(0)
            bufferedEndMs = max(
                remuxBufferedEndMs(
                    streamStartMs,
                    player.currentPosition,
                    player.bufferedPosition,
                    player.totalBufferedDuration,
                ),
                streamStartMs + seekClock.cachedEndUs() / 1_000,
            )
            if (now - lastWrite >= 5_000 && positionMs > 1_000) {
                val delta = (pendingWatchMs / 1000).toInt().coerceIn(0, 30)
                if (delta > 0) pendingWatchMs -= delta * 1000L
                lastWrite = now
                withContext(Dispatchers.IO) { api.writeProgress(document.progress, positionMs, delta) }
            }
            if (playedMs >= 15_000 && attempt != null && committedUrl != attempt.url) {
                committedUrl = attempt.url
                withContext(Dispatchers.IO) { api.commit(document.route, attempt) }
            }
        }
    }

    LaunchedEffect(controlsVisible, isPlaying, dockOpen, episodesOpen) {
        if (controlsVisible && isPlaying && !dockOpen && !episodesOpen) {
            delay(2_800)
            controlsVisible = false
        }
    }

    val activeSkip = activeSkipSegment(skipSegments, positionMs)
    val showNextUp = !nextCancelled && shouldOfferNextEpisode(
        ended = ended,
        hasNext = document.nextEpisodeId != null,
        watchedMs = playedMs,
        durationMs = document.durationMs,
        positionMs = positionMs,
        outro = outroSegment(skipSegments, positionMs),
    )

    BackHandler {
        when {
            dockOpen -> dockOpen = false
            episodesOpen -> episodesOpen = false
            fullscreen -> {
                fullscreen = false
                onFullscreenChanged(false)
            }
            else -> onBack()
        }
    }

    val shown = dragPosition ?: positionMs
    val activeCue = if (subtitleOff) null else cueAt(timedCues, shown / 1000.0 - subSync)

    Box(
        modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) {
            detectTapGestures(onTap = {
                controlsVisible = !controlsVisible
                if (!controlsVisible) {
                    dockOpen = false
                    episodesOpen = false
                }
            })
        },
    ) {
        AndroidView(
            factory = { ctx ->
                (android.view.LayoutInflater.from(ctx).inflate(app.lacrima.android.R.layout.lacrima_player, null) as PlayerView).apply {
                    layoutParams = android.view.ViewGroup.LayoutParams(
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    subtitleView?.visibility = android.view.View.GONE
                }
            },
            update = { view -> view.player = player },
            onRelease = { it.player = null },
            modifier = Modifier.fillMaxSize(),
        )

        if (loading || player.playbackState == Player.STATE_BUFFERING) {
            CircularProgressIndicator(Modifier.align(Alignment.Center), color = Highlight)
        }
        error?.let { message ->
            GlassCard(Modifier.align(Alignment.Center).padding(24.dp)) {
                Column(Modifier.padding(20.dp).widthIn(max = 360.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Can't play this", color = Text, fontSize = 22.sp, fontWeight = FontWeight.Medium)
                    Text(message, color = Text2)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { reloadAt(positionMs, fresh = true) }) { Text("Try again") }
                        OutlinedButton(onClick = onBack) { Text("Back") }
                    }
                }
            }
        }
        if (showNextUp) {
            GlassCard(
                Modifier
                    .align(Alignment.BottomEnd)
                    .navigationBarsPadding()
                    .padding(end = 16.dp, bottom = if (activeSkip == null) 104.dp else 176.dp),
            ) {
                Column(Modifier.padding(16.dp).widthIn(max = 320.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    QuietLabel("Up next")
                    Text("Next episode", color = Text, fontSize = 20.sp, fontWeight = FontWeight.Medium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { document.nextEpisodeId?.let(onOpenEpisode) }) { Text("Play now") }
                        OutlinedButton(onClick = { nextCancelled = true }) { Text("Watch credits") }
                    }
                }
            }
        }
        activeSkip?.let { segment ->
            Button(
                onClick = { seekAbsolute(segment.endMs) },
                modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 16.dp, bottom = 104.dp),
            ) { Text("Skip ${skipLabel(segment)}") }
        }

        activeCue?.let { cue ->
            PlayerCaption(
                text = cue.text,
                scale = captionScale,
                liftForChrome = controlsVisible || dockOpen || episodesOpen,
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }

        val chromeOn = controlsVisible || dockOpen || episodesOpen
        FadeSlideBar(visible = chromeOn, fromTop = true, modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color(0xD9000000), Color.Transparent)))
                    .padding(start = 4.dp, end = 8.dp, top = 8.dp, bottom = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconHit(onClick = onBack, label = "Back to title") {
                    LacrimaIcon(Glyph.arrow, filled = false, tint = Color.White)
                }
                Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                    Text(document.media.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium, color = Text, fontSize = 16.sp)
                    Text(episodeLabel(document.episode), maxLines = 1, color = Text2, fontSize = 13.sp)
                }
                attempt?.provider?.let {
                    Text(it, color = Text2, fontSize = 11.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, modifier = Modifier.padding(end = 4.dp))
                }
                IconHit(onClick = onPictureInPictureRequested, label = "Picture in picture") {
                    LacrimaIcon(Glyph.pip, filled = false, tint = Color.White)
                }
            }
        }

        FadeSlideBar(visible = chromeOn, fromTop = false, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6000000))))
                    .navigationBarsPadding()
                    .padding(start = 6.dp, end = 6.dp, top = 28.dp, bottom = 10.dp),
            ) {
                val sliderDuration = document.durationMs?.coerceAtLeast(1) ?: max(shown, bufferedEndMs).coerceAtLeast(1)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    SeekStrip(
                        positionMs = shown,
                        bufferedEndMs = bufferedEndMs,
                        durationMs = sliderDuration,
                        segments = skipSegments,
                        onScrub = { dragPosition = it },
                        onScrubFinished = { target ->
                            seekAbsolute(target)
                            dragPosition = null
                        },
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "${clock(shown)} / ${document.durationMs?.let(::clock) ?: "--:--"}",
                        color = Text2,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconHit(onClick = { if (player.isPlaying) player.pause() else player.play() }, label = if (isPlaying) "Pause" else "Play") {
                        LacrimaIcon(if (isPlaying) Glyph.pause else Glyph.play, filled = true, tint = Color.White, size = 26.dp)
                    }
                    IconHit(onClick = { seekAbsolute(positionMs - 10_000) }, label = "Back 10 seconds") {
                        LacrimaIcon(Glyph.back10, filled = true, tint = Color.White, size = 26.dp)
                    }
                    IconHit(onClick = { seekAbsolute(positionMs + 10_000) }, label = "Forward 10 seconds") {
                        LacrimaIcon(Glyph.fwd10, filled = true, tint = Color.White, size = 26.dp)
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${group?.quality ?: "Quality"} · ${(group?.lang ?: "ja").uppercase()}",
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable {
                                dockOpen = !dockOpen
                                episodesOpen = false
                                dockTab = if (qualitiesForLang(document.streamGroups, group?.lang.orEmpty()).size > 1) "quality"
                                else if (langChoices(document.streamGroups).size > 1) "language"
                                else "subs"
                            }
                            .padding(horizontal = 8.dp, vertical = 10.dp),
                        color = if (dockOpen) Highlight else Text2,
                        fontWeight = FontWeight.Medium,
                        fontSize = 15.sp,
                        maxLines = 1,
                    )
                    if (document.episodes.size > 1) {
                        IconHit(onClick = { episodesOpen = !episodesOpen; dockOpen = false }, label = "Episodes") {
                            LacrimaIcon(Glyph.list, filled = false, tint = if (episodesOpen) Highlight else Color.White, size = 26.dp)
                        }
                    }
                    document.nextEpisodeId?.let { next ->
                        IconHit(onClick = { onOpenEpisode(next) }, label = "Next episode") {
                            LacrimaIcon(Glyph.next, filled = true, tint = Color.White, size = 26.dp)
                        }
                    }
                    IconHit(onClick = {
                        fullscreen = !fullscreen
                        onFullscreenChanged(fullscreen)
                    }, label = if (fullscreen) "Exit fullscreen" else "Fullscreen") {
                        LacrimaIcon(Glyph.full, filled = false, tint = Color.White, size = 26.dp)
                    }
                }
            }
        }

        OverlayMenu(
            visible = dockOpen,
            modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 12.dp, bottom = 88.dp),
            height = 340.dp,
        ) {
            DockMenu(
                groups = document.streamGroups,
                group = group,
                subtitles = subtitles,
                subtitleListError = subtitleListError,
                subtitleBodyError = subtitleBodyError,
                subtitleOff = subtitleOff,
                selectedSubtitle = selectedSubtitle,
                subSync = subSync,
                captionScale = captionScale,
                tab = dockTab,
                onTab = { dockTab = it },
                onPickGroup = { choice ->
                    dockOpen = false
                    reloadAt(positionMs, lang = choice.lang, wantedGroup = choice.id)
                },
                onPickSub = { choice ->
                    dockOpen = false
                    if (choice == null) {
                        subtitleOff = true
                        selectedSubtitle = null
                        timedCues = emptyList()
                    } else {
                        subtitleOff = false
                        selectedSubtitle = choice
                    }
                },
                onSubSync = { subSync = parseSubSync(it) },
                onCaptionScale = { captionScale = it },
                onRefreshSubs = {
                    scope.launch {
                        when (val result = withContext(Dispatchers.IO) { api.subtitles(document.route, fresh = true) }) {
                            is ApiResult.Failure -> subtitleListError = result.message
                            is ApiResult.Success -> {
                                subtitles = result.data
                                subtitleListError = null
                                subtitleBodyError = null
                            }
                        }
                    }
                },
            )
        }
        OverlayMenu(
            visible = episodesOpen,
            modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 12.dp, bottom = 88.dp),
        ) {
            Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                document.episodes.forEach { episode ->
                    SelectRow(
                        title = episodeLabel(episode),
                        selected = episode.id == document.route.chapterId,
                        onClick = { episodesOpen = false; onOpenEpisode(episode.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ColumnScope.DockMenu(
    groups: List<PlaybackStreamGroup>,
    group: PlaybackStreamGroup?,
    subtitles: List<SubtitleChoice>,
    subtitleListError: String?,
    subtitleBodyError: String?,
    subtitleOff: Boolean,
    selectedSubtitle: SubtitleChoice?,
    subSync: Double,
    captionScale: Float,
    tab: String,
    onTab: (String) -> Unit,
    onPickGroup: (PlaybackStreamGroup) -> Unit,
    onPickSub: (SubtitleChoice?) -> Unit,
    onSubSync: (Double) -> Unit,
    onCaptionScale: (Float) -> Unit,
    onRefreshSubs: () -> Unit,
) {
    val qualities = qualitiesForLang(groups, group?.lang.orEmpty())
    val langs = langChoices(groups)
    val tabs = buildList {
        if (qualities.size > 1) add("Quality" to (tab == "quality"))
        if (langs.size > 1) add("Language" to (tab == "language"))
        add("Subs" to (tab == "subs"))
    }
    SegmentTabs(tabs) { index ->
        onTab(tabs[index].first.lowercase().let { if (it == "subs") "subs" else it })
    }
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
        when (tab) {
            "quality" -> qualities.forEach { choice ->
                SelectRow(choice.quality, choice.id == group?.id) { onPickGroup(choice) }
            }
            "language" -> langs.forEach { choice ->
                SelectRow(langLabel(choice.lang), choice.lang == group?.lang) { onPickGroup(choice) }
            }
            else -> {
                SelectRow("Off", subtitleOff) { onPickSub(null) }
                subtitles.forEach { cue ->
                    SelectRow(cue.label, !subtitleOff && selectedSubtitle?.id == cue.id) { onPickSub(cue) }
                }
                if (subtitles.isEmpty() && subtitleListError == null) OverlayNote("None for this episode")
                subtitleListError?.let { OverlayNote(it) }
                subtitleBodyError?.let { OverlayNote(it) }
                Text(
                    "Find again",
                    Modifier.clickable(onClick = onRefreshSubs).padding(horizontal = 12.dp, vertical = 8.dp),
                    color = Highlight,
                    fontSize = 13.sp,
                )
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    QuietLabel("Sync")
                    Text("${if (subSync > 0) "+" else ""}${"%.2f".format(subSync)}s", color = if (subSync == 0.0) Text2 else Highlight, fontSize = 11.sp)
                }
                Slider(
                    value = subSync.toFloat(),
                    onValueChange = { onSubSync(it.toDouble()) },
                    valueRange = -10f..10f,
                    colors = SliderDefaults.colors(thumbColor = Highlight, activeTrackColor = Highlight, inactiveTrackColor = Color.White.copy(alpha = 0.2f)),
                )
                QuietLabel("Size", Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                SegmentTabs(CaptionScales.map { captionScaleLabel(it) to (captionScale == it) }) { index ->
                    onCaptionScale(CaptionScales[index])
                }
            }
        }
    }
}

@Composable
private fun PlayerCaption(
    text: String,
    scale: Float,
    liftForChrome: Boolean,
    modifier: Modifier = Modifier,
) {
    val stroke = with(LocalDensity.current) { 1.6.dp.toPx() }
    val style = TextStyle(
        fontSize = (21 * scale).sp,
        fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
        lineHeight = (28 * scale).sp,
    )
    Box(
        modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 28.dp)
            .padding(bottom = if (liftForChrome) 96.dp else 20.dp),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Text(
            text,
            style = style.copy(
                color = Color.Black.copy(alpha = 0.55f),
                drawStyle = Stroke(width = stroke, join = StrokeJoin.Round, cap = StrokeCap.Round),
                shadow = Shadow(Color.Black.copy(alpha = 0.65f), Offset(0f, 1f), blurRadius = 6f),
            ),
            textAlign = TextAlign.Center,
        )
        Text(text, style = style.copy(color = Color.White), textAlign = TextAlign.Center)
    }
}

@Composable
private fun SeekStrip(
    positionMs: Long,
    bufferedEndMs: Long,
    durationMs: Long,
    segments: List<SkipSegment>,
    onScrub: (Long) -> Unit,
    onScrubFinished: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val duration = durationMs.coerceAtLeast(1)
    val markers = skipMarkers(segments)
    fun at(x: Float, width: Float): Long {
        if (width <= 0f) return 0L
        return ((x / width).coerceIn(0f, 1f) * duration).toLong()
    }
    Canvas(
        modifier
            .fillMaxWidth()
            .height(28.dp)
            .pointerInput(duration, markers) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    var target = snapToSkipMarker(
                        at(down.position.x, size.width.toFloat()),
                        markers,
                        duration,
                        size.width.toFloat(),
                    )
                    onScrub(target)
                    drag(down.id) { change ->
                        target = at(change.position.x, size.width.toFloat())
                        onScrub(target)
                        change.consume()
                    }
                    onScrubFinished(target)
                }
            },
    ) {
        val y = size.height / 2
        val track = 2.dp.toPx()
        val played = (positionMs.toFloat() / duration).coerceIn(0f, 1f)
        val buffered = (bufferedEndMs.toFloat() / duration).coerceIn(0f, 1f)
        drawLine(
            color = Color.White.copy(alpha = 0.22f),
            start = Offset(0f, y),
            end = Offset(size.width, y),
            strokeWidth = track,
            cap = StrokeCap.Round,
        )
        if (buffered > 0f) {
            drawLine(
                color = Color.White.copy(alpha = 0.38f),
                start = Offset(0f, y),
                end = Offset(size.width * buffered, y),
                strokeWidth = track,
                cap = StrokeCap.Round,
            )
        }
        if (played > 0f) {
            drawLine(
                color = Highlight,
                start = Offset(0f, y),
                end = Offset(size.width * played, y),
                strokeWidth = track,
                cap = StrokeCap.Round,
            )
        }
        val markerHeight = 7.dp.toPx()
        val markerStroke = 1.5.dp.toPx()
        markers.forEach { marker ->
            val x = size.width * (marker.toFloat() / duration).coerceIn(0f, 1f)
            drawLine(
                color = Highlight,
                start = Offset(x, y - markerHeight),
                end = Offset(x, y + markerHeight),
                strokeWidth = markerStroke,
                cap = StrokeCap.Round,
            )
        }
        val radius = 5.dp.toPx()
        val cx = (size.width * played).coerceIn(radius, size.width - radius)
        drawCircle(Color.White, radius = radius, center = Offset(cx, y))
    }
}

private fun episodeLabel(episode: PlaybackEpisode): String {
    val prefix = episode.season?.takeIf { it > 0 }?.let { "S$it · " }.orEmpty()
    val number = episode.number.takeIf { it % 1.0 != 0.0 }?.toString() ?: episode.number.toInt().toString()
    return "${prefix}E$number · ${episode.name}"
}

private fun clock(ms: Long): String {
    val total = (ms.coerceAtLeast(0) / 1000).toInt()
    val h = total / 3600
    val m = total / 60 % 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

package app.lacrima.android.feature.reader

import android.text.Html
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.min
import kotlin.math.abs
import kotlin.math.roundToInt
import app.lacrima.android.model.ApiResult
import app.lacrima.android.ui.FadeSlideBar
import app.lacrima.android.ui.Glyph
import app.lacrima.android.ui.IconHit
import app.lacrima.android.ui.LacrimaIcon
import app.lacrima.android.ui.OverlayDrawer
import app.lacrima.android.ui.OverlayEase
import app.lacrima.android.ui.QuietLabel
import app.lacrima.android.ui.SelectRow
import app.lacrima.android.ui.lastReadChapterIndex
import app.lacrima.android.ui.theme.AccentDim
import app.lacrima.android.ui.theme.Highlight
import app.lacrima.android.ui.theme.Text
import app.lacrima.android.ui.theme.Text2
import app.lacrima.android.ui.theme.Text3
import coil3.compose.AsyncImage
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.FlowPreview

@Composable
fun ReaderScreen(
    api: ReaderApi,
    route: ReaderRoute,
    onBack: () -> Unit,
    onOpenChapter: (String, Boolean) -> Unit,
    startAtEnd: Boolean = false,
    modifier: Modifier = Modifier,
    onFullscreenChanged: (Boolean) -> Unit = {},
) {
    var result by remember(route) {
        mutableStateOf<ApiResult<ReaderDocument>?>(api.takeCached(route)?.let { ApiResult.Success(it) })
    }
    LaunchedEffect(route) {
        if (result == null) result = withContext(Dispatchers.IO) { api.load(route, cacheResult = false) }
    }
    when (val state = result) {
        null -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Highlight)
        }
        is ApiResult.Failure -> ReaderFailure(state.message, onBack, modifier)
        is ApiResult.Success -> when (state.data.content) {
            is ReaderContent.Pages -> MangaReader(
                api = api,
                document = state.data,
                onBack = onBack,
                onOpenChapter = onOpenChapter,
                startAtEnd = startAtEnd,
                modifier = modifier,
                onFullscreenChanged = onFullscreenChanged,
            )
            is ReaderContent.Html -> NovelReader(
                api = api,
                document = state.data,
                onBack = onBack,
                onOpenChapter = { onOpenChapter(it, false) },
                modifier = modifier,
                onFullscreenChanged = onFullscreenChanged,
            )
        }
    }
}

@Composable
private fun ReaderFailure(message: String, onBack: () -> Unit, modifier: Modifier) {
    Box(modifier.fillMaxSize().background(Color(0xFF0C0908)), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Nothing to show", style = MaterialTheme.typography.headlineSmall)
            Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = onBack) { Text("Back to title") }
        }
    }
}

private data class AdjacentPreviews(
    val previous: ChapterPreview?,
    val next: ChapterPreview?,
    val ready: Boolean = false,
)

private suspend fun measurePages(urls: List<String>): List<Int> = withContext(Dispatchers.IO) {
    val gate = Semaphore(4)
    coroutineScope {
        urls.map { url -> async { gate.withPermit { probeImageHeight(url) } } }.awaitAll()
    }
}

private fun cachedPreview(api: ReaderApi, route: ReaderRoute, chapterId: String?): ChapterPreview? {
    if (chapterId == null) return null
    val document = api.cached(route.copy(chapterId = chapterId)) ?: return null
    val pages = document.content as? ReaderContent.Pages ?: return null
    val urls = pages.urls.map(api::absolute)
    val heights = cachedImageHeights(urls) ?: return null
    return ChapterPreview(chapterId, urls, stitchPageGroups(heights))
}

private suspend fun loadPreview(
    api: ReaderApi,
    route: ReaderRoute,
    chapterId: String?,
    trackProgress: Boolean? = null,
): ChapterPreview? {
    if (chapterId == null) return null
    val target = route.copy(chapterId = chapterId)
    val loaded = when (val result = api.load(target)) {
        is ApiResult.Failure -> return null
        is ApiResult.Success -> result.data
    }
    val document = trackProgress?.let { loaded.copy(trackProgress = it) } ?: loaded
    api.putCached(target, document)
    val pages = document.content as? ReaderContent.Pages ?: return null
    val urls = pages.urls.map(api::absolute)
    val heights = cachedImageHeights(urls) ?: measurePages(urls)
    val stacks = if (heights.any { it > 0 }) stitchPageGroups(heights) else urls.indices.map { listOf(it) }
    return ChapterPreview(chapterId, urls, stacks)
}

@OptIn(ExperimentalFoundationApi::class, FlowPreview::class)
@Composable
private fun MangaReader(
    api: ReaderApi,
    document: ReaderDocument,
    onBack: () -> Unit,
    onOpenChapter: (String, Boolean) -> Unit,
    startAtEnd: Boolean,
    modifier: Modifier,
    onFullscreenChanged: (Boolean) -> Unit,
) {
    val urls = (document.content as ReaderContent.Pages).urls.map(api::absolute)
    val context = LocalContext.current
    val storeKey = "${document.media.via}:${document.media.id}"
    val store = remember { ReaderPrefsStore(context.applicationContext) }
    var prefs by remember(storeKey) { mutableStateOf(store.read(storeKey, document.settings)) }
    var chrome by remember { mutableStateOf(true) }
    var menu by remember { mutableStateOf(false) }
    var fullscreen by remember { mutableStateOf(true) }
    val initial = if (startAtEnd) urls.lastIndex else (document.initialAnchor as? ReaderAnchor.Page)?.index ?: 0
    var page by remember(document.route.chapterId) { mutableIntStateOf(safePage(initial, urls.size)) }
    val writer = remember { CoroutineScope(SupervisorJob() + Dispatchers.IO) }
    val visible = chrome || menu
    var heights by remember(urls) { mutableStateOf(cachedImageHeights(urls)) }
    LaunchedEffect(urls) {
        if (heights == null) heights = measurePages(urls)
    }
    val stacksReady = heights != null || prefs.mode == "webtoon"
    val stacks = remember(heights, urls.size) {
        val measured = heights
        if (measured != null && measured.size == urls.size && measured.any { it > 0 }) {
            stitchPageGroups(measured)
        } else {
            urls.indices.map { listOf(it) }
        }
    }
    var adjacent by remember(document.route) {
        mutableStateOf(
            AdjacentPreviews(
                previous = cachedPreview(api, document.route, document.previousChapterId),
                next = cachedPreview(api, document.route, document.nextChapterId),
            ),
        )
    }
    LaunchedEffect(document.route) {
        adjacent = coroutineScope {
            val previous = async(Dispatchers.IO) {
                loadPreview(api, document.route, document.previousChapterId, trackProgress = false)
            }
            val next = async(Dispatchers.IO) { loadPreview(api, document.route, document.nextChapterId) }
            AdjacentPreviews(previous.await(), next.await(), ready = true)
        }
    }
    val imageLoader = remember(context) { SingletonImageLoader.get(context.applicationContext) }
    LaunchedEffect(adjacent) {
        val warm = adjacent.next?.urls.orEmpty() + adjacent.previous?.urls.orEmpty().asReversed()
        warm.forEach { url -> imageLoader.enqueue(ImageRequest.Builder(context).data(url).build()) }
    }

    LaunchedEffect(document.route.chapterId) { onFullscreenChanged(true) }
    LaunchedEffect(prefs) { store.write(storeKey, prefs) }
    LaunchedEffect(page, urls.size) {
        if (urls.isEmpty() || !document.trackProgress) return@LaunchedEffect
        delay(650)
        withContext(Dispatchers.IO) {
            api.writeProgress(document.progress, ReaderAnchor.Page(page, urls.size))
        }
    }
    DisposableEffect(document.route.chapterId) {
        onDispose {
            if (urls.isNotEmpty() && document.trackProgress) writer.launch {
                api.writeProgress(document.progress, ReaderAnchor.Page(page, urls.size))
            }
            onFullscreenChanged(false)
        }
    }
    BackHandler {
        when {
            menu -> menu = false
            !chrome -> chrome = true
            else -> onBack()
        }
    }

    fun onStageTap(x: Float, y: Float, width: Float, height: Float) {
        fun stepPage(direction: Int) {
            val next = groupIndexForPage(stacks, page) + direction * if (prefs.spread == "double") 2 else 1
            when {
                next < 0 -> document.previousChapterId?.let { onOpenChapter(it, true) }
                next >= stacks.size -> document.nextChapterId?.let { onOpenChapter(it, false) }
                else -> page = pageStepGroups(page, direction, stacks, prefs.spread)
            }
        }
        when (tapZone(x, y, width, height)) {
            "top" -> {
                menu = true
                chrome = true
            }
            "left" -> stepPage(if (prefs.rtl) 1 else -1)
            "right" -> stepPage(if (prefs.rtl) -1 else 1)
            else -> {
                chrome = !chrome
                menu = false
            }
        }
    }

    Box(modifier.fillMaxSize().background(Color(0xFF070605))) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                ZoomableContent("${document.route.chapterId}:${prefs.mode}", prefs.mode == "webtoon") {
                    when {
                        prefs.mode == "webtoon" -> WebtoonPages(
                            urls = urls,
                            initialPage = page,
                            onPage = { page = it },
                            onTap = ::onStageTap,
                        )
                        !stacksReady -> CircularProgressIndicator(color = Highlight)
                        else -> key(document.route.chapterId) {
                            PagedPages(
                                urls = urls,
                                stacks = stacks,
                                initialPage = page,
                                prefs = prefs,
                                previousChapterId = document.previousChapterId,
                                nextChapterId = document.nextChapterId,
                                previous = adjacent.previous,
                                next = adjacent.next,
                                previewsReady = adjacent.ready,
                                onPage = { page = it },
                                onOpenChapter = onOpenChapter,
                                onTap = ::onStageTap,
                            )
                        }
                    }
                }
            }
            PageSlit(
                page = groupIndexForPage(stacks, page),
                pageCount = stacks.size,
                rtl = prefs.rtl,
                stride = if (prefs.spread == "double") 2 else 1,
                onPage = { page = stacks.getOrNull(safePage(it, stacks.size))?.first() ?: 0 },
            )
        }

        OverlayDrawer(visible = menu, onDismiss = { menu = false }) {
            QuietLabel("Direction")
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Opt("LTR", prefs.rtl.not(), Glyph.ltr, Modifier.weight(1f)) { prefs = prefs.copy(rtl = false) }
                Opt("RTL", prefs.rtl, Glyph.rtl, Modifier.weight(1f)) { prefs = prefs.copy(rtl = true) }
            }
            QuietLabel("Mode")
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Opt("Paged", prefs.mode == "paged", Glyph.paged, Modifier.weight(1f)) { prefs = prefs.copy(mode = "paged") }
                Opt("Webtoon", prefs.mode == "webtoon", Glyph.webtoon, Modifier.weight(1f)) { prefs = prefs.copy(mode = "webtoon") }
            }
            QuietLabel("Fit")
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Opt("Height", prefs.fit == "height", Glyph.fitH, Modifier.weight(1f)) { prefs = prefs.copy(fit = "height") }
                Opt("Width", prefs.fit == "width", Glyph.fitW, Modifier.weight(1f)) { prefs = prefs.copy(fit = "width") }
                Opt("Screen", prefs.fit == "contain", Glyph.fitBox, Modifier.weight(1f)) { prefs = prefs.copy(fit = "contain") }
            }
            QuietLabel("Pages")
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Opt("Single", prefs.spread == "single", Glyph.single, Modifier.weight(1f)) { prefs = prefs.copy(spread = "single") }
                Opt("Double", prefs.spread == "double", Glyph.double, Modifier.weight(1f)) { prefs = prefs.copy(spread = "double") }
            }
            if (document.chapters.isNotEmpty()) {
                val currentChapter = document.chapters.indexOfFirst { it.id == document.route.chapterId }
                val lastRead = lastReadChapterIndex(document.chapters.size, currentChapter, document.progress.unit)
                val errorOffset = if (document.chapterError == null) 0 else 1
                val chapterStart = errorOffset + (lastRead?.minus(1)?.coerceAtLeast(0) ?: 0)
                val chapterList = rememberLazyListState(chapterStart)
                LaunchedEffect(menu, document.route.chapterId, document.progress.unit) {
                    if (menu) chapterList.scrollToItem(chapterStart)
                }
                QuietLabel("Chapters")
                LazyColumn(
                    state = chapterList,
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(1.dp),
                ) {
                    if (document.chapterError != null) {
                        item { Text(document.chapterError, color = Text2, fontSize = 13.sp) }
                    }
                    itemsIndexed(document.chapters, key = { _, chapter -> chapter.id }) { _, chapter ->
                        SelectRow(
                            title = chapter.name,
                            selected = chapter.id == document.route.chapterId,
                            onClick = { onOpenChapter(chapter.id, false) },
                            meta = chapter.number.takeIf { it > 0 }?.let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() },
                        )
                    }
                    item { Spacer(Modifier.fillParentMaxHeight()) }
                }
            }
        }

        FadeSlideBar(visible = visible, fromTop = true, modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth()) {
            ReaderTopBar(
                title = document.media.title,
                chapter = document.chapter.name,
                page = groupIndexForPage(stacks, page),
                pageCount = stacks.size,
                menu = menu,
                onBack = onBack,
                onToggleMenu = {
                    menu = !menu
                    chrome = true
                },
                onFullscreen = {
                    fullscreen = !fullscreen
                    onFullscreenChanged(fullscreen)
                },
            )
        }
        FadeSlideBar(visible = visible, fromTop = false, modifier = Modifier.align(Alignment.BottomStart).navigationBarsPadding().padding(start = 8.dp, bottom = 22.dp)) {
            IconHit(
                onClick = {
                    if (prefs.rtl) document.nextChapterId?.let { onOpenChapter(it, false) }
                    else document.previousChapterId?.let { onOpenChapter(it, true) }
                },
                label = if (prefs.rtl) "Next chapter" else "Previous chapter",
                enabled = if (prefs.rtl) document.nextChapterId != null else document.previousChapterId != null,
            ) {
                val target = if (prefs.rtl) document.nextChapterId else document.previousChapterId
                LacrimaIcon(Glyph.prevCh, filled = true, tint = if (target != null) Color.White else Text3)
            }
        }
        FadeSlideBar(visible = visible, fromTop = false, modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 8.dp, bottom = 22.dp)) {
            IconHit(
                onClick = {
                    if (prefs.rtl) document.previousChapterId?.let { onOpenChapter(it, true) }
                    else document.nextChapterId?.let { onOpenChapter(it, false) }
                },
                label = if (prefs.rtl) "Previous chapter" else "Next chapter",
                enabled = if (prefs.rtl) document.previousChapterId != null else document.nextChapterId != null,
            ) {
                val target = if (prefs.rtl) document.previousChapterId else document.nextChapterId
                LacrimaIcon(Glyph.nextCh, filled = true, tint = if (target != null) Color.White else Text3)
            }
        }
    }
}

@Composable
private fun ZoomableContent(
    resetKey: Any,
    keepVerticalScroll: Boolean,
    content: @Composable BoxScope.() -> Unit,
) {
    var scale by remember(resetKey) { mutableFloatStateOf(1f) }
    var offset by remember(resetKey) { mutableStateOf(Offset.Zero) }
    var size by remember(resetKey) { mutableStateOf(IntSize.Zero) }
    val transform = rememberTransformableState { centroid, zoom, pan, _ ->
        val nextScale = (scale * zoom).coerceIn(1f, 4f)
        val maxX = size.width * (nextScale - 1f) / 2f
        val maxY = size.height * (nextScale - 1f) / 2f
        val anchor = centroid - Offset(size.width / 2f, size.height / 2f)
        val nextOffset = anchor + (offset - anchor) * (nextScale / scale) + pan
        offset = if (nextScale == 1f) Offset.Zero else Offset(
            nextOffset.x.coerceIn(-maxX, maxX),
            nextOffset.y.coerceIn(-maxY, maxY),
        )
        scale = nextScale
    }
    Box(Modifier.fillMaxSize().clipToBounds().onSizeChanged { size = it }) {
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                }
                .transformable(transform, canPan = { pan ->
                    scale > 1f && (!keepVerticalScroll || abs(pan.x) > abs(pan.y))
                }),
            content = content,
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PagedPages(
    urls: List<String>,
    stacks: List<List<Int>>,
    initialPage: Int,
    prefs: ReaderPrefs,
    previousChapterId: String?,
    nextChapterId: String?,
    previous: ChapterPreview?,
    next: ChapterPreview?,
    previewsReady: Boolean,
    onPage: (Int) -> Unit,
    onOpenChapter: (String, Boolean) -> Unit,
    onTap: (Float, Float, Float, Float) -> Unit,
) {
    val spread = if (prefs.spread == "double") 2 else 1
    val groupCount = (stacks.size + spread - 1) / spread
    val leading = if (previousChapterId != null) 1 else 0
    val trailing = if (nextChapterId != null) 1 else 0
    val initialGroup = leading + (groupIndexForPage(stacks, initialPage) / spread)
        .coerceIn(0, (groupCount - 1).coerceAtLeast(0))
    val pager = rememberPagerState(
        initialPage = initialGroup,
        pageCount = { (leading + groupCount + trailing).coerceAtLeast(1) },
    )
    LaunchedEffect(initialPage, spread, stacks, leading) {
        val target = leading + (groupIndexForPage(stacks, initialPage) / spread)
            .coerceIn(0, (groupCount - 1).coerceAtLeast(0))
        if (target != pager.currentPage) pager.scrollToPage(target)
    }
    LaunchedEffect(pager, spread, stacks, leading, previousChapterId, nextChapterId, previous, next, previewsReady) {
        var leaving = false
        snapshotFlow { pager.settledPage }
            .distinctUntilChanged()
            .collect { settled ->
                when {
                    settled < leading && previousChapterId != null && (previous != null || previewsReady) && !leaving -> {
                        leaving = true
                        onOpenChapter(previousChapterId, true)
                    }
                    settled >= leading + groupCount && nextChapterId != null && (next != null || previewsReady) && !leaving -> {
                        leaving = true
                        onOpenChapter(nextChapterId, false)
                    }
                    settled in leading until leading + groupCount -> {
                        val stackAt = safePage((settled - leading) * spread, stacks.size)
                        onPage(stacks.getOrNull(stackAt)?.first() ?: 0)
                    }
                }
            }
    }
    HorizontalPager(
        state = pager,
        reverseLayout = prefs.rtl,
        beyondViewportPageCount = 1,
        modifier = Modifier.fillMaxSize(),
    ) { pagerPage ->
        if (pagerPage < leading) {
            PreviewPage(previous, fromEnd = true, spread, prefs, onTap)
            return@HorizontalPager
        }
        if (pagerPage >= leading + groupCount) {
            PreviewPage(next, fromEnd = false, spread, prefs, onTap)
            return@HorizontalPager
        }
        val group = pagerPage - leading
        Row(
            Modifier.fillMaxSize().pointerTap(onTap),
            horizontalArrangement = Arrangement.Center,
        ) {
            val indices = (0 until spread).map { group * spread + it }.filter { it in stacks.indices }
            val ordered = if (prefs.rtl && spread > 1) indices.reversed() else indices
            for (stackIndex in ordered) {
                PageStack(
                    urls = urls,
                    indices = stacks[stackIndex],
                    fit = prefs.fit,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
            }
        }
    }
}

@Composable
private fun PreviewPage(
    preview: ChapterPreview?,
    fromEnd: Boolean,
    spread: Int,
    prefs: ReaderPrefs,
    onTap: (Float, Float, Float, Float) -> Unit,
) {
    if (preview == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Highlight)
        }
        return
    }
    val chosen = if (fromEnd) preview.stacks.takeLast(spread) else preview.stacks.take(spread)
    val ordered = if (prefs.rtl && spread > 1) chosen.reversed() else chosen
    Row(
        Modifier.fillMaxSize().pointerTap(onTap),
        horizontalArrangement = Arrangement.Center,
    ) {
        for (indices in ordered) {
            PageStack(
                urls = preview.urls,
                indices = indices,
                fit = prefs.fit,
                modifier = Modifier.weight(1f).fillMaxHeight(),
            )
        }
    }
}

@Composable
private fun PageStack(
    urls: List<String>,
    indices: List<Int>,
    fit: String,
    modifier: Modifier = Modifier,
) {
    if (indices.size <= 1) {
        val index = indices.firstOrNull() ?: return
        ReaderImage(urls[index], fit, modifier)
        return
    }
    // Stitched fragments: join edge-to-edge. Height/contain scale the whole
    // stack into the stage and keep it centered; width-fit scrolls from the top.
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        if (fit == "width") {
            Column(
                Modifier
                    .fillMaxWidth()
                    .fillMaxHeight()
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                for (index in indices) {
                    AsyncImage(
                        model = urls[index],
                        contentDescription = null,
                        contentScale = ContentScale.FillWidth,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        } else {
            Column(
                Modifier
                    .fillMaxWidth()
                    .fitStackInBounds(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                for (index in indices) {
                    AsyncImage(
                        model = urls[index],
                        contentDescription = null,
                        contentScale = ContentScale.FillWidth,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

/** Measure the stack, then shrink it uniformly so it fits the stage — same idea as ContentScale.Fit. */
private fun Modifier.fitStackInBounds(): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(
        constraints.copy(minWidth = 0, minHeight = 0, maxHeight = Constraints.Infinity),
    )
    val scale = min(
        1f,
        min(
            constraints.maxWidth / placeable.width.toFloat().coerceAtLeast(1f),
            constraints.maxHeight / placeable.height.toFloat().coerceAtLeast(1f),
        ),
    )
    val width = (placeable.width * scale).roundToInt().coerceAtLeast(1)
    val height = (placeable.height * scale).roundToInt().coerceAtLeast(1)
    layout(width, height) {
        placeable.placeWithLayer(0, 0) {
            scaleX = scale
            scaleY = scale
            transformOrigin = TransformOrigin(0f, 0f)
        }
    }
}

@OptIn(FlowPreview::class)
@Composable
private fun WebtoonPages(
    urls: List<String>,
    initialPage: Int,
    onPage: (Int) -> Unit,
    onTap: (Float, Float, Float, Float) -> Unit,
) {
    val list = rememberLazyListState(initialFirstVisibleItemIndex = safePage(initialPage, urls.size))
    LaunchedEffect(list) {
        snapshotFlow { list.firstVisibleItemIndex }
            .distinctUntilChanged()
            .debounce(300)
            .collectLatest(onPage)
    }
    LazyColumn(state = list, modifier = Modifier.fillMaxSize().pointerTap(onTap)) {
        itemsIndexed(urls, key = { index, url -> "$index:$url" }) { _, url ->
            AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun ReaderImage(url: String, fit: String, modifier: Modifier = Modifier) {
    when (fit) {
        "width" -> Column(
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        "contain" -> AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = modifier.fillMaxSize(),
        )
        else -> AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = modifier.fillMaxSize(),
        )
    }
}

private fun Modifier.pointerTap(onTap: (Float, Float, Float, Float) -> Unit): Modifier =
    this.then(Modifier.pointerInput(Unit) {
        detectTapGestures { point -> onTap(point.x, point.y, size.width.toFloat(), size.height.toFloat()) }
    })

@Composable
private fun ReaderTopBar(
    title: String,
    chapter: String,
    page: Int,
    pageCount: Int,
    menu: Boolean,
    onBack: () -> Unit,
    onToggleMenu: () -> Unit,
    onFullscreen: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color(0xDB000000), Color.Transparent)))
            .padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconHit(onClick = onBack, label = "Back to the title") {
            LacrimaIcon(Glyph.arrow, filled = false, tint = Color.White)
        }
        Column(Modifier.weight(1f)) {
            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium, color = Text, fontSize = 16.sp)
            Text(
                "$chapter  ${page + 1} / $pageCount",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = Text2,
                fontSize = 12.sp,
            )
        }
        IconHit(onClick = onToggleMenu, label = "Reading options") {
            LacrimaIcon(Glyph.menu, filled = false, tint = if (menu) Highlight else Color.White)
        }
        IconHit(onClick = onFullscreen, label = "Fullscreen") {
            LacrimaIcon(Glyph.full, filled = false, tint = Color.White)
        }
    }
}

@Composable
private fun Opt(label: String, on: Boolean, glyph: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
            .background(if (on) AccentDim else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        LacrimaIcon(glyph, filled = false, tint = if (on) Highlight else Text2)
        Text(label, color = if (on) Highlight else Text2, fontSize = 11.sp)
    }
}

@Composable
private fun PageSlit(
    page: Int,
    pageCount: Int,
    rtl: Boolean,
    stride: Int,
    onPage: (Int) -> Unit,
) {
    if (pageCount <= 1) {
        Spacer(Modifier.height(4.dp).fillMaxWidth().navigationBarsPadding())
        return
    }
    val t = page / (pageCount - 1).toFloat()
    val sliderPage = seekbarPage(page, pageCount, rtl)
    val fill by animateFloatAsState(
        targetValue = t.coerceIn(0f, 1f),
        animationSpec = tween(160, easing = OverlayEase),
        label = "slit",
    )
    Box(Modifier.fillMaxWidth().height(18.dp).navigationBarsPadding()) {
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp).background(Color(0x24FFFFFF)))
        Box(
            Modifier.align(if (rtl) Alignment.BottomEnd else Alignment.BottomStart)
                .fillMaxWidth(fill)
                .height(4.dp)
                .background(Highlight),
        )
        Slider(
            value = sliderPage.toFloat(),
            onValueChange = { onPage(seekbarPage(it.roundToInt(), pageCount, rtl)) },
            valueRange = 0f..(pageCount - 1).toFloat(),
            steps = ((pageCount - 1) / stride).coerceAtLeast(0),
            modifier = Modifier.fillMaxSize(),
            colors = SliderDefaults.colors(
                thumbColor = Color.Transparent,
                activeTrackColor = Color.Transparent,
                inactiveTrackColor = Color.Transparent,
                activeTickColor = Color.Transparent,
                inactiveTickColor = Color.Transparent,
            ),
        )
    }
}

@OptIn(FlowPreview::class)
@Composable
private fun NovelReader(
    api: ReaderApi,
    document: ReaderDocument,
    onBack: () -> Unit,
    onOpenChapter: (String) -> Unit,
    modifier: Modifier,
    onFullscreenChanged: (Boolean) -> Unit = {},
) {
    val paragraphs = remember(document.route.chapterId) {
        htmlParagraphs((document.content as ReaderContent.Html).html)
    }
    val initial = (document.initialAnchor as? ReaderAnchor.Paragraph)?.index ?: 0
    val list = rememberLazyListState(initialFirstVisibleItemIndex = safePage(initial, paragraphs.size))
    var paragraph by remember(document.route.chapterId) { mutableIntStateOf(safePage(initial, paragraphs.size)) }
    var chrome by remember { mutableStateOf(true) }
    val writer = remember { CoroutineScope(SupervisorJob() + Dispatchers.IO) }

    LaunchedEffect(document.route.chapterId) { onFullscreenChanged(true) }
    LaunchedEffect(list) {
        snapshotFlow { list.firstVisibleItemIndex }
            .distinctUntilChanged()
            .debounce(650)
            .collectLatest {
                paragraph = it
                if (document.trackProgress) withContext(Dispatchers.IO) {
                    api.writeProgress(document.progress, ReaderAnchor.Paragraph(it))
                }
            }
    }
    DisposableEffect(document.route.chapterId) {
        onDispose {
            if (document.trackProgress) writer.launch {
                api.writeProgress(document.progress, ReaderAnchor.Paragraph(paragraph))
            }
            onFullscreenChanged(false)
        }
    }
    BackHandler { if (!chrome) chrome = true else onBack() }

    Box(modifier.fillMaxSize().background(Color(0xFF0C0908))) {
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize().pointerTap { x, _, width, _ ->
                val fraction = if (width <= 0f) .5f else x / width
                if (fraction in .34f..0.66f) chrome = !chrome
            },
            contentPadding = androidx.compose.foundation.layout.PaddingValues(24.dp, 76.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            itemsIndexed(paragraphs, key = { index, _ -> index }) { _, text ->
                Text(text, style = MaterialTheme.typography.bodyLarge, color = Color(0xFFE9E3DF))
            }
        }
        FadeSlideBar(visible = chrome, fromTop = true, modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth()) {
            ReaderTopBar(
                title = document.media.title,
                chapter = document.chapter.name,
                page = paragraph,
                pageCount = paragraphs.size.coerceAtLeast(1),
                menu = false,
                onBack = onBack,
                onToggleMenu = {},
                onFullscreen = { onFullscreenChanged(true) },
            )
        }
    }
}

internal fun htmlParagraphs(html: String): List<String> {
    val blocks = html
        .replace(Regex("(?is)<script[^>]*>.*?</script>"), "")
        .replace(Regex("(?i)</?(?:p|div|h[1-6]|li|blockquote|br)[^>]*>"), "\n\n")
        .split(Regex("\n\\s*\n+"))
        .map { Html.fromHtml(it, Html.FROM_HTML_MODE_COMPACT).toString().trim() }
        .filter(String::isNotBlank)
    return blocks.ifEmpty {
        listOf(Html.fromHtml(html, Html.FROM_HTML_MODE_COMPACT).toString().trim()).filter(String::isNotBlank)
    }
}

package app.lacrima.android.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lacrima.android.AppModel
import app.lacrima.android.LoadState
import app.lacrima.android.R
import app.lacrima.android.model.*
import app.lacrima.android.navigation.Destination
import app.lacrima.android.ui.theme.*
import coil3.compose.AsyncImage

private val genres = listOf("Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural")

@Composable
fun ConnectionScreen(model: AppModel) {
    var url by remember { mutableStateOf("") }
    var invalid by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(Canvas).padding(28.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 440.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Image(painterResource(R.drawable.lacrima_logo), contentDescription = "Lacrima", Modifier.size(160.dp))
            Text("Connect to your server", style = MaterialTheme.typography.titleMedium, color = Text2)
            OutlinedTextField(
                value = url,
                onValueChange = { url = it; invalid = false },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Server URL") },
                placeholder = { Text("https://lacrima.example.ts.net or http://192.168.1.224:7345") },
                singleLine = true,
                isError = invalid,
                supportingText = if (invalid) ({ Text("Enter an HTTPS origin, or a private LAN HTTP IP, with no path.") }) else null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { model.connect(url) { invalid = true } }),
            )
            Button(onClick = { model.connect(url) { invalid = true } }, Modifier.fillMaxWidth()) { Text("Connect") }
            Text("HTTPS is preferred. HTTP is allowed only for a private LAN IP; never use it on a shared network.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun HomeScreen(state: LoadState<HomeData>, retry: () -> Unit, open: (Media) -> Unit) {
    Loadable(state, retry) { home ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(27.dp)) {
            home.hero?.let { item { Hero(it, open) } }
            home.degradedVia?.let { item { DegradedNote(it) } }
            items(home.rails, key = Rail::title) { MediaRail(it, open) }
            if (home.hero == null && home.rails.isEmpty()) item { EmptyState("Home is quiet", "Add titles to your library or check back later.") }
        }
    }
}

@Composable
private fun Hero(media: Media, open: (Media) -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = 330.dp)) {
        val art = media.banner ?: media.cover
        art?.let { AsyncImage(it, null, Modifier.matchParentSize(), contentScale = ContentScale.Crop) }
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Canvas.copy(alpha = .15f), Canvas.copy(alpha = .96f)))))
        Column(
            Modifier.align(Alignment.BottomStart).padding(20.dp).widthIn(max = 620.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("TRENDING NOW", style = MaterialTheme.typography.labelSmall)
            Text(media.title, style = MaterialTheme.typography.displayLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                media.score?.let { Badge("$it% rated") }
                Badge(media.kind.wire)
                media.units?.let { Badge("$it ${media.unitLabel}") }
            }
            media.description?.let { Text(it, color = Text2, maxLines = 3, overflow = TextOverflow.Ellipsis) }
            Button(onClick = { open(media) }) { Text("View title") }
        }
    }
}

@Composable
private fun Badge(value: String) {
    Text(value, Modifier.background(Surface2, RoundedCornerShape(4.dp)).padding(horizontal = 7.dp, vertical = 3.dp), style = MaterialTheme.typography.bodySmall)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BrowseScreen(
    target: Destination.Browse,
    state: LoadState<BrowseData>,
    retry: () -> Unit,
    filter: (String?) -> Unit,
    open: (Media) -> Unit,
    page: (Int) -> Unit = {},
) {
    Loadable(state, retry) { data ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(27.dp)) {
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { QuietChip("All", target.genre == null) { filter(null) } }
                    items(genres.size) { index ->
                        val genre = genres[index]
                        QuietChip(genre, target.genre == genre) { filter(genre) }
                    }
                }
            }
            data.degradedVia?.let { item { DegradedNote(it) } }
            items(data.rails, key = Rail::title) { MediaRail(it, open) }
            item {
                Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(target.genre ?: "All titles", style = MaterialTheme.typography.titleMedium)
                    if (data.grid.isEmpty()) EmptyState("Nothing in this genre yet", "Try another filter, or search by name.")
                    else PosterGrid(data.grid, open)
                    if (target.page > 1 || data.hasMore) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        if (target.page > 1) OutlinedButton({ page(target.page - 1) }) { Text("Previous") } else Spacer(Modifier.width(1.dp))
                        if (data.hasMore) Button({ page(target.page + 1) }) { Text("Next") }
                    }
                }
            }
        }
    }
}

@Composable
fun SearchScreen(initial: String, state: LoadState<SearchData>, search: (String) -> Unit, retry: () -> Unit, open: (Media) -> Unit) {
    var query by remember(initial) { mutableStateOf(initial) }
    Column(Modifier.fillMaxSize().padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        OutlinedTextField(
            query,
            { query = it },
            Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            placeholder = { Text("Search everything") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { search(query) }),
            trailingIcon = { TextButton({ search(query) }) { Text("Search") } },
        )
        when {
            query.isBlank() && state !is LoadState.Loading -> EmptyState("Find something", "Search anime, manga and novels by title.")
            else -> Loadable(state, retry) { results ->
                LazyColumn(verticalArrangement = Arrangement.spacedBy(26.dp), contentPadding = PaddingValues(bottom = 28.dp)) {
                    if (results.groups.isEmpty()) item { EmptyState("No matches", "Try another title or spelling.") }
                    items(results.groups, key = Rail::title) { MediaRail(it, open) }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun YoursScreen(
    state: LoadState<LibraryData>,
    retry: () -> Unit,
    open: (Media) -> Unit,
    update: (LibraryItem) -> Unit,
    wallpaper: String? = null,
    openStickers: () -> Unit = {},
) {
    var status by remember { mutableStateOf("all") }
    Loadable(state, retry) { data ->
        val library = data.items
        val filtered = if (status == "all") library else library.filter { it.status == status }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            item {
                Box(Modifier.fillMaxWidth().heightIn(min = 190.dp).clip(RoundedCornerShape(12.dp)).background(accent(null).copy(alpha = .35f))) {
                    wallpaper?.let { AsyncImage(it, null, Modifier.matchParentSize(), contentScale = ContentScale.Crop) }
                    Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Canvas.copy(alpha = .15f), Canvas.copy(alpha = .92f)))))
                    Column(Modifier.align(Alignment.BottomStart).padding(18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text("Yours", style = MaterialTheme.typography.displayLarge)
                        Text("${data.total} titles · ${data.shelf.size} pinned", color = Text2)
                    }
                }
            }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat("Episodes", data.facts.episodes.toString(), Modifier.weight(1f))
                    Stat("Chapters", data.facts.chapters.toString(), Modifier.weight(1f))
                    Stat("Hours", data.facts.hours.toString(), Modifier.weight(1f))
                    Stat("Streak", "${data.facts.streak}d", Modifier.weight(1f))
                }
            }
            if (data.monthMix.any { it.count > 0 }) item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("This month", style = MaterialTheme.typography.titleMedium)
                    Text(data.monthMix.filter { it.count > 0 }.joinToString(" · ") { "${it.label} ${it.percent}%" }, color = Text2)
                }
            }
            item {
                OutlinedButton(onClick = openStickers, modifier = Modifier.fillMaxWidth()) {
                    Text("Sticker album · ${data.stickersEarned} earned")
                }
            }
            val pins = data.shelf.map(LibraryItem::media)
            if (pins.isNotEmpty()) item { MediaRail(Rail("Pinned shelf", pins), open) }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(listOf("all", "reading", "planned", "completed", "hold", "dropped")) { value ->
                        val label = if (value == "hold") "On hold" else value.replaceFirstChar(Char::uppercase)
                        QuietChip(label, status == value) { status = value }
                    }
                }
            }
            if (filtered.isEmpty()) item { EmptyState("Your shelf is empty", "Add a title or choose another status filter.") }
            else item {
                PosterGrid(filtered.map(LibraryItem::media), open) { media ->
                    val entry = filtered.first { it.media.id == media.id && it.media.via == media.via }
                    TextButton({ update(entry) }, Modifier.align(Alignment.TopEnd).background(Canvas.copy(alpha = .75f), RoundedCornerShape(6.dp))) {
                        Text(if (entry.pinned) "★" else "☆", color = Highlight)
                    }
                }
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(modifier, color = Surface1, shape = RoundedCornerShape(8.dp)) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(value, style = MaterialTheme.typography.titleMedium)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TitleScreen(
    state: LoadState<TitleData>,
    retry: () -> Unit,
    play: (Media, String) -> Unit,
    saveLibrary: (Media, String, Int?, Boolean) -> Unit,
    removeHistory: (Media) -> Unit = {},
    research: (String) -> Unit = {},
    bind: (SourceCandidate) -> Unit = {},
    refreshChapters: () -> Unit = {},
    selectPart: (String?) -> Unit = {},
    openSources: () -> Unit = {},
    markProgress: (Chapter, Int, Boolean, Boolean) -> Unit = { _, _, _, _ -> },
    error: ApiResult.Failure? = null,
    dismissError: () -> Unit = {},
) {
    Loadable(state, retry) { data ->
        var libraryOpen by remember(data.media.id) { mutableStateOf(false) }
        var matchOpen by remember(data.media.id) { mutableStateOf(false) }
        var markFor by remember(data.media.id) { mutableStateOf<Chapter?>(null) }
        var markOpen by remember(data.media.id) { mutableStateOf(false) }
        var sourceQuery by remember(data.media.id) { mutableStateOf("") }
        val shown = data.selectedMedia
        val series = (data.seriesResult as? ApiResult.Success)?.data
        val unit = data.progress?.unit?.toInt() ?: 0
        val readingId = data.resumeChapterId
        val current = data.chapters.indexOfFirst { it.id == readingId }
        val lastRead = lastReadChapterIndex(
            data.chapters.size,
            current,
            unit,
            data.library?.status == "completed",
        )
        val chapterStart = lastRead?.minus(1)?.coerceAtLeast(0) ?: 0
        val chapterList = rememberLazyListState(chapterStart)
        LaunchedEffect(shown.id, lastRead) {
            chapterList.scrollToItem(chapterStart)
        }
        val watchedWord = if (shown.kind == MediaKind.ANIME) "watched" else "read"
        Box(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            item {
                Box(Modifier.fillMaxWidth().heightIn(min = 330.dp)) {
                    (shown.banner ?: shown.cover)?.let { AsyncImage(it, null, Modifier.matchParentSize(), contentScale = ContentScale.Crop) }
                    Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Canvas.copy(.2f), Canvas))))
                    Column(Modifier.align(Alignment.BottomStart).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(data.heading.ifBlank { shown.title }, style = MaterialTheme.typography.displayLarge)
                        Text(shown.genres.take(3).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                        shown.description?.let { Text(it, color = Text2, maxLines = 4, overflow = TextOverflow.Ellipsis) }
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            val first = data.resumeChapterId ?: data.chapters.firstOrNull()?.id
                            Button(
                                onClick = { first?.let { play(shown, it) } },
                                enabled = first != null,
                                modifier = Modifier.height(40.dp),
                                shape = RoundedCornerShape(6.dp),
                                contentPadding = PaddingValues(horizontal = 14.dp),
                            ) {
                                Text(if (data.resumeChapterId != null) "Continue" else if (shown.kind == MediaKind.ANIME) "Watch" else "Read")
                            }
                            GhostButton(data.library?.status?.let(::libraryLabel) ?: "Add to yours") { libraryOpen = true }
                        }
                    }
                }
            }
            if (series != null && series.parts.size + series.specials.size > 1) item {
                LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(series.parts, key = SeriesPart::id) { part ->
                        QuietChip(part.label.ifBlank { part.title }, data.selected.id == part.id && !data.selected.specials) { selectPart(part.id.toString()) }
                    }
                    if (series.specials.isNotEmpty()) item {
                        QuietChip("Specials", data.selected.specials) { selectPart("specials") }
                    }
                }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        data.binding?.let { "${if (shown.kind == MediaKind.ANIME) "Watching" else "Reading"} from ${it.sourceName}" }
                            ?: "No reading source matched",
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    QuietLink("Change") { matchOpen = true; research("") }
                    QuietLink("Refresh", enabled = data.binding != null, onClick = refreshChapters)
                }
            }
            if (data.matchTier == "weak") item { DegradedNote("a low-confidence source match — check the alternatives") }
            (data.chaptersResult as? ApiResult.Failure)?.let { failure ->
                item { FailureCard(failure, refreshChapters) }
            }
            if (data.binding == null && data.chapters.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    EmptyState("No source has this yet", "Add a repository under Sources, or search installed sources for another match.")
                    QuietLink("Open sources", onClick = openSources)
                }
            }
            if (data.binding != null && data.chapters.isEmpty() && data.chaptersResult is ApiResult.Success) item {
                EmptyState("This match has nothing behind it", "The bound source listed the title but no chapters. Change the match or try another source.")
            }
            if (data.chapters.isNotEmpty()) {
                /* Own scrollport under the hero so jumping to the active
                   chapter does not scroll the banner away. No bottom spacer —
                   that let rows scroll off-screen. */
                item {
                    Column(Modifier.fillParentMaxHeight()) {
                        Text(
                            if (shown.kind == MediaKind.ANIME) "Episodes" else "Chapters",
                            Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        LazyColumn(Modifier.weight(1f), state = chapterList) {
                            items(data.chapters.size) { i ->
                                val chapter = data.chapters[i]
                                val read = data.library?.status == "completed" || isChapterRead(i, current, unit)
                                val here = chapter.id == readingId && !read
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .alpha(if (read) 0.42f else 1f)
                                        .padding(horizontal = 12.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Row(
                                        Modifier
                                            .weight(1f)
                                            .clip(RoundedCornerShape(6.dp))
                                            .combinedClickable(
                                                onClick = { play(shown, chapter.id) },
                                                onLongClick = { markFor = chapter; markOpen = true },
                                            )
                                            .padding(horizontal = 8.dp, vertical = 8.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(Modifier.weight(1f)) {
                                            Text(chapter.name, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                chapter.number?.let {
                                                    Text(
                                                        "${if (shown.kind == MediaKind.ANIME) "EP" else "CH"} $it",
                                                        style = MaterialTheme.typography.labelSmall,
                                                    )
                                                }
                                                if (here) {
                                                    Text(
                                                        if (shown.kind == MediaKind.ANIME) "watching" else "reading",
                                                        style = MaterialTheme.typography.labelSmall,
                                                        color = Highlight,
                                                    )
                                                }
                                            }
                                        }
                                        Text("›", color = Text3)
                                    }
                                }
                                HorizontalDivider(color = Surface2)
                            }
                        }
                    }
                }
            }
            }
            OverlaySheet(visible = libraryOpen, onDismiss = { libraryOpen = false }) {
                LibrarySheet(data, { libraryOpen = false }, saveLibrary, removeHistory)
            }
            OverlaySheet(visible = matchOpen, onDismiss = { matchOpen = false }) {
                QuietLabel("Choose source match", Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                OutlinedTextField(sourceQuery, { sourceQuery = it }, Modifier.fillMaxWidth().padding(horizontal = 6.dp), placeholder = { Text("Search sources") }, singleLine = true)
                QuietLink("Search sources") { research(sourceQuery) }
                data.failures.forEach { Text(it, Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = Danger, style = MaterialTheme.typography.bodySmall) }
                data.candidates.forEach { candidate ->
                    SelectRow(
                        title = candidate.title,
                        selected = data.binding?.sourceMangaId == candidate.id,
                        meta = "${(candidate.confidence * 100).toInt()}%",
                    ) {
                        bind(candidate)
                        matchOpen = false
                    }
                    Text(
                        "${candidate.sourceName}${candidate.chapterCount?.takeIf { it > 0 }?.let { " · $it chapters" } ?: ""}",
                        Modifier.padding(start = 12.dp, end = 12.dp, bottom = 6.dp),
                        color = Text3,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (data.candidates.isEmpty()) OverlayNote("No alternatives found yet.")
            }
            val chapter = markFor
            OverlaySheet(visible = markOpen, onDismiss = { markOpen = false }) {
                if (chapter != null) {
                val i = data.chapters.indexOfFirst { it.id == chapter.id }
                val marked = i >= 0 && i + 1 <= unit
                    QuietLabel(chapter.name, Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                    if (marked) {
                        SelectRow("Mark as un$watchedWord", false) {
                            markProgress(chapter, i, false, true)
                            markOpen = false
                        }
                    } else {
                        SelectRow("Mark as $watchedWord", false) {
                            markProgress(chapter, i + 1, true, false)
                            markOpen = false
                        }
                    }
                    SelectRow("Mark as $watchedWord up to here", false) {
                        markProgress(chapter, i + 1, false, true)
                        markOpen = false
                    }
                }
            }
            error?.let { ActionErrorDialog(it, dismissError) }
        }
    }
}

/** A reopened older chapter stays read; only the farthest active unit stays bright. */
internal fun isChapterRead(index: Int, currentIndex: Int, unit: Int): Boolean {
    if (index == currentIndex && index + 1 >= unit) return false
    return index + 1 <= unit
}

internal fun lastReadChapterIndex(size: Int, currentIndex: Int, unit: Int, completed: Boolean = false): Int? =
    (size - 1 downTo 0).firstOrNull { completed || isChapterRead(it, currentIndex, unit) }

private fun libraryLabel(status: String) = when (status) {
    "reading" -> "In progress"
    "planned" -> "Planned"
    "completed" -> "Completed"
    "hold" -> "On hold"
    "dropped" -> "Dropped"
    else -> status.replaceFirstChar(Char::uppercase)
}

@Composable
private fun LibrarySheet(
    data: TitleData,
    close: () -> Unit,
    save: (Media, String, Int?, Boolean) -> Unit,
    removeHistory: (Media) -> Unit,
) {
    var status by remember { mutableStateOf(data.library?.status ?: "reading") }
    var rating by remember { mutableFloatStateOf((data.library?.rating ?: 0).toFloat()) }
    var pinned by remember { mutableStateOf(data.library?.pinned ?: false) }
    var confirmHistoryRemoval by remember { mutableStateOf(false) }
    fun persist(nextStatus: String = status, nextPinned: Boolean = pinned, dismiss: Boolean = true) {
        save(data.selectedMedia, nextStatus, rating.toInt().takeIf { it > 0 }, nextPinned)
        if (dismiss) close()
    }
    QuietLabel("Your library", Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
    listOf("reading", "planned", "completed", "hold", "dropped").forEach { value ->
        SelectRow(libraryLabel(value), status == value) {
            status = value
            persist(nextStatus = value)
        }
    }
    SelectRow(if (pinned) "Unpin from shelf" else "Pin to shelf", pinned) {
        val next = !pinned
        pinned = next
        persist(nextPinned = next)
    }
    QuietLabel(if (rating == 0f) "Not rated" else "Rating ${rating.toInt()}/10", Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
    Slider(
        rating,
        { rating = it },
        valueRange = 0f..10f,
        steps = 9,
        colors = SliderDefaults.colors(thumbColor = Highlight, activeTrackColor = Highlight, inactiveTrackColor = Text3.copy(alpha = 0.35f)),
    )
    QuietLink("Save rating") { persist(dismiss = true) }
    if (data.library != null) QuietLink("Remove from history", danger = true) { confirmHistoryRemoval = true }
    if (confirmHistoryRemoval) AlertDialog(
        onDismissRequest = { confirmHistoryRemoval = false },
        title = { Text("Remove from history?") },
        text = { Text("This clears progress and removes in-progress tracking for this title.") },
        confirmButton = { Button({ removeHistory(data.selectedMedia); confirmHistoryRemoval = false; close() }) { Text("Remove") } },
        dismissButton = { TextButton({ confirmHistoryRemoval = false }) { Text("Cancel") } },
    )
}

@Composable
fun SettingsScreen(state: LoadState<Settings>, retry: () -> Unit, save: (Settings) -> Unit, disconnect: () -> Unit) {
    Loadable(state, retry) { stored ->
        var value by remember(stored) { mutableStateOf(stored) }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            item { Text("Settings", style = MaterialTheme.typography.displayLarge) }
            item { Choice("Audio", listOf("ja", "en", "it", "de", "fr", "es", "pt", "hi", "ko", "zh", "ru"), value.audioLang) { value = value.copy(audioLang = it) } }
            item { Choice("Subtitles", listOf("auto", "off"), value.subtitleLang) { value = value.copy(subtitleLang = it) } }
            item {
                Text("Caption size · ${"%.1f".format(value.captionScale)}×", style = MaterialTheme.typography.titleMedium)
                Slider(value.captionScale, { value = value.copy(captionScale = it) }, valueRange = .75f..1.5f)
            }
            item { Choice("Reader mode", listOf("paged", "webtoon"), value.readerMode) { value = value.copy(readerMode = it) } }
            item { Choice("Page fit", listOf("height", "width", "contain"), value.readerFit) { value = value.copy(readerFit = it) } }
            item { Choice("Spread", listOf("single", "double"), value.readerSpread) { value = value.copy(readerSpread = it) } }
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text("Right-to-left", style = MaterialTheme.typography.titleMedium); Text("Page-turn direction", style = MaterialTheme.typography.bodySmall) }
                    Switch(value.readerRtl, { value = value.copy(readerRtl = it) })
                }
            }
            item { Button({ save(value) }, Modifier.fillMaxWidth()) { Text("Save settings") } }
            item { OutlinedButton(disconnect, Modifier.fillMaxWidth()) { Text("Disconnect this device", color = Danger) } }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Choice(label: String, options: List<String>, selected: String, choose: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.titleMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { QuietChip(it.replaceFirstChar(Char::uppercase), selected == it, filled = true) { choose(it) } }
        }
    }
}

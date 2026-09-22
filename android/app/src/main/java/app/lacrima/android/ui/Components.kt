package app.lacrima.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.activity.compose.BackHandler
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.times
import app.lacrima.android.LoadState
import app.lacrima.android.R
import app.lacrima.android.model.ApiResult
import app.lacrima.android.model.Media
import app.lacrima.android.model.MediaKind
import app.lacrima.android.model.Profile
import app.lacrima.android.model.Rail
import app.lacrima.android.model.SourceHealth
import app.lacrima.android.navigation.Destination
import app.lacrima.android.ui.theme.Canvas
import app.lacrima.android.ui.theme.Danger
import app.lacrima.android.ui.theme.Hairline
import app.lacrima.android.ui.theme.Highlight
import app.lacrima.android.ui.theme.Okay
import app.lacrima.android.ui.theme.Rust
import app.lacrima.android.ui.theme.Surface2
import app.lacrima.android.ui.theme.Surface3
import app.lacrima.android.ui.theme.Text
import app.lacrima.android.ui.theme.Text2
import app.lacrima.android.ui.theme.Text3
import app.lacrima.android.ui.theme.accent
import coil3.compose.AsyncImage

private val DrawerEase = CubicBezierEasing(0.2f, 0f, 0f, 1f)
private const val DrawerMs = 220

private val mainTabs = listOf(
    Triple("Home", Glyph.home, Destination.Home),
    Triple("Anime", Glyph.anime, Destination.Browse(MediaKind.ANIME)),
    Triple("Manga", Glyph.manga, Destination.Browse(MediaKind.MANGA)),
    Triple("Novels", Glyph.novels, Destination.Browse(MediaKind.NOVEL)),
    Triple("Yours", Glyph.yours, Destination.Yours),
)

@Composable
fun LacrimaScaffold(
    destination: Destination,
    profile: Profile,
    health: SourceHealth?,
    navigate: (Destination) -> Unit,
    back: () -> Unit,
    content: @Composable (PaddingValues) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val horizontal = maxWidth > maxHeight
        val permanentRail = maxWidth >= 840.dp && maxHeight >= 600.dp && !horizontal
        var drawerOpen by remember { mutableStateOf(false) }
        Box(Modifier.fillMaxSize().background(Canvas)) {
            Row(Modifier.fillMaxSize()) {
                if (permanentRail) {
                    SideBar(destination, navigate, expanded = true, onClose = null)
                }
                Scaffold(
                    modifier = Modifier.weight(1f),
                    containerColor = Canvas,
                    contentWindowInsets = WindowInsets(0, 0, 0, 0),
                    topBar = {
                        TopBar(
                            profile = profile,
                            health = health,
                            navigate = navigate,
                            compact = horizontal,
                            onMenu = if (horizontal && destination == Destination.Home) {{ drawerOpen = true }} else null,
                            onBack = if (horizontal && destination != Destination.Home) back else null,
                        )
                    },
                    bottomBar = { if (!permanentRail && !horizontal) BottomBar(destination, navigate) },
                    content = content,
                )
            }
            if (horizontal) {
                BackHandler(enabled = drawerOpen) { drawerOpen = false }
                AnimatedVisibility(
                    visible = drawerOpen,
                    enter = fadeIn(tween(160, easing = DrawerEase)),
                    exit = fadeOut(tween(140, easing = DrawerEase)),
                ) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .background(Color.Black.copy(alpha = 0.45f))
                            .clickable(role = Role.Button) { drawerOpen = false },
                    )
                }
                AnimatedVisibility(
                    visible = drawerOpen,
                    modifier = Modifier.align(Alignment.CenterStart).fillMaxHeight(),
                    enter = slideInHorizontally(tween(DrawerMs, easing = DrawerEase)) { -it } +
                        fadeIn(tween(180, easing = DrawerEase)),
                    exit = slideOutHorizontally(tween(180, easing = DrawerEase)) { -it } +
                        fadeOut(tween(130, easing = DrawerEase)),
                ) {
                    SideBar(
                        destination = destination,
                        navigate = {
                            drawerOpen = false
                            navigate(it)
                        },
                        expanded = true,
                        onClose = { drawerOpen = false },
                    )
                }
            }
        }
    }
}

@Composable
private fun TopBar(
    profile: Profile,
    health: SourceHealth?,
    navigate: (Destination) -> Unit,
    compact: Boolean = false,
    onMenu: (() -> Unit)? = null,
    onBack: (() -> Unit)? = null,
) {
    val barHeight = if (compact) 48.dp else 56.dp
    Surface(color = Canvas.copy(alpha = .96f)) {
        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(barHeight)
                .padding(horizontal = if (compact) 12.dp else 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(if (compact) 10.dp else 14.dp),
        ) {
            if (onMenu != null) {
                IconHit(onClick = onMenu, label = "Menu") {
                    LacrimaIcon(Glyph.menu, tint = Text2, size = 18.dp)
                }
            }
            if (onBack != null) {
                IconHit(onClick = onBack, label = "Back") {
                    LacrimaIcon(Glyph.arrow, tint = Text2, size = 18.dp)
                }
            }
            Image(
                painterResource(R.drawable.lacrima_logo),
                contentDescription = "Lacrima",
                Modifier.size(if (compact) 32.dp else 40.dp),
            )
            Spacer(Modifier.weight(1f))
            IconHit(onClick = { navigate(Destination.Search()) }, label = "Search") {
                LacrimaIcon(Glyph.search, tint = Text2, size = 18.dp)
            }
            IconHit(onClick = { navigate(Destination.Settings) }, label = "Settings") {
                LacrimaIcon(Glyph.settings, Glyph.settingsHole, tint = Text2, size = 18.dp)
            }
            Row(
                Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button) { navigate(Destination.Sources) }.padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(healthColor(health)))
                Text(health?.label ?: "Sources", style = MaterialTheme.typography.labelSmall, color = Text3)
            }
            Box(
                Modifier.size(30.dp).clip(CircleShape).background(accent(profile.avatarColor))
                    .clickable(role = Role.Button) { navigate(Destination.Profiles) },
                contentAlignment = Alignment.Center,
            ) { Text(profile.name.take(1).uppercase(), fontSize = 12.sp) }
        }
        HorizontalDivider(color = Surface2)
    }
}

@Composable
private fun BottomBar(destination: Destination, navigate: (Destination) -> Unit) {
    Column(Modifier.background(Brush.verticalGradient(listOf(Canvas.copy(alpha = 0.2f), Canvas.copy(alpha = 0.94f), Color(0x8C630E19))))) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(top = 6.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            mainTabs.forEach { (label, glyph, target) ->
                NavLink(label, glyph, destination.sameTab(target), stacked = true) { navigate(target) }
            }
        }
    }
}

@Composable
private fun SideBar(
    destination: Destination,
    navigate: (Destination) -> Unit,
    expanded: Boolean,
    onClose: (() -> Unit)?,
) {
    val scroll = rememberScrollState()
    Column(
        Modifier
            .width(if (expanded) 360.dp else 56.dp)
            .fillMaxHeight()
            .background(Brush.verticalGradient(0f to Color(0xFF050403), 0.9f to Color(0xFF050403), 1f to Rust))
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(scroll)
            .padding(horizontal = if (expanded) 14.dp else 8.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (onClose != null && expanded) {
            IconHit(onClick = onClose, label = "Close menu") {
                LacrimaIcon(Glyph.arrow, tint = Text2, size = 18.dp)
            }
        }
        Image(
            painterResource(R.drawable.lacrima_logo),
            contentDescription = "Lacrima",
            Modifier
                .size(if (expanded) 72.dp else 36.dp)
                .align(Alignment.CenterHorizontally),
        )
        if (expanded) {
            Spacer(Modifier.height(8.dp))
            Text("Menu", Modifier.padding(horizontal = 10.dp), style = MaterialTheme.typography.titleMedium)
            Box(Modifier.padding(start = 10.dp).width(36.dp).height(2.dp).background(Highlight.copy(alpha = 0.28f)))
            Spacer(Modifier.height(4.dp))
        }
        mainTabs.forEach { (label, glyph, target) ->
            NavLink(label, glyph, destination.sameTab(target), stacked = !expanded) { navigate(target) }
        }
        if (expanded) {
            Box(Modifier.padding(horizontal = 10.dp, vertical = 10.dp).fillMaxWidth().height(1.dp).background(Hairline))
        } else {
            Spacer(Modifier.height(8.dp))
        }
        NavLink("Sources", Glyph.sources, destination == Destination.Sources, stacked = !expanded) {
            navigate(Destination.Sources)
        }
        NavLink("Settings", Glyph.settings, destination == Destination.Settings, stacked = !expanded) {
            navigate(Destination.Settings)
        }
    }
}

private fun Destination.sameTab(other: Destination): Boolean = when (other) {
    Destination.Home -> this == Destination.Home
    is Destination.Browse -> this is Destination.Browse && kind == other.kind
    Destination.Yours -> this == Destination.Yours
    else -> false
}

private fun healthColor(health: SourceHealth?) = when (health?.state) {
    "ok", "healthy" -> Okay
    "down", "error" -> Danger
    else -> Highlight
}

@Composable
fun PosterCard(media: Media, onClick: () -> Unit, modifier: Modifier = Modifier.width(148.dp)) {
    val titleStyle = MaterialTheme.typography.titleSmall
    val metaStyle = MaterialTheme.typography.bodySmall
    val titleBlock = with(LocalDensity.current) { (titleStyle.lineHeight * 2).toDp() }
    val metaBlock = with(LocalDensity.current) { metaStyle.lineHeight.toDp() }
    Column(
        modifier.clickable(role = Role.Button, onClick = onClick),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(10.dp))
                .background(accent(media.color).copy(alpha = .55f)),
        ) {
            media.cover?.let {
                AsyncImage(
                    model = it,
                    contentDescription = "Cover for ${media.title}",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            }
            media.pip?.let { pip ->
                Text(
                    pip,
                    Modifier.align(Alignment.TopEnd).padding(8.dp).background(Highlight, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFF1A1208),
                )
            }
            media.progress?.let { progress ->
                LinearProgressIndicator(
                    progress = { progress.coerceIn(0f, 1f) },
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp),
                    color = Rust,
                    trackColor = Surface3,
                )
            }
        }
        Text(
            media.title,
            Modifier.fillMaxWidth().height(titleBlock),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            style = titleStyle,
        )
        media.detail?.let {
            Text(it, Modifier.fillMaxWidth().height(metaBlock), maxLines = 1, overflow = TextOverflow.Ellipsis, style = metaStyle, color = Text3)
        }
    }
}

@Composable
fun MediaRail(rail: Rail, open: (Media) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(rail.title, Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.titleMedium)
        LazyRow(
            contentPadding = PaddingValues(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.Top,
        ) {
            items(rail.items, key = { "${it.via}-${it.kind}-${it.id}" }) { PosterCard(it, { open(it) }) }
        }
    }
}

@Composable
fun PosterGrid(
    items: List<Media>,
    open: (Media) -> Unit,
    modifier: Modifier = Modifier,
    overlay: @Composable BoxScope.(Media) -> Unit = {},
) {
    BoxWithConstraints(modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
        val gap = 14.dp
        val columns = posterColumns(maxWidth.value)
        val cardWidth = (maxWidth - gap * (columns - 1)) / columns
        Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
            items.chunked(columns).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                    row.forEach { media ->
                        Box(Modifier.width(cardWidth)) {
                            PosterCard(media, { open(media) }, Modifier.fillMaxWidth())
                            overlay(media)
                        }
                    }
                    repeat(columns - row.size) { Spacer(Modifier.width(cardWidth)) }
                }
            }
        }
    }
}

@Composable
fun <T> Loadable(
    state: LoadState<T>,
    retry: () -> Unit,
    content: @Composable (T) -> Unit,
) {
    when (state) {
        LoadState.Idle, LoadState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Highlight)
        }
        is LoadState.Failed -> FailureCard(state.error, retry)
        is LoadState.Ready -> content(state.value)
    }
}

@Composable
fun FailureCard(error: ApiResult.Failure, retry: () -> Unit, changeServer: (() -> Unit)? = null) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(error.message, color = Text2)
        Spacer(Modifier.height(12.dp))
        GhostButton("Try again", onClick = retry)
        changeServer?.let {
            Spacer(Modifier.height(8.dp))
            GhostButton("Change server URL", onClick = it)
        }
    }
}

@Composable
fun EmptyState(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(body, color = Text2, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun DegradedNote(detail: String) {
    Text("Serving $detail", Modifier.padding(horizontal = 20.dp), color = Highlight, style = MaterialTheme.typography.bodySmall)
}

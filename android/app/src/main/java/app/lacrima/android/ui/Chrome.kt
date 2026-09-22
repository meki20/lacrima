package app.lacrima.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.remember
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lacrima.android.ui.theme.AccentDim
import app.lacrima.android.ui.theme.Canvas
import app.lacrima.android.ui.theme.Glass
import app.lacrima.android.ui.theme.Hairline
import app.lacrima.android.ui.theme.Highlight
import app.lacrima.android.ui.theme.Text
import app.lacrima.android.ui.theme.Text2
import app.lacrima.android.ui.theme.Text3

internal val OverlayEase = CubicBezierEasing(0.2f, 0f, 0f, 1f)
private const val OverlayMs = 180
private val OverlayShape = RoundedCornerShape(10.dp)
private val RowShape = RoundedCornerShape(6.dp)

@Composable
private fun Modifier.passClick(enabled: Boolean = true, onClick: () -> Unit): Modifier = clickable(
    enabled = enabled,
    indication = null,
    interactionSource = remember { MutableInteractionSource() },
    onClick = onClick,
)

@Composable
fun FadeSlideBar(
    visible: Boolean,
    fromTop: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val offset = if (fromTop) -10 else 10
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn(tween(160, easing = OverlayEase)) +
            slideInVertically(tween(OverlayMs, easing = OverlayEase)) { offset },
        exit = fadeOut(tween(130, easing = OverlayEase)) +
            slideOutVertically(tween(140, easing = OverlayEase)) { offset },
    ) { content() }
}

@Composable
fun OverlayMenu(
    visible: Boolean,
    modifier: Modifier = Modifier,
    height: Dp? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn(tween(150, easing = OverlayEase)) + scaleIn(
            animationSpec = tween(OverlayMs, easing = OverlayEase),
            initialScale = 0.96f,
            transformOrigin = TransformOrigin(1f, 1f),
        ),
        exit = fadeOut(tween(110, easing = OverlayEase)) + scaleOut(
            animationSpec = tween(120, easing = OverlayEase),
            targetScale = 0.96f,
            transformOrigin = TransformOrigin(1f, 1f),
        ),
    ) {
        val card = if (height != null) Modifier.width(280.dp).height(height) else Modifier.width(280.dp).heightIn(max = 360.dp)
        GlassCard(card) {
            Column(
                Modifier.fillMaxWidth().then(if (height != null) Modifier.fillMaxSize() else Modifier).padding(6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
                content = content,
            )
        }
    }
}

@Composable
fun BoxScope.OverlayDrawer(
    visible: Boolean,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(160, easing = OverlayEase)),
        exit = fadeOut(tween(140, easing = OverlayEase)),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.42f)).passClick(onClick = onDismiss))
    }
    AnimatedVisibility(
        visible = visible,
        modifier = Modifier.align(Alignment.CenterEnd),
        enter = slideInHorizontally(tween(220, easing = OverlayEase)) { it } + fadeIn(tween(180)),
        exit = slideOutHorizontally(tween(180, easing = OverlayEase)) { it } + fadeOut(tween(130)),
    ) {
        CompositionLocalProvider(LocalContentColor provides Text) {
            Row(Modifier.fillMaxHeight().width(280.dp).background(Canvas.copy(alpha = 0.96f))) {
                Box(Modifier.width(1.dp).fillMaxHeight().background(Hairline))
                Column(
                    Modifier.weight(1f).padding(start = 16.dp, end = 16.dp, top = 56.dp, bottom = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                    content = content,
                )
            }
        }
    }
}

@Composable
fun GlassCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .shadow(16.dp, OverlayShape, ambientColor = Color.Black.copy(alpha = 0.55f), spotColor = Color.Black)
            .clip(OverlayShape)
            .background(Glass)
            .border(1.dp, Hairline, OverlayShape),
    ) {
        CompositionLocalProvider(LocalContentColor provides Text, content = content)
    }
}

@Composable
fun SegmentTabs(options: List<Pair<String, Boolean>>, onPick: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        options.forEachIndexed { index, (label, on) ->
            Box(
                Modifier
                    .weight(1f)
                    .height(32.dp)
                    .clip(RowShape)
                    .background(if (on) Color.White.copy(alpha = 0.1f) else Color.Transparent)
                    .clickable(role = Role.Tab) { onPick(index) },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, color = if (on) Text else Text2, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
fun SelectRow(
    title: String,
    selected: Boolean,
    meta: String? = null,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RowShape)
            .background(if (selected) AccentDim else Color.Transparent)
            .clickable(onClick = onClick)
            .heightIn(min = 40.dp)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (meta != null) {
            Text(meta, color = if (selected) Highlight else Text3, fontSize = 11.sp, fontWeight = FontWeight.Medium)
        }
        Text(
            title,
            Modifier.weight(1f),
            color = if (selected) Highlight else Text,
            fontSize = 15.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
fun OverlayNote(text: String) {
    Text(
        text,
        Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        color = Text3,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    )
}

@Composable
fun QuietLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        color = Text3,
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.4.sp,
    )
}

@Composable
fun OverlaySheet(
    visible: Boolean,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(160, easing = OverlayEase)),
        exit = fadeOut(tween(140, easing = OverlayEase)),
    ) {
        Box(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.48f)).passClick(onClick = onDismiss))
            GlassCard(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(12.dp)
                    .heightIn(max = 520.dp)
                    .passClick { },
            ) {
                Column(
                    Modifier.padding(6.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    content = content,
                )
            }
        }
    }
}

@Composable
fun QuietChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    onClick: () -> Unit,
) {
    Text(
        label,
        modifier
            .clip(RowShape)
            .background(if (selected && filled) AccentDim else Color.Transparent)
            .clickable(role = Role.Tab, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = when {
            selected && filled -> Highlight
            selected -> Text
            else -> Text3
        },
        fontSize = 13.sp,
        fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
fun QuietLink(label: String, enabled: Boolean = true, danger: Boolean = false, onClick: () -> Unit) {
    Text(
        label,
        Modifier
            .clip(RowShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        color = when {
            !enabled -> Text3
            danger -> app.lacrima.android.ui.theme.Danger
            else -> Highlight
        },
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium,
    )
}

@Composable
fun GhostButton(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .height(40.dp)
            .clip(RowShape)
            .background(app.lacrima.android.ui.theme.Surface2)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Text, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

@Composable
fun NavLink(
    label: String,
    glyph: String,
    selected: Boolean,
    stacked: Boolean = false,
    onClick: () -> Unit,
) {
    val tint = if (selected) Highlight else Text3
    val color = if (selected) Text else Text3
    if (stacked) {
        Column(
            Modifier
                .clip(RowShape)
                .clickable(role = Role.Tab, onClick = onClick)
                .padding(vertical = 8.dp, horizontal = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            LacrimaIcon(glyph, size = 18.dp, tint = tint)
            Text(label, color = color, fontSize = 11.sp, fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal, maxLines = 1)
        }
    } else {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RowShape)
                .clickable(role = Role.Tab, onClick = onClick)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            LacrimaIcon(glyph, size = 18.dp, tint = if (selected) Text else Text3)
            Text(label, color = if (selected) Text else Text2, fontSize = 13.sp, fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal)
        }
    }
}

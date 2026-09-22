package app.lacrima.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.graphics.PathParser

/** Same path language as the web `Icon` / `PATH` constants. */
object Glyph {
    const val home = "M4 10.5 12 3l8 7.5V20h-6v-6H10v6H4z"
    const val anime = "M8 5.5v13l11-6.5z"
    const val manga = "M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3V4z"
    const val novels = "M12 5c-2-1.2-5-1.5-8-.8v14c3-.7 6-.4 8 .8 2-1.2 5-1.5 8-.8v-14c-3-.7-6-.4-8 .8z"
    const val yours = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5.5 20a6.5 6.5 0 0 1 13 0"
    const val sources = "M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4"
    const val settings = "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
    const val settingsHole = "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
    const val search = "M10.5 6a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM16.2 16.2 21 21"
    const val play = "M8 5.5v13l11-6.5z"
    const val pause = "M7 5.5h3.2v13H7zm6.8 0H17v13h-3.2z"
    const val back10 = "M12 6V3L7 7l5 4V8a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"
    const val fwd10 = "M12 6V3l5 4-5 4V8a5 5 0 1 0 5 5h2a7 7 0 1 1-7-7z"
    const val next = "M6 5.5v13l9-6.5zM16.5 5.5H19v13h-2.5z"
    const val list = "M4 7h16M4 12h16M4 17h16"
    const val full = "M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5"
    const val arrow = "M14 6l-6 6 6 6"
    const val pip = "M3 6h12v9H3zM11 12h10v7H11z"
    const val menu = "M5 7h14M5 12h14M5 17h10"
    const val prevCh = "M18 5.5v13l-9-6.5zM7.5 5.5H5v13h2.5z"
    const val nextCh = "M6 5.5v13l9-6.5zM16.5 5.5H19v13h-2.5z"
    const val ltr = "M4 7h9v10H4zM16 12h4m0 0-2-2m2 2-2 2"
    const val rtl = "M11 7h9v10h-9zM8 12H4m0 0 2-2m-2 2 2 2"
    const val paged = "M7 4h10v16H7z"
    const val webtoon = "M8 3h8v5H8zM8 9.5h8v5H8zM8 16h8v5H8z"
    const val fitH = "M8 7h8v10H8zM12 3v3M12 18v3M10 5l2-2 2 2M10 19l2 2 2-2"
    const val fitW = "M7 8h10v8H7zM3 12h3M18 12h3M5 10l-2 2 2 2M19 10l2 2-2 2"
    const val fitBox = "M7 7h10v10H7zM4 4h3M4 4v3M20 4h-3M20 4v3M4 20h3M4 20v-3M20 20h-3M20 20v-3"
    const val single = "M8 4h8v16H8z"
    const val double = "M3 5h8v14H3zM13 5h8v14h-8"
}

@Composable
fun LacrimaIcon(
    vararg d: String,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    tint: Color = Color.Unspecified,
    size: Dp = 22.dp,
) {
    val color = if (tint == Color.Unspecified) androidx.compose.material3.LocalContentColor.current else tint
    Box(
        modifier
            .size(size)
            .drawBehind {
                val factor = this.size.minDimension / 24f
                scale(factor, pivot = androidx.compose.ui.geometry.Offset.Zero) {
                    for (path in d) {
                        val compose = parseSvg(path) ?: continue
                        if (filled) drawPath(compose, color)
                        else drawPath(
                            compose,
                            color,
                            style = Stroke(width = 1.8f, cap = StrokeCap.Round, join = StrokeJoin.Round),
                        )
                    }
                }
            },
    )
}

@Composable
fun IconHit(
    onClick: () -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    Box(
        modifier
            .size(44.dp)
            .alpha(if (enabled) 1f else 0.28f)
            .semantics { contentDescription = label }
            .clickable(
                enabled = enabled,
                role = Role.Button,
                interactionSource = remember { MutableInteractionSource() },
                indication = ripple(bounded = false, radius = 22.dp, color = Color.White.copy(alpha = 0.28f)),
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) { content() }
}

internal fun posterColumns(maxWidthDp: Float): Int =
    if (maxWidthDp < 600f) 3 else maxOf(3, (maxWidthDp / 160f).toInt())

private fun parseSvg(d: String): Path? = runCatching {
    PathParser.createPathFromPathData(d).asComposePath()
}.getOrNull()

package app.lacrima.android.ui.theme

import android.graphics.Color.parseColor
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val Canvas = Color(0xFF0C0908)
val Surface1 = Color(0xFF15110F)
val Surface2 = Color(0xFF1D1714)
val Surface3 = Color(0xFF271E19)
val Text = Color(0xFFF2ECE6)
val Text2 = Color(0xFFB5A89C)
val Text3 = Color(0xFF7A6E64)
val Highlight = Color(0xFFE8C56B)
val Danger = Color(0xFFE5484D)
val Okay = Color(0xFF46A758)
val Rust = Color(0xFF630E19)
val Glass = Color(0xF0121212)
val Hairline = Color(0x14FFFFFF)
val AccentDim = Color(0x29E8C56B)

fun accent(value: String?): Color = runCatching { Color(parseColor(value ?: "#630E19")) }.getOrDefault(Rust)

@Composable
fun LacrimaTheme(accent: Color = Rust, content: @Composable () -> Unit) {
    val colors = darkColorScheme(
        primary = Highlight,
        onPrimary = Color(0xFF1A1208),
        secondary = accent,
        onSecondary = Text,
        background = Canvas,
        onBackground = Text,
        surface = Surface1,
        surfaceVariant = Surface2,
        onSurface = Text,
        onSurfaceVariant = Text2,
        error = Danger,
    )
    MaterialTheme(
        colorScheme = colors,
        typography = Typography(
            displayLarge = TextStyle(fontSize = 40.sp, lineHeight = 43.sp, fontWeight = FontWeight.Medium, letterSpacing = (-1.4).sp, color = Text),
            headlineSmall = TextStyle(fontSize = 22.sp, lineHeight = 27.sp, fontWeight = FontWeight.Medium, letterSpacing = (-0.4).sp, color = Text),
            titleMedium = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium, letterSpacing = (-0.2).sp, color = Text),
            titleSmall = TextStyle(fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium, color = Text),
            bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Normal, color = Text),
            bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.Normal, color = Text),
            bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 17.sp, color = Text2),
            labelMedium = TextStyle(fontSize = 13.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium, color = Text),
            labelSmall = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 10.sp, letterSpacing = 0.5.sp, color = Text3),
        ),
        shapes = Shapes(
            extraSmall = RoundedCornerShape(4.dp),
            small = RoundedCornerShape(6.dp),
            medium = RoundedCornerShape(10.dp),
            large = RoundedCornerShape(12.dp),
        ),
    ) {
        CompositionLocalProvider(LocalContentColor provides Text) { content() }
    }
}

package app.lacrima.android.feature.reader

import android.content.Context
import app.lacrima.android.model.Settings

internal class ReaderPrefsStore(context: Context) {
    private val prefs = context.getSharedPreferences("lacrima-reader", Context.MODE_PRIVATE)

    fun read(key: String, defaults: Settings): ReaderPrefs {
        val prefix = "$key."
        return ReaderPrefs(
            mode = prefs.getString(prefix + "mode", defaults.readerMode).validMode(),
            rtl = prefs.getBoolean(prefix + "rtl", defaults.readerRtl),
            fit = prefs.getString(prefix + "fit", defaults.readerFit).validFit(),
            spread = prefs.getString(prefix + "spread", defaults.readerSpread).validSpread(),
        )
    }

    fun write(key: String, value: ReaderPrefs) {
        prefs.edit()
            .putString("$key.mode", value.mode.validMode())
            .putBoolean("$key.rtl", value.rtl)
            .putString("$key.fit", value.fit.validFit())
            .putString("$key.spread", value.spread.validSpread())
            .apply()
    }
}

private fun String?.validMode() = if (this == "webtoon") "webtoon" else "paged"
private fun String?.validFit() = when (this) { "width", "contain" -> this; else -> "height" }
private fun String?.validSpread() = if (this == "double") "double" else "single"

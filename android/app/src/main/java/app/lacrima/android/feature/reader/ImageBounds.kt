package app.lacrima.android.feature.reader

import android.graphics.BitmapFactory
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

private val imageHeightCache = ConcurrentHashMap<String, Int>()

internal fun cachedImageHeights(urls: List<String>): List<Int>? =
    urls.map { imageHeightCache[it] ?: return null }

/** Decode bounds only — used to spot stub fragments split off a print page. */
internal fun probeImageHeight(url: String): Int = imageHeightCache[url] ?: runCatching {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 8_000
    connection.readTimeout = 20_000
    connection.instanceFollowRedirects = true
    connection.setRequestProperty("Accept", "image/*,*/*")
    connection.inputStream.use { stream ->
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeStream(stream, null, opts)
        opts.outHeight.coerceAtLeast(0)
    }
}.getOrDefault(0).also { if (it > 0) imageHeightCache[url] = it }

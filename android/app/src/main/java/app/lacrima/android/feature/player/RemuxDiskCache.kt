package app.lacrima.android.feature.player

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File

@UnstableApi
internal object RemuxDiskCache {
    @Volatile private var instance: Cache? = null

    fun open(context: Context): Cache? {
        instance?.let { return it }
        synchronized(this) {
            instance?.let { return it }
            val app = context.applicationContext
            val dir = File(app.cacheDir, "remux")
            return try {
                dir.mkdirs()
                SimpleCache(
                    dir,
                    LeastRecentlyUsedCacheEvictor(REMUX_DISK_CACHE_BYTES),
                    StandaloneDatabaseProvider(app),
                ).also { instance = it }
            } catch (_: Exception) {
                try {
                    dir.deleteRecursively()
                    dir.mkdirs()
                    SimpleCache(
                        dir,
                        LeastRecentlyUsedCacheEvictor(REMUX_DISK_CACHE_BYTES),
                        StandaloneDatabaseProvider(app),
                    ).also { instance = it }
                } catch (_: Exception) {
                    null
                }
            }
        }
    }
}

internal class RemuxSeekClock {
    @Volatile var durationUs: Long = remuxDurationUs(null)
    @Volatile var cachedBytes: Long = 0
    @Volatile private var indexedTimeUs: Long = 0
    @Volatile private var indexedPosition: Long = 0

    @Synchronized
    fun reset(durationUs: Long) {
        this.durationUs = durationUs
        cachedBytes = 0
        indexedTimeUs = 0
        indexedPosition = 0
    }

    @Synchronized
    fun addKeyframe(timeUs: Long, position: Long) {
        if (timeUs < indexedTimeUs || position < indexedPosition) return
        indexedTimeUs = timeUs
        indexedPosition = position
    }

    fun byteForTime(timeUs: Long): Long =
        remuxByteForTime(timeUs, indexedTimeUs, indexedPosition, cachedBytes)

    fun cachedEndUs(): Long = remuxCachedEndUs(indexedTimeUs, indexedPosition, cachedBytes)
}

package app.lacrima.android.feature.player

import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.SeekPoint
import androidx.media3.extractor.TrackOutput

/**
 * A live remux has no Content-Length. Publish a duration plus a byte map so
 * ExoPlayer can seek inside the on-disk cache instead of resetting ffmpeg.
 */
@UnstableApi
internal class BufferedSeekExtractor(
    private val inner: Extractor,
    private val clock: RemuxSeekClock,
) : Extractor {
    override fun sniff(input: ExtractorInput) = inner.sniff(input)

    override fun init(output: ExtractorOutput) {
        inner.init(object : ExtractorOutput {
            override fun track(id: Int, type: Int): TrackOutput {
                val sink = output.track(id, type)
                if (type != C.TRACK_TYPE_VIDEO) return sink
                return object : TrackOutput {
                    private var samplePosition = 0L
                    override fun format(format: Format) = sink.format(format)
                    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean): Int {
                        if (input is ExtractorInput) samplePosition = input.position
                        return sink.sampleData(input, length, allowEndOfInput)
                    }
                    override fun sampleData(
                        input: DataReader,
                        length: Int,
                        allowEndOfInput: Boolean,
                        sampleDataPart: Int,
                    ): Int {
                        if (input is ExtractorInput) samplePosition = input.position
                        return sink.sampleData(input, length, allowEndOfInput, sampleDataPart)
                    }
                    override fun sampleData(data: ParsableByteArray, length: Int) {
                        sink.sampleData(data, length)
                    }
                    override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
                        sink.sampleData(data, length, sampleDataPart)
                    }
                    override fun sampleMetadata(
                        timeUs: Long,
                        flags: Int,
                        size: Int,
                        offset: Int,
                        cryptoData: TrackOutput.CryptoData?,
                    ) {
                        if (flags and C.BUFFER_FLAG_KEY_FRAME != 0) {
                            clock.addKeyframe(timeUs, (samplePosition - size).coerceAtLeast(0))
                        }
                        sink.sampleMetadata(timeUs, flags, size, offset, cryptoData)
                    }
                }
            }

            override fun endTracks() = output.endTracks()
            override fun seekMap(seekMap: SeekMap) {
                output.seekMap(
                    object : SeekMap {
                        override fun isSeekable() = true
                        override fun isEstimated() = true
                        override fun getDurationUs(): Long {
                            val duration = clock.durationUs.takeIf { it > 0 && it != C.TIME_UNSET }
                                ?: seekMap.durationUs.takeIf { it > 0 && it != C.TIME_UNSET }
                                ?: remuxDurationUs(null)
                            return duration
                        }
                        override fun getSeekPoints(timeUs: Long) =
                            SeekMap.SeekPoints(SeekPoint(timeUs.coerceAtLeast(0), clock.byteForTime(timeUs)))
                    },
                )
            }
        })
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder) = inner.read(input, seekPosition)
    override fun seek(position: Long, timeUs: Long) = inner.seek(position, timeUs)
    override fun release() = inner.release()
    override fun getUnderlyingImplementation(): Extractor = inner.underlyingImplementation
}

package tv.getportico.portico.native

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.DataReader
import androidx.media3.datasource.DataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.extractor.*

/** Binds exact server trims to each media item, including prepared and crossfade players. */
internal object PorticoPlanMediaSource {
  data class Trim(val start: Int, val end: Int)
  fun item(url: String, plan: Map<*, *>?, mediaId: String = ""): MediaItem {
    val trim = plan?.get("trim") as? Map<*, *>
    val start = (trim?.get("startFrames") as? Number)?.toLong() ?: 0
    val end = (trim?.get("endFrames") as? Number)?.toLong() ?: 0
    require(start in 0..PorticoGaplessPcm.MAX_TRIM && end in 0..PorticoGaplessPcm.MAX_TRIM)
    return MediaItem.Builder().setUri(url).setMediaId(mediaId).apply { if(plan != null) setTag(Trim(start.toInt(),end.toInt())) }.build()
  }
  class Factory(private val data: DataSource.Factory, private val extractors: ExtractorsFactory) : MediaSource.Factory {
    private val base = DefaultMediaSourceFactory(data,extractors)
    override fun getSupportedTypes() = base.supportedTypes
    override fun setDrmSessionManagerProvider(provider: androidx.media3.exoplayer.drm.DrmSessionManagerProvider): MediaSource.Factory { base.setDrmSessionManagerProvider(provider); return this }
    override fun setLoadErrorHandlingPolicy(policy: androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy): MediaSource.Factory { base.setLoadErrorHandlingPolicy(policy); return this }
    override fun createMediaSource(item: MediaItem): MediaSource {
      val trim = item.localConfiguration?.tag as? Trim ?: return base.createMediaSource(item)
      val wrapped = object : ExtractorsFactory {
        override fun createExtractors() = extractors.createExtractors().map { Planned(it,trim) }.toTypedArray<Extractor>()
        override fun createExtractors(uri: Uri, responseHeaders: Map<String,List<String>>) = extractors.createExtractors(uri,responseHeaders).map { Planned(it,trim) }.toTypedArray<Extractor>()
      }
      return DefaultMediaSourceFactory(data,wrapped).createMediaSource(item)
    }
  }
  private class Planned(private val inner: Extractor, private val trim: Trim) : Extractor {
    override fun sniff(input: ExtractorInput) = inner.sniff(input)
    override fun read(input: ExtractorInput, seekPosition: PositionHolder) = inner.read(input,seekPosition)
    override fun seek(position: Long, timeUs: Long) = inner.seek(position,timeUs)
    override fun release() = inner.release()
    override fun getUnderlyingImplementation() = inner.underlyingImplementation
    override fun init(output: ExtractorOutput) { inner.init(object : ExtractorOutput {
      override fun track(id: Int,type: Int): TrackOutput {
        val out = output.track(id,type)
        if(type != C.TRACK_TYPE_AUDIO) return out
        return object : TrackOutput {
          override fun format(format: Format) = out.format(format.buildUpon().setEncoderDelay(trim.start).setEncoderPadding(trim.end).build())
          override fun durationUs(durationUs: Long) = out.durationUs(durationUs)
          override fun sampleData(input: DataReader,length: Int,allowEndOfInput: Boolean,sampleDataPart: Int) = out.sampleData(input,length,allowEndOfInput,sampleDataPart)
          override fun sampleData(data: ParsableByteArray,length: Int,sampleDataPart: Int) = out.sampleData(data,length,sampleDataPart)
          override fun sampleMetadata(timeUs: Long,flags: Int,size: Int,offset: Int,cryptoData: TrackOutput.CryptoData?) = out.sampleMetadata(timeUs,flags,size,offset,cryptoData)
        }
      }
      override fun endTracks() = output.endTracks()
      override fun seekMap(map: SeekMap) = output.seekMap(map)
    }) }
  }
}

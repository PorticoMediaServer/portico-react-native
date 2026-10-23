package tv.getportico.portico.native

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.View
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

internal object PorticoSubtitleNative {
  val available = try { System.loadLibrary("porticosubtitles"); true } catch (_: LinkageError) { false }
  external fun create(kind: String, path: String, fonts: Array<String>): Long
  external fun render(handle: Long, timeUs: Long, bitmap: Bitmap, sourceWidth: Int, sourceHeight: Int): Boolean
  external fun style(handle: Long, keep: Boolean, family: String, color: Int, position: Int, scale: Double)
  external fun destroy(handle: Long)
}

/** Scoped fetching is on the app transport, decoding sees local files only. A grant expires dark. */
internal class PorticoSubtitleOverlay(private val context: Context) {
  private val main = Handler(Looper.getMainLooper())
  private val worker = Executors.newSingleThreadExecutor { task -> Thread(task,"portico-subtitle-overlay").apply { isDaemon=true } }
  private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).callTimeout(10,TimeUnit.SECONDS).build()
  private val folder = File(context.cacheDir,"subtitle-overlay-${UUID.randomUUID()}")
  private var key: Any? = null
  private var epoch = 0
  private var handle = 0L // worker only
  private var busy = false // main only
  private var back: Bitmap? = null // worker only
  private var front: Bitmap? = null // main only; only swapped between draws
  private var offsetUs = 0L
  private var captionStyle: Map<*, *>? = null
  private var authorizedUntil = 0L
  private var refresh: Runnable? = null
  @Volatile private var call: okhttp3.Call? = null
  var active = false; private set
  var onStatus: ((String) -> Unit)? = null
  val ready: Boolean get() = active && front != null && SystemClock.elapsedRealtime() < authorizedUntil

  fun apply(command: Map<String,Any?>?, source: String?) {
    captionStyle=command?.get("style") as? Map<*, *>
    val render = command?.get("render") as? Map<*, *>
    val kind = render?.get("kind") as? String
    val url = render?.get("url") as? String
    if(command?.get("mode") != "track" || kind !in KINDS || url == null || !PorticoSubtitleNative.available) { if(active) invalidate(); return }
    val media = runCatching { Uri.parse(source) }.getOrNull()
    val target = runCatching { Uri.parse(url) }.getOrNull()
    val files = (render["fonts"] as? List<*>) ?: emptyList<Any?>()
    val companion = render["companionUrl"] as? String
    val timingOffset = PorticoSubtitleTiming.offsetUs(render, command["offsetUs"] as? String)
    if(media == null || target == null || !allowed(target,media) || files.size > 64 || timingOffset == null) { invalidate(); onStatus?.invoke("subtitle_scope_invalid"); return }
    val fontUrls = files.mapNotNull { (it as? Map<*, *>)?.get("url") as? String }
    if(fontUrls.size != files.size || (fontUrls + listOfNotNull(companion)).any { !allowed(Uri.parse(it),media) }) { invalidate(); onStatus?.invoke("subtitle_attachment_scope_invalid"); return }
    if(kind == "vobsub" && companion == null && media.scheme != "file") { invalidate(); onStatus?.invoke("subtitle_companion_missing"); return }
    offsetUs = timingOffset
    val nextKey = listOf(command["binding"],command["resourceId"],command["resourceRevision"],render)
    if(key == nextKey) return
    invalidate(); key = nextKey; active = true; offsetUs = timingOffset
    val generation = epoch
    folder.mkdirs()
    val work = object : Runnable {
      override fun run() {
        worker.execute {
          var statusError: String? = null
          try {
            val dir = File(folder,"$generation").apply { mkdirs() }
            val extension = mapOf("ass" to "ass","pgs" to "sup","vobsub" to "idx","dvb" to "mks")[kind]!!
            val path = fetch(target,File(dir,"track.$extension"),(if(kind=="ass") 8L else 64L) shl 20)
            if(companion != null) fetch(Uri.parse(companion),File(dir,"track.sub"),64L shl 20)
            if(kind == "vobsub" && companion == null && target.scheme == "file") {
              val sub = Uri.fromFile(File(target.path!!.substringBeforeLast('.')+".sub"))
              if(!allowed(sub,media)) error("The downloaded VobSub companion is outside Downloads")
              fetch(sub,File(dir,"track.sub"),64L shl 20)
            }
            var fontBytes=0L
            PorticoMpvFonts.select(context,command["language"] as? String)
            if(kind=="ass")PorticoMpvFonts.selectFor(context,path.readText())
            val fallback=PorticoMpvFonts.fallbackDirectory(context).listFiles()?.filter { it.isFile && it.length() in 1..32_000_000 }?.map { it.path } ?: emptyList()
            val fonts = (fontUrls.mapIndexed { i,u -> fetch(Uri.parse(u),File(dir,"font-$i.ttf"),32L shl 20).also { fontBytes+=it.length(); require(fontBytes<=64L shl 20) }.path } + fallback).distinct().take(64).toTypedArray()
            val made = PorticoSubtitleNative.create(kind!!,path.path,fonts)
            if(made == 0L) error("The subtitle decoder could not open this track")
            if(handle != 0L) PorticoSubtitleNative.destroy(handle)
            handle = made
          } catch (_: Exception) { statusError = "subtitle_load_failed" }
          main.post {
            if(epoch != generation) return@post
            if(statusError != null) { authorizedUntil=0; onStatus?.invoke(statusError!!) }
            else { authorizedUntil = if(media.scheme=="file") Long.MAX_VALUE else SystemClock.elapsedRealtime()+40_000; onStatus?.invoke("") }
            if(media.scheme != "file" && active) { refresh=this; main.postDelayed(this,25_000) }
          }
        }
      }
    }
    work.run()
  }
  private fun allowed(target: Uri,media: Uri): Boolean {
    if(target.scheme == "file") return media.scheme == "file" && PorticoMpvSupport.allowedLocalSource(context,target) && PorticoMpvSupport.allowedLocalSource(context,media)
    return PorticoMpvSupport.subtitleFileBelongs(target,media)
  }
  private fun fetch(uri: Uri,dest: File,limit: Long): File {
    if(uri.scheme == "file") {
      val source = File(uri.path!!); require(source.length() in 1..limit); source.copyTo(dest,overwrite=true); return dest
    }
    val request = http.newCall(Request.Builder().url(uri.toString()).build()); call=request
    request.execute().use { response ->
      require(response.code==200)
      val body=response.body ?: error("No subtitle body")
      require(body.contentLength()<=limit)
      body.byteStream().use { input -> dest.outputStream().use { output ->
        val chunk=ByteArray(32768); var total=0L
        while(true) { val n=input.read(chunk); if(n<0)break; total+=n; require(total<=limit); output.write(chunk,0,n) }
      } }
    }
    call=null; return dest
  }
  fun frame(positionUs: Long,width: Int,height: Int,sourceWidth: Int,sourceHeight: Int,invalidate: () -> Unit) {
    if(!active || busy || width !in 1..4096 || height !in 1..4096 || SystemClock.elapsedRealtime()>=authorizedUntil) return
    busy=true; val generation=epoch; val time=positionUs-offsetUs
    val style=captionStyle?.toMap()
    val keep=style?.get("keepStyling") != false && style?.get("useSystemCaptionStyle") != true
    val color=PorticoMpvSupport.captionColors(context,style).first
    val family=when(style?.get("font")) { "serif" -> "serif";"mono" -> "monospace";"rounded" -> "sans-serif-rounded";else -> "sans-serif" }
    val position=when(style?.get("position")) { "raised" -> 1;"top" -> 2;else -> 0 }
    val scale=PorticoMpvSupport.styleScale(style)*(if(style?.get("useSystemCaptionStyle")==true) PorticoMpvSupport.captionScale(context) else 1.0)
    worker.execute {
      var bitmap=back
      if(bitmap==null || bitmap.width!=width || bitmap.height!=height) { bitmap?.recycle(); bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888) }
      if(handle!=0L)PorticoSubtitleNative.style(handle,keep,family,color,position,scale)
      val ok=handle!=0L && PorticoSubtitleNative.render(handle,time,bitmap,sourceWidth,sourceHeight)
      val result=bitmap
      main.post { busy=false; if(generation!=epoch) { result.recycle(); return@post }; if(ok) { back=front; front=result; invalidate() } else back=result }
    }
  }
  fun draw(canvas: Canvas) { if(ready) front?.let { canvas.drawBitmap(it,0f,0f,null) } }
  fun invalidate() {
    epoch++; active=false; key=null; authorizedUntil=0; call?.cancel(); call=null
    refresh?.let(main::removeCallbacks); refresh=null
    val retired=front; front=null
    worker.execute { if(handle!=0L)PorticoSubtitleNative.destroy(handle); handle=0; back?.recycle();back=null; retired?.recycle(); folder.deleteRecursively() }
  }
  fun close() { invalidate(); worker.shutdown(); http.dispatcher.executorService.shutdown();http.connectionPool.evictAll() }
  companion object { val KINDS=listOf("ass","pgs","vobsub","dvb") }
}

/** sRGB ARGB_8888 is an SDR Android UI layer; it never uses the HDR video's transfer function. */
internal class PorticoRichSubtitleView(context: Context) : View(context), Choreographer.FrameCallback {
  override fun onAttachedToWindow() { super.onAttachedToWindow(); Choreographer.getInstance().postFrameCallback(this) }
  override fun onDetachedFromWindow() { Choreographer.getInstance().removeFrameCallback(this); super.onDetachedFromWindow() }
  override fun doFrame(frameTimeNanos: Long) {
    val controller=PorticoPlaybackController.shared
    if(isShown && controller?.richSubtitles?.active == true) {
      val size=controller.videoSize
      controller.richSubtitles.frame(controller.subtitlePositionUs(),width,height,size.width,size.height,::invalidate)
      if(!controller.richSubtitles.ready) invalidate()
    }
    if(isAttachedToWindow) Choreographer.getInstance().postFrameCallback(this)
  }
  override fun onDraw(canvas: Canvas) { super.onDraw(canvas); PorticoPlaybackController.shared?.richSubtitles?.draw(canvas) }
}

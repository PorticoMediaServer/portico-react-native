package tv.getportico.portico.native

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.accessibility.CaptioningManager
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject

/**
 * Pieces of the mpv engine that need no libmpv: command validation, track matching and the
 * address rules. The Android counterpart of `Native/PorticoMpvSupport.swift`, rule for rule.
 */
internal object PorticoMpvSupport {
  val RATES = listOf(0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0)
  const val MAX_SAFE_INTEGER = 9007199254740991.0

  // --- values from JavaScript -------------------------------------------------------------

  /** A JSON boolean, and nothing that merely converts to one. */
  fun boolean(value: Any?): Boolean? = value as? Boolean

  /** A finite JSON number. */
  fun number(value: Any?): Double? = (value as? Number)?.toDouble()?.takeIf { it.isFinite() }

  /** A whole number in `minimum..2^53-1`. */
  fun integer(value: Any?, minimum: Double = 1.0): Long? {
    val n = number(value) ?: return null
    return if (n >= minimum && n <= MAX_SAFE_INTEGER && Math.floor(n) == n) n.toLong() else null
  }

  @Suppress("UNCHECKED_CAST")
  fun map(value: Any?): Map<String, Any?>? = value as? Map<String, Any?>

  // --- mpv's JSON -------------------------------------------------------------------------

  private fun plain(value: Any?): Any? = when (value) {
    null, JSONObject.NULL -> null
    is JSONObject -> HashMap<String, Any?>().also { out -> for (key in value.keys()) out[key] = plain(value.opt(key)) }
    is JSONArray -> ArrayList<Any?>(value.length()).also { out -> for (i in 0 until value.length()) out.add(plain(value.opt(i))) }
    else -> value
  }

  /** A list property (`track-list`, `chapter-list`) as mpv prints it. Empty when it is not one. */
  fun jsonList(text: String?): List<Map<String, Any?>> {
    if (text.isNullOrEmpty()) return emptyList()
    val array = try { JSONArray(text) } catch (_: Exception) { return emptyList() }
    val out = ArrayList<Map<String, Any?>>(array.length())
    for (i in 0 until array.length()) map(plain(array.opt(i)))?.let { out.add(it) }
    return out
  }

  /** A map property (`video-params`). Empty when it is not one. */
  fun jsonMap(text: String?): Map<String, Any?> {
    if (text.isNullOrEmpty()) return emptyMap()
    return try { map(plain(JSONObject(text))) ?: emptyMap() } catch (_: Exception) { emptyMap() }
  }

  // --- addresses --------------------------------------------------------------------------

  fun parse(value: String?): Uri? = try { value?.takeIf { it.isNotEmpty() }?.let { Uri.parse(it) }?.takeIf { it.scheme != null } } catch (_: Exception) { null }

  /**
   * A downloaded title: a file inside the app's own Downloads folder, checked after symbolic
   * links are resolved, and nowhere else on the device. The same rule as the Media3 engine.
   */
  fun allowedLocalSource(context: Context, url: Uri): Boolean {
    if (url.scheme?.lowercase() != "file" || url.encodedQuery != null || url.encodedFragment != null) return false
    return try {
      val root = File(context.noBackupFilesDir, "Downloads").canonicalPath
      val file = File(url.path ?: return false).canonicalFile
      file.path.startsWith("$root/") && file.isFile
    } catch (_: Exception) {
      false
    }
  }

  fun allowedSource(context: Context, url: Uri): Boolean {
    val scheme = url.scheme?.lowercase()
    if (scheme == "http" || scheme == "https") return !url.host.isNullOrEmpty() && url.userInfo == null
    return allowedLocalSource(context, url)
  }

  /**
   * An external subtitle or font file belongs to the playback when it is on the media's own
   * origin and under the media's own grant (`/v1/media/<grant>/...`), with no credentials or
   * fragment. Plain HTTP only to this device or the home network.
   */
  fun subtitleFileBelongs(url: Uri, media: Uri): Boolean {
    val scheme = url.scheme?.lowercase() ?: return false
    if (!(scheme == "https" || (scheme == "http" && PorticoSubtitleSelection.privateHost(url.host)))) return false
    if (scheme != media.scheme?.lowercase() || url.host?.lowercase() != media.host?.lowercase() || url.port != media.port) return false
    if (url.userInfo != null || url.encodedFragment != null) return false
    val parts = media.pathSegments
    if (parts.size < 3 || parts[0] != "v1" || parts[1] != "media") return false
    return (url.path ?: "").startsWith("/v1/media/${parts[2]}/")
  }

  // --- tracks -----------------------------------------------------------------------------

  fun tracks(all: List<Map<String, Any?>>, type: String): List<Map<String, Any?>> = all.filter { it["type"] == type }

  fun trackId(track: Map<String, Any?>): Int? = (track["id"] as? Number)?.toInt()

  fun streamIndex(track: Map<String, Any?>): Int? = (track["ff-index"] as? Number)?.toInt()

  /** A real video track, not cover art. */
  fun hasVideo(all: List<Map<String, Any?>>): Boolean = tracks(all, "video").any { it["albumart"] != true && it["image"] != true }

  /**
   * The name an HLS audio rendition was given in its playlist, which FFmpeg files as the
   * stream's comment; otherwise the track's own title.
   */
  fun names(track: Map<String, Any?>): List<String> {
    val out = ArrayList<String>()
    (track["title"] as? String)?.takeIf { it.isNotEmpty() }?.let { out.add(it) }
    map(track["metadata"])?.forEach { (key, value) ->
      val lowered = key.lowercase()
      if ((lowered == "comment" || lowered == "name" || lowered == "title") && value is String && value.isNotEmpty()) out.add(value)
    }
    return out
  }

  /**
   * Maps each server rendition (`id`, `name`, optional `streamIndex`) to exactly one mpv audio
   * track. Every rendition must find its own track, or nothing is mapped: by the file's stream
   * index when the server gives one, else by name, else by position when the counts agree.
   */
  fun mapRenditions(renditions: List<Map<String, Any?>>, audio: List<Map<String, Any?>>): Map<String, Int>? {
    if (renditions.isEmpty() || renditions.size > 64) return null
    val ids = ArrayList<String>()
    for (rendition in renditions) {
      val id = rendition["id"] as? String
      if (id.isNullOrEmpty() || ids.contains(id)) return null
      ids.add(id)
    }
    val mapped = LinkedHashMap<String, Int>()
    val used = HashSet<Int>()
    var exact = true
    for ((position, rendition) in renditions.withIndex()) {
      var match: Int? = null
      integer(rendition["streamIndex"], 0.0)?.let { index ->
        val found = audio.filter { streamIndex(it)?.toLong() == index }
        if (found.size == 1) match = trackId(found[0])
      }
      if (match == null) {
        val name = rendition["name"] as? String
        if (!name.isNullOrEmpty()) {
          val found = audio.filter { names(it).contains(name) }
          if (found.size == 1) match = trackId(found[0])
        }
      }
      val track = match
      if (track == null || used.contains(track)) { exact = false; break }
      mapped[ids[position]] = track
      used.add(track)
    }
    if (exact) return mapped
    if (audio.size != renditions.size) return null
    mapped.clear()
    for ((position, id) in ids.withIndex()) mapped[id] = trackId(audio[position]) ?: return null
    return mapped
  }

  /** The codecs FFmpeg reports for each subtitle kind of the capability document. */
  val SUBTITLE_CODECS: Map<String, Set<String>> = mapOf(
      "text" to setOf("subrip", "srt", "webvtt", "mov_text", "text", "microdvd", "sami", "ttml"),
      "ass" to setOf("ass", "ssa"),
      "pgs" to setOf("hdmv_pgs_subtitle"),
      "vobsub" to setOf("dvd_subtitle"),
      "dvb" to setOf("dvb_subtitle", "dvb_teletext"))

  /** The subtitle kinds mpv draws itself, by the names the capability document uses. */
  val RENDERED_SUBTITLE_KINDS = listOf("text", "ass", "pgs", "vobsub", "dvb")

  private fun codecOf(track: Map<String, Any?>): String = ((track["codec"] as? String) ?: "").lowercase()

  /**
   * The track inside the media itself that an `embedded` description names: of the wanted kind,
   * by stream index, else by its position among the file's own subtitle tracks, else by language
   * (and title when several share the language). Null when nothing, or more than one track, fits.
   */
  fun embeddedSubtitle(embedded: Map<String, Any?>, kind: String, subtitles: List<Map<String, Any?>>): Int? {
    val codecs = SUBTITLE_CODECS[kind] ?: emptySet()
    val own = subtitles.filter { it["external"] != true }
    val ofKind = own.filter { codecs.contains(codecOf(it)) }
    integer(embedded["streamIndex"], 0.0)?.let { index ->
      val found = ofKind.filter { streamIndex(it)?.toLong() == index }
      if (found.size == 1) return trackId(found[0])
    }
    integer(embedded["ordinal"], 0.0)?.let { ordinal ->
      if (ordinal < own.size && codecs.contains(codecOf(own[ordinal.toInt()]))) return trackId(own[ordinal.toInt()])
    }
    val language = (embedded["language"] as? String)?.lowercase()
    if (language.isNullOrEmpty() || language.length > 35) return null
    val wanted = baseLanguage(language)
    var matches = ofKind.filter { baseLanguage(((it["lang"] as? String) ?: "").lowercase()) == wanted }
    val title = embedded["title"] as? String
    if (matches.size > 1 && !title.isNullOrEmpty()) {
      val titled = matches.filter { ((it["title"] as? String) ?: "").equals(title, ignoreCase = true) }
      if (titled.size == 1) matches = titled
    }
    return if (matches.size == 1) trackId(matches[0]) else null
  }

  private val THREE_LETTER = mapOf(
      "eng" to "en", "fra" to "fr", "fre" to "fr", "deu" to "de", "ger" to "de", "spa" to "es", "ita" to "it", "por" to "pt",
      "nld" to "nl", "dut" to "nl", "jpn" to "ja", "kor" to "ko", "zho" to "zh", "chi" to "zh", "rus" to "ru", "swe" to "sv",
      "nor" to "no", "dan" to "da", "fin" to "fi", "pol" to "pl", "tur" to "tr", "ara" to "ar", "heb" to "he", "hin" to "hi",
      "ces" to "cs", "cze" to "cs", "ell" to "el", "gre" to "el", "hun" to "hu", "ron" to "ro", "rum" to "ro", "ukr" to "uk",
      "vie" to "vi", "tha" to "th", "ind" to "id")

  /** Two- and three-letter codes for the same language compare equal for the common cases. */
  fun baseLanguage(tag: String): String {
    val base = tag.split('-', '_').firstOrNull() ?: tag
    return THREE_LETTER[base] ?: base
  }

  // --- device -----------------------------------------------------------------------------

  /**
   * The viewer's caption size from the system's Accessibility settings, as a scale on the
   * engine's own subtitle size (1 when the viewer has not set one).
   */
  fun captionScale(context: Context): Double {
    val scale = try { (context.getSystemService(Context.CAPTIONING_SERVICE) as? CaptioningManager)?.fontScale?.toDouble() } catch (_: Exception) { null } ?: 1.0
    return if (scale.isFinite() && scale > 0) scale.coerceIn(0.5, 3.0) else 1.0
  }

  /** Text for mpv, which takes numbers in the C locale whatever the device's language. */
  fun decimal(value: Double, digits: Int = 3): String = String.format(java.util.Locale.ROOT, "%.${digits}f", value)
}

/**
 * Fetches the fonts attached to a styled subtitle file into a folder mpv can read them from.
 * Bounded in number, size and time; never follows a redirect; a font that cannot be fetched is
 * left out, and the subtitles are then drawn with the nearest system font.
 *
 * Main thread only.
 */
internal class PorticoMpvFontFetcher(private val context: Context) {
  private val main = Handler(Looper.getMainLooper())
  private var calls = ArrayList<Call>()
  private var generation = 0
  var folder: File? = null
    private set

  /**
   * [fonts] are `{name, url}` pairs on the media's own origin and under its grant. [completion]
   * runs on the main thread with the folder, or null when nothing was fetched.
   */
  fun fetch(fonts: List<Map<String, Any?>>, media: Uri, completion: (File?) -> Unit) {
    cancel()
    val wanted = ArrayList<Pair<String, Uri>>()
    for (font in fonts.take(MAXIMUM_FONTS)) {
      val text = font["url"] as? String ?: continue
      if (text.toByteArray(Charsets.UTF_8).size > 2048) continue
      val url = resolve(text, media) ?: continue
      if (!PorticoMpvSupport.subtitleFileBelongs(url, media)) continue
      val raw = (font["name"] as? String) ?: "font"
      val safe = raw.filter { it.isLetterOrDigit() || it == '.' || it == '-' || it == '_' }.take(80)
      wanted.add(Pair(safe.ifEmpty { "font" }, url))
    }
    if (wanted.isEmpty()) { completion(null); return }
    val directory = File(File(context.cacheDir, "portico-mpv-fonts"), UUID.randomUUID().toString())
    if (!directory.mkdirs()) { completion(null); return }
    folder = directory
    val attempt = ++generation
    var remaining = wanted.size
    var stored = 0
    for ((position, entry) in wanted.withIndex()) {
      val call = try { client.newCall(Request.Builder().url(entry.second.toString()).build()) } catch (_: Exception) { null }
      if (call == null) {
        remaining--
        continue
      }
      calls.add(call)
      call.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { done(false) }

        override fun onResponse(call: Call, response: Response) {
          val ok = response.use { answer ->
            val source = answer.body?.source()
            if (answer.code != 200 || source == null || (answer.body?.contentLength() ?: 0) > MAXIMUM_BYTES) return@use false
            try {
              val buffer = Buffer()
              while (source.read(buffer, 65536) != -1L) if (buffer.size > MAXIMUM_BYTES) return@use false
              if (buffer.size == 0L) return@use false
              File(directory, "$position-${entry.first}").outputStream().use { buffer.writeTo(it) }
              true
            } catch (_: IOException) {
              false
            }
          }
          done(ok)
        }

        private fun done(ok: Boolean) {
          main.post {
            if (attempt != generation) return@post
            if (ok) stored++
            remaining--
            if (remaining == 0) completion(if (stored > 0) directory else null)
          }
        }
      })
    }
    if (remaining == 0) completion(null)
  }

  /** Stops any fetch and removes the folder. */
  fun cancel() {
    generation++
    calls.forEach { it.cancel() }
    calls = ArrayList()
    val old = folder
    folder = null
    if (old != null) io.execute { try { old.deleteRecursively() } catch (_: Exception) {} }
  }

  companion object {
    private const val MAXIMUM_FONTS = 16
    private const val MAXIMUM_BYTES = 24L * 1024 * 1024
    private val io = java.util.concurrent.Executors.newSingleThreadExecutor { task -> Thread(task, "portico-mpv-fonts").apply { isDaemon = true } }

    /** A scoped media grant, not a bearer credential; a redirect is never followed. */
    private val client: OkHttpClient by lazy {
      OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).cache(null)
          .callTimeout(20, TimeUnit.SECONDS).connectTimeout(10, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).build()
    }

    /** [text] as an absolute address, read against [base] when it is relative. */
    fun resolve(text: String, base: Uri): Uri? = try {
      java.net.URI(base.toString()).resolve(text).toString().let { Uri.parse(it) }.takeIf { it.scheme != null }
    } catch (_: Exception) {
      null
    }
  }
}

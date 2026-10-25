package tv.getportico.portico.native

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaMetadataRetriever
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.StatFs
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.getportico.portico.R

/**
 * Offline downloads for phones and tablets: the Android counterpart of `Native/PorticoDownloads.m`.
 *
 * The server prepares a file and hands out an address for it; this moves the bytes and keeps them.
 * A transfer belongs to the process, not to the React instance, and a foreground service keeps the
 * process alive while one runs, so it goes on with the app out of sight. A finished file is
 * checked against the server's SHA-256 before it is called ready: a truncated or substituted file
 * is deleted, never played. Files live in the app's no-backup storage (they are re-downloadable
 * and can be tens of gigabytes).
 *
 * A file is what its SHA-256 says it is, not where it was fetched from. What has already arrived
 * is kept in `partial.part` and continued with `Range` and `If-Range` under whatever address the
 * app holds for the same file, so a dropped connection, a pause, a killed process or a fresh
 * address all carry on from where the bytes stopped. A dropped connection is retried here, with
 * growing waits; "Wi-Fi only" on mobile data waits for Wi-Fi and then carries on by itself.
 *
 * Each entry says what it is doing in three fields. `state` is `downloading`, `paused`, `failed`
 * or `ready`. `waiting` says why a download that should be moving is not: `network` or `wifi`.
 * `intent` is `hold` once the person has paused it, and `run` otherwise: an entry that is paused
 * or failed with `run` stopped by itself and is started again by the app when it can be.
 *
 * When the process is gone with transfers unfinished (the system ended it, the person swiped the
 * app away, the service's allowance ran out), a platform job (`PorticoDownloadJob`, JobScheduler)
 * owned by the installation brings the process back once a network it may use is there and
 * carries them on from their bytes, under the addresses they had, with the app closed (B-14.20).
 * An address that has run out cannot be renewed without the app: that download waits for it.
 *
 * This knows nothing about accounts, receipts or what may be played; that is decided in JavaScript
 * from the server's signed receipt.
 */
internal object PorticoDownloadCenter {
  /** An entry changed (or was removed: `{id, state: "removed"}`). Called on the bookkeeping thread. */
  var onChanged: ((Map<String, Any?>) -> Unit)? = null

  private class Transfer(val attempt: Double, val digest: String, val bytes: Long,
      @Volatile var call: Call? = null, @Volatile var stopped: String? = null)

  private val work = Executors.newSingleThreadExecutor { Thread(it, "portico-downloads") }
  private val transfers = Executors.newFixedThreadPool(2) { Thread(it, "portico-download-transfer") }
  private val fileWork = PorticoDownloadWork(transfers)
  private val entries = HashMap<String, MutableMap<String, Any?>>()
  private val active = HashMap<String, Transfer>()
  private val lastEmit = HashMap<String, Long>()
  private var attempts = 0.0
  private val extraAttempts = HashMap<Pair<String?, String?>, Any>()
  private var cellular = false
  private lateinit var app: Context
  private var loaded = false
  private val http: OkHttpClient by lazy {
    OkHttpClient.Builder().porticoTrust().followRedirects(false).followSslRedirects(false).cache(null)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
  }
  private val extraHttp: OkHttpClient by lazy { http.newBuilder().callTimeout(60, TimeUnit.SECONDS).build() }

  /** Everything that touches the entries runs on one thread. */
  fun post(block: () -> Unit) { work.execute(block) }

  /** Reads the manifest once. A transfer the last process left running is paused, still meant to run. */
  fun open(context: Context) {
    if (loaded) return
    loaded = true
    app = context.applicationContext
    cellular = app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean("cellular", false)
    root().listFiles()?.forEach { if (it.name.endsWith(".incoming")) it.delete() }
    root().listFiles()?.filter { it.name.startsWith(".") && it.name.endsWith(".removed") }?.forEach { removed ->
      transfers.execute { removed.deleteRecursively() }
    }
    @Suppress("UNCHECKED_CAST") val stored = try { PorticoListeningOwner.parse(File(root(), "manifest.json").readBytes()) as? Map<String, Any?> } catch (_: Exception) { null }
    stored?.forEach { (key, value) ->
      @Suppress("UNCHECKED_CAST") val entry = value as? Map<String, Any?> ?: return@forEach
      if (!safeIdentifier(key)) return@forEach
      val copy = HashMap(entry)
      // The process that was moving it is gone. Its bytes are in partial.part; the app starts it
      // again (it was not the person who stopped it).
      if (copy["state"] == "downloading") { copy["state"] = "paused"; copy["error"] = ""; copy["waiting"] = "" }
      entries[key] = copy
    }
    try {
      (app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
        // "Never use mobile data" means now: a transfer in flight waits for Wi-Fi, keeping its
        // bytes, and carries on by itself when Wi-Fi is back.
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = post { networkChanged() }
        override fun onAvailable(network: Network) = post { networkChanged() }
      })
    } catch (_: Exception) {}
  }

  private fun networkChanged() {
    if (!cellular && onCellular()) { for ((id, transfer) in active.toList()) hold(id, transfer, "wifi"); return }
    // Whatever was waiting for a network it may use starts again under the address it had. An
    // address that has run out answers 401, and the app then renews it.
    for ((id, entry) in entries.toList()) {
      val url = entry["grantUrl"] as? String ?: continue
      if (entry["state"] == "downloading" && (entry["waiting"] == "wifi" || entry["waiting"] == "network") && active[id] == null) begin(id, url, entry)
    }
  }

  private fun root(): File = File(app.noBackupFilesDir, "Downloads").also { it.mkdirs() }
  private fun directory(id: String) = File(root(), id)
  private fun partial(id: String) = File(directory(id), "partial.part")

  private fun save(): Boolean = try {
    val target = File(root(), "manifest.json")
    val holding = File(root(), "manifest.json.tmp")
    FileOutputStream(holding).use { it.write(PorticoListeningOwner.json(entries).toByteArray(Charsets.UTF_8)); it.fd.sync() }
    holding.renameTo(target)
  } catch (_: Exception) { false }

  private fun changed(id: String, force: Boolean) {
    // Progress arrives many times a second; the interface needs it about twice a second.
    val now = System.currentTimeMillis()
    if (!force && now - (lastEmit[id] ?: 0) < 500) return
    lastEmit[id] = now
    onChanged?.invoke(entries[id]?.let { published(id, it) } ?: mapOf("id" to id, "state" to "removed"))
  }

  /** An entry as JavaScript sees it: what is stored, plus where its folder is right now. */
  private fun published(id: String, entry: Map<String, Any?>): Map<String, Any?> {
    val copy = HashMap(entry)
    copy["dir"] = android.net.Uri.fromFile(directory(id)).toString() + "/"
    // The address is a credential: it is used here and never handed back.
    copy.remove("grantUrl")
    return copy
  }

  private fun onCellular(): Boolean {
    val manager = app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
    return manager.getNetworkCapabilities(manager.activeNetwork ?: return false)?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
  }

  // --- the JavaScript interface (all on the bookkeeping thread) --------------------------------

  fun list(): List<Map<String, Any?>> = entries.map { (id, entry) -> published(id, entry) }

  /** The entry as it stands once the transfer has begun, or null for an invalid request. */
  fun start(request: Map<String, Any?>): Map<String, Any?>? {
    val id = request["id"] as? String
    val url = request["url"] as? String
    val wanted = (request["sha256"] as? String)?.lowercase() ?: ""
    val bytes = PorticoMpvSupport.integer(request["bytes"])
    if (!safeIdentifier(id) || !SHA256.matches(wanted) || bytes == null || url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return null
    id!!
    val entry = entries[id] ?: HashMap()
    if (entry["state"] == "ready") return published(id, entry)
    // Continue and retry both arrive here: an earlier transfer for the same download ends first.
    active.remove(id)?.let { it.stopped = "superseded"; it.call?.cancel() }
    // What is already on the device belongs to one exact file. It is continued under any address
    // for that same file, and thrown away only when the file asked for now is a different one.
    for (key in TEXT_FIELDS) (request[key] as? String)?.let { entry[key] = it }
    entry["id"] = id
    entry["bytes"] = bytes.toDouble()
    entry["bytesDone"] = (if (partial(id).isFile) partial(id).length() else 0L).toDouble()
    entry["error"] = ""
    entry["intent"] = "run"
    if (entry["addedAt"] == null) entry["addedAt"] = System.currentTimeMillis().toDouble()
    entries[id] = entry
    begin(id, url, entry)
    // Started by the person with the app in front: on Android 14 and later the job that carries it
    // on is a user-initiated data transfer, which the system does not cut off after ten minutes.
    if (active[id] != null || entry["waiting"] == "wifi") PorticoDownloadJob.schedule(app, cellular, userInitiated = true)
    return published(id, entry)
  }

  /** Starts, or starts again, moving one entry's bytes from `url`. */
  private fun begin(id: String, url: String, entry: MutableMap<String, Any?>) {
    active.remove(id)?.let { it.stopped = "superseded"; it.call?.cancel() }
    val digest = (entry["sha256"] as? String)?.lowercase() ?: ""
    val bytes = PorticoMpvSupport.integer(entry["bytes"])
    if (!SHA256.matches(digest) || bytes == null) {
      entry["state"] = "failed"; entry["error"] = "verification_failed"; entry["waiting"] = ""
      save(); changed(id, true); release()
      return
    }
    entry["grantUrl"] = url
    entry["state"] = "downloading"
    entry["waiting"] = ""
    val transfer = Transfer(++attempts, digest, bytes)
    entry["taskIdentifier"] = transfer.attempt
    active[id] = transfer
    save()
    changed(id, true)
    if (!cellular && onCellular()) { hold(id, transfer, "wifi"); return }
    running = active.size
    PorticoDownloadService.keepAlive(app)
    PorticoDownloadJob.schedule(app, cellular)
    directory(id).mkdirs()
    // Cancellation closes the HTTP call asynchronously. The next attempt must wait for that
    // worker to close its file before inspecting, truncating or appending the partial file.
    fileWork.execute(id) {
      if (transfer.stopped == null) {
        if (prepareDownloadPartial(directory(id), digest)) transfer(id, url, transfer)
        else post { finish(id, transfer, partial(id), "storage_full", "") }
      }
    }
  }

  private fun accepts(id: String, transfer: Transfer): MutableMap<String, Any?>? {
    val entry = entries[id] ?: return null
    return if (entry["state"] != "ready" && entry["taskIdentifier"] == transfer.attempt && active[id] === transfer) entry else null
  }

  /** Stops a transfer that is to carry on by itself: it stays "downloading", and says what it waits for. */
  private fun hold(id: String, transfer: Transfer, waiting: String) {
    transfer.stopped = "held"
    transfer.call?.cancel()
    val entry = accepts(id, transfer) ?: return
    active.remove(id)
    entry["state"] = "downloading"
    entry["waiting"] = waiting
    entry["error"] = ""
    save()
    changed(id, true)
    release()
    PorticoDownloadJob.schedule(app, cellular)
  }

  /** Stops a transfer for good until somebody starts it again. `intent` records who stopped it. */
  private fun suspend(id: String, transfer: Transfer?, intent: String) {
    transfer?.stopped = "paused"
    transfer?.call?.cancel()
    val entry = (if (transfer != null) accepts(id, transfer) else entries[id]?.takeIf { it["state"] == "downloading" }) ?: return
    active.remove(id)
    entry["state"] = "paused"
    entry["waiting"] = ""
    entry["error"] = ""
    entry["intent"] = intent
    save()
    changed(id, true)
    release()
  }

  /** The person paused it: it stays paused until they continue it. */
  fun pause(id: String?) { suspend(id ?: return, active[id], "hold") }

  /** The system is ending the service (or the job) that keeps transfers alive: they stop, keeping their bytes, and the job or the app starts them again. */
  fun interruptAll() {
    for ((id, transfer) in active.toList()) suspend(id, transfer, "run")
    if (unfinished()) PorticoDownloadJob.schedule(app, cellular)
  }

  /** Downloads that stopped by themselves and still have an address to continue from. */
  private fun unfinished(): Boolean = entries.values.any { resumable(it) }
  private fun resumable(entry: Map<String, Any?>): Boolean =
      entry["grantUrl"] is String && entry["intent"] != "hold" && (entry["state"] == "paused" || entry["state"] == "downloading" || (entry["state"] == "failed" && entry["error"] == "network"))

  /** Runs on the bookkeeping thread when the last transfer in flight has stopped (the job's cue to finish). */
  var onIdle: (() -> Unit)? = null

  /**
   * The job's work: every download that stopped by itself is carried on from its bytes under the
   * address it had. False when there is nothing to carry on (the job then ends and is cancelled).
   */
  fun resumeUnfinished(): Boolean {
    if (!cellular && onCellular()) return unfinished()
    for ((id, entry) in entries.toList()) {
      val url = entry["grantUrl"] as? String ?: continue
      if (active[id] == null && resumable(entry)) { entry["error"] = ""; begin(id, url, entry) }
    }
    if (active.isEmpty() && !unfinished()) PorticoDownloadJob.cancel(app)
    return active.isNotEmpty()
  }

  /** Whether downloads still wait to be carried on (the job asks to run again when they do). */
  fun hasUnfinished(): Boolean = unfinished()

  fun remove(id: String?): Boolean {
    if (!safeIdentifier(id)) return false
    id!!
    val folder = directory(id)
    val removed = File(root(), ".$id-${java.util.UUID.randomUUID()}.removed")
    if (folder.exists() && !folder.renameTo(removed)) return false
    active.remove(id)?.let { it.stopped = "removed"; it.call?.cancel() }
    entries.remove(id)
    // Removing and immediately downloading again uses the same directory. Removal belongs
    // between the old writer and the replacement writer, without blocking bookkeeping.
    fileWork.execute(id) { removed.deleteRecursively() }
    save()
    changed(id, true)
    release()
    return true
  }

  /** Null when saved; otherwise the rejection code. */
  fun setMeta(id: String?, meta: String?): String? {
    val entry = entries[id] ?: return "not_found"
    if (meta == null || meta.length >= 65536) return "too_large"
    val previous = entry["meta"]
    entry["meta"] = meta
    if (!save()) { if (previous != null) entry["meta"] = previous else entry.remove("meta"); return "write_failed" }
    changed(id!!, true)
    return null
  }

  /** Several entries' details in one write of the manifest. Null when saved; otherwise the rejection code. */
  fun setMetas(metas: Map<String, Any?>): String? {
    for ((id, meta) in metas) {
      if (entries[id] != null && (meta !is String || meta.length >= 65536)) return "too_large"
    }
    val previous = HashMap<String, Any?>()
    for ((id, meta) in metas) {
      val entry = entries[id] ?: continue
      previous[id] = entry["meta"]
      entry["meta"] = meta
    }
    if (!save()) {
      for ((id, meta) in previous) entries[id]?.let { if (meta != null) it["meta"] = meta else it.remove("meta") }
      return "write_failed"
    }
    for (id in previous.keys) changed(id, true)
    return null
  }

  // --- what travels with a download: its description, artwork and subtitles -------------------

  private fun extra(id: String?, name: String?): File? {
    if (!safeIdentifier(id) || entries[id] == null || name == null || !EXTRA.matches(name)) return null
    return File(File(directory(id!!), "extras"), name)
  }

  /** Writes one small text file beside the download. False when it could not be kept. */
  fun writeExtra(id: String?, name: String?, text: String?): Boolean {
    val file = extra(id, name) ?: return false
    if (text == null || text.length > MAX_EXTRA) return false
    return try {
      file.parentFile?.mkdirs()
      val holding = File(file.path + ".tmp")
      FileOutputStream(holding).use { it.write(text.toByteArray(Charsets.UTF_8)); it.fd.sync() }
      holding.renameTo(file)
    } catch (_: Exception) { false }
  }

  fun readExtra(id: String?, name: String?): String {
    val file = extra(id, name) ?: return ""
    return try { if (file.isFile && file.length() <= MAX_EXTRA) file.readText(Charsets.UTF_8) else "" } catch (_: Exception) { "" }
  }

  /**
   * Fetches one small file (a poster, a subtitle track) to keep beside the download. Answers
   * `saved`, `missing` (the server has no such file for this title, which is an ordinary answer),
   * `later` (not ready yet, or the connection failed) or `invalid`. Runs on a transfer thread.
   */
  fun fetchExtra(id: String?, name: String?, url: String?, done: (String) -> Unit) {
    val file = extra(id, name)
    if (file == null || url == null || !(url.startsWith("https://") || url.startsWith("http://"))) { done("invalid"); return }
    val entry = entries[id]
    val key = id to name
    val attempt = Any()
    extraAttempts[key] = attempt
    val holding = File(file.path + "." + java.util.UUID.randomUUID() + ".tmp")
    file.parentFile?.mkdirs()
    extras.execute {
      val outcome = try {
        extraHttp.newCall(Request.Builder().url(url).build()).execute().use { response ->
          val body = response.body
          when {
            response.code == 404 -> "missing"
            response.code !in 200..299 || body == null -> "later"
            body.contentLength() > MAX_EXTRA -> "missing"
            else -> {
              var total = 0L
              var fits = true
              FileOutputStream(holding).use { out ->
                val source = body.byteStream()
                val buffer = ByteArray(1 shl 16)
                while (true) {
                  val read = source.read(buffer)
                  if (read == -1) break
                  total += read
                  if (total > MAX_EXTRA) { fits = false; break }
                  out.write(buffer, 0, read)
                }
              }
              if (fits && total > 0) "saved" else if (fits) "later" else "missing"
            }
          }
        }
      } catch (_: Exception) { "later" }
      post {
        // An old fetch must neither overwrite a newer extra nor remove a replacement download.
        val current = entries[id] === entry && extraAttempts[key] === attempt
        if (extraAttempts[key] === attempt) extraAttempts.remove(key)
        val result = if (!current) "later" else if (outcome == "saved" && !holding.renameTo(file)) "later" else outcome
        holding.delete()
        if (entries[id] == null) { file.parentFile?.delete(); directory(id!!).delete() }
        done(result)
      }
    }
  }

  fun storage(): Map<String, Any?> {
    var used = 0.0
    for (entry in entries.values) if (entry["state"] == "ready") used += (entry["bytes"] as? Number)?.toDouble() ?: 0.0
    val volume = StatFs(root().absolutePath)
    val measured = PorticoDownloadStorage.measure(root())
    return mutableMapOf<String, Any?>("freeBytes" to volume.availableBytes.toDouble(), "totalBytes" to volume.totalBytes.toDouble(), "usedBytes" to used).apply {
      if (measured != null) {
        put("storedBytes", measured.storedBytes.toDouble())
        put("allocatedBytes", measured.allocatedBytes.toDouble())
      }
    }
  }

  fun setCellular(allowed: Boolean) {
    app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putBoolean("cellular", allowed).apply()
    cellular = allowed
    // Tightened on mobile data: what is in flight waits for Wi-Fi. Loosened: what was waiting goes on.
    networkChanged()
  }

  fun readState(): String = try { File(root(), "state.json").readText(Charsets.UTF_8) } catch (_: Exception) { "" }

  fun writeState(json: String): Boolean = try {
    val holding = File(root(), "state.json.tmp")
    FileOutputStream(holding).use { it.write(json.toByteArray(Charsets.UTF_8)); it.fd.sync() }
    holding.renameTo(File(root(), "state.json"))
  } catch (_: Exception) { false }

  /** The file of a finished download, or the rejection code (`not_ready`, `missing_file`). */
  fun file(id: String?): Any {
    val entry = entries[id] ?: return "not_ready"
    val name = entry["file"] as? String
    if (entry["state"] != "ready" || name == null) return "not_ready"
    val file = File(directory(id!!), safeFileName(name))
    return if (file.isFile) file else "missing_file"
  }

  /** Resolve only an exact ready owned download; never a caller supplied path. */
  fun publication(identifier: String, owner: String, digest: String): Pair<File, () -> Boolean>? {
    val entry = entries[identifier] ?: return null
    fun current(): Boolean = try {
      entries[identifier] === entry && entry["state"] == "ready" && entry["sha256"] == digest && org.json.JSONObject(entry["meta"] as? String ?: "{}").optString("owner") == owner
    } catch (_: Exception) {false}
    if (!current()) return null
    val file = file(identifier) as? File ?: return null
    return Pair(file, ::current)
  }

  fun durationSeconds(file: File): Double = try {
    val reader = MediaMetadataRetriever()
    try { reader.setDataSource(file.path); (reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0) / 1000.0 } finally { reader.release() }
  } catch (_: Exception) { 0.0 }

  // --- the transfer --------------------------------------------------------------------------

  private fun transfer(id: String, url: String, transfer: Transfer) {
    val part = partial(id)
    var failure: String? = null
    var attempt = 0
    while (true) {
      failure = attemptTransfer(id, url, transfer, part)
      if (transfer.stopped != null) return
      // A dropped connection is not the end of a download: wait a little longer each time and
      // carry on from the bytes already here. Anything else is for the app to deal with.
      if (failure != "network" || attempt >= RETRY_WAITS.size) break
      post { accepts(id, transfer)?.let { it["waiting"] = "network"; changed(id, true) } }
      val wait = RETRY_WAITS[attempt++]
      var slept = 0L
      while (slept < wait) { Thread.sleep(500); slept += 500; if (transfer.stopped != null) return }
      post { accepts(id, transfer)?.let { it["waiting"] = ""; changed(id, true) } }
    }
    if (transfer.stopped != null) return
    val digest = if (failure == null) sha256(part, transfer) else ""
    if (transfer.stopped != null) return
    post { finish(id, transfer, part, failure, digest) }
  }

  /** One request for the rest of the file. Null when the whole file is now in `part`; otherwise why not. */
  private fun attemptTransfer(id: String, url: String, transfer: Transfer, part: File): String? {
    try {
      if (transfer.stopped != null) return "stopped"
      val expected = transfer.digest
      val size = transfer.bytes
      var offset = if (part.isFile) part.length() else 0L
      // Everything is already here (the last attempt died between the last byte and the check).
      if (size > 0 && offset == size) return null
      if (size > 0 && offset > size) { part.delete(); offset = 0L }
      val request = Request.Builder().url(url)
      if (offset > 0) {
        request.header("Range", "bytes=$offset-")
        // The server answers with the rest only if the file is still the one these bytes came
        // from; otherwise it sends the whole file and the bytes here are replaced.
        if (expected.isNotEmpty()) request.header("If-Range", "\"sha256-$expected\"")
      }
      val call = http.newCall(request.build())
      transfer.call = call
      if (transfer.stopped != null) return "stopped"
      call.execute().use { response ->
        val status = response.code
        if (status == 416) { part.delete(); return "network" }
        if (status == 503 || status == 429) return "network"
        if (status !in 200..299) return if (status == 401 || status == 403 || status == 404 || status == 409 || status == 410) "grant_expired" else "server_refused"
        // 206 must continue exactly where the bytes here end, of the same file.
        val range = response.header("Content-Range") ?: ""
        val tag = (response.header("ETag") ?: "").lowercase()
        val appending = status == 206 && offset > 0 && range.startsWith("bytes $offset-") && (expected.isEmpty() || tag.isEmpty() || tag == "\"sha256-$expected\"")
        if (status == 206 && !appending) { part.delete(); return "network" }
        val body = response.body ?: return "transfer_failed"
        val length = body.contentLength()
        var done = if (appending) offset else 0L
        val total = if (length > 0) length + done else 0L
        if (total > size) return "verification_failed"
        RandomAccessFile(part, "rw").use { out ->
          if (appending) out.seek(offset) else out.setLength(0)
          val source = body.byteStream()
          val buffer = ByteArray(1 shl 16)
          while (true) {
            val read = source.read(buffer)
            if (read == -1) break
            if (done + read > size) return "verification_failed"
            out.write(buffer, 0, read)
            done += read
            val reached = done
            post {
              val entry = accepts(id, transfer) ?: return@post
              entry["bytesDone"] = reached.toDouble()
              entry["state"] = "downloading"
              entry["waiting"] = ""
              changed(id, false)
            }
            if (transfer.stopped != null) return "stopped"
          }
          // Completion may be published only after the received bytes have
          // reached the file, before its verified final rename and record.
          out.fd.sync()
        }
        // The connection closed early without an error: the rest is fetched on the next attempt.
        if (done < size) return "network"
      }
      return null
    } catch (error: IOException) {
      if (transfer.stopped != null) return "stopped"
      return when {
        error.message?.contains("ENOSPC") == true -> "storage_full"
        error is UnknownHostException || error is ConnectException || error is SocketTimeoutException || error is SocketException || error is javax.net.ssl.SSLException || error is java.io.EOFException || error is okhttp3.internal.http2.StreamResetException -> "network"
        else -> "network"
      }
    } catch (_: Exception) {
      return "transfer_failed"
    }
  }

  private fun finish(id: String, transfer: Transfer, part: File, failure: String?, digest: String) {
    val entry = accepts(id, transfer) ?: return
    active.remove(id)
    var error = failure
    if (error == null) {
      if (digest != transfer.digest || part.length() != transfer.bytes) error = "verification_failed"
    }
    if (error == "verification_failed") part.delete()
    if (error == null) {
      val final = File(directory(id), safeFileName(entry["fileName"] as? String))
      final.delete()
      if (part.renameTo(final)) {
        val size = final.length().toDouble()
        entry["state"] = "ready"; entry["error"] = ""; entry["bytes"] = size; entry["bytesDone"] = size
        entry["file"] = final.name
        entry["completedAt"] = System.currentTimeMillis().toDouble()
        // The grant address has done its job; a finished download keeps no token.
        entry.remove("grantUrl")
      } else { part.delete(); error = "storage_full" }
    }
    if (error != null) { entry["state"] = "failed"; entry["error"] = error }
    entry["waiting"] = ""
    if (!save() && entry["state"] == "ready") {
      // Keep the verified file, but refuse an offline-ready publication until
      // its completed local record has actually been committed.
      entry["state"] = "failed"; entry["error"] = "transfer_failed"
      entry.remove("completedAt")
      save()
    }
    changed(id, true)
    release()
  }

  /** Transfers in flight, for the service that keeps the process alive for them. */
  @Volatile var running = 0
    private set

  private fun release() {
    running = active.size
    if (active.isEmpty()) {
      PorticoDownloadService.done(app)
      if (!unfinished()) PorticoDownloadJob.cancel(app)
      onIdle?.invoke()
    }
  }

  private fun sha256(file: File, transfer: Transfer): String = try {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(1 shl 20)
      while (true) {
        if (transfer.stopped != null) return ""
        val read = input.read(buffer)
        if (read == -1) break
        digest.update(buffer, 0, read)
      }
    }
    PorticoRecordStore.hex(digest.digest())
  } catch (_: Exception) { "" }

  private fun safeIdentifier(value: String?): Boolean = value != null && IDENTIFIER.matches(value)

  /** A file name from the server is used as a path component: its last component, with nothing that could leave the download's own folder. */
  fun safeFileName(value: String?): String {
    val name = (value ?: "").substringAfterLast('/').replace(Regex("[/\\\\:\\u0000]"), "_")
    return if (name.isEmpty() || name.startsWith(".") || name.length > 200 || name == "partial.part") "media" else name
  }

  private const val PREFERENCES = "portico.downloads"
  /** Waits between attempts after a dropped connection, in milliseconds: about a quarter of an hour in all. */
  private val RETRY_WAITS = longArrayOf(2000, 5000, 15000, 30000, 60000, 120000, 300000, 300000)
  /** The most one extra (a poster, a subtitle track, the description) may weigh. */
  private const val MAX_EXTRA = 32L * 1024 * 1024
  private val EXTRA = Regex("^[A-Za-z0-9_-]{1,96}(\\.[a-z0-9]{1,8})?$")
  private val extras = Executors.newFixedThreadPool(2) { Thread(it, "portico-download-extras") }
  private val IDENTIFIER = Regex("^[A-Za-z0-9_-]{1,160}$")
  private val SHA256 = Regex("^[a-f0-9]{64}$")
  private val TEXT_FIELDS = listOf("itemId", "title", "subtitle", "quality", "fileName", "sha256", "contentType", "artworkUrl", "meta")
}

/**
 * Keeps the process alive while a download runs with the app out of sight. Android requires a
 * foreground service to carry a notification; it says only that a download is in progress.
 */
class PorticoDownloadService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = notification(this)
    try {
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(NOTIFICATION, notification)
    } catch (_: Exception) {
      // Not allowed to go to the foreground from here: the transfer goes on for as long as the process does.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  /**
   * Android gives a data-transfer service a daily allowance and says when it has run out. The
   * transfers stop cleanly, keeping their bytes, and the app starts them again the next time it
   * is in front, where no service is needed.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    PorticoDownloadCenter.post { PorticoDownloadCenter.interruptAll() }
    stopSelf()
  }

  companion object {
    private const val CHANNEL = "portico.downloads"
    internal const val NOTIFICATION = 4101

    /** The one quiet notification a running download carries (the service's, and a user-initiated job's). */
    internal fun notification(context: Context): Notification {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, context.getString(R.string.downloads_channel), NotificationManager.IMPORTANCE_LOW))
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(context)
      return builder.setContentTitle(context.getString(R.string.downloads_running)).setSmallIcon(android.R.drawable.stat_sys_download).setOngoing(true).build()
    }

    fun keepAlive(context: Context) {
      try {
        val intent = Intent(context, PorticoDownloadService::class.java)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      } catch (_: Exception) {}
    }

    /** Stops a moment later, and only if nothing started meanwhile: a service asked to start must reach the foreground before it may stop. */
    fun done(context: Context) {
      Handler(Looper.getMainLooper()).postDelayed({
        if (PorticoDownloadCenter.running == 0) try { context.stopService(Intent(context, PorticoDownloadService::class.java)) } catch (_: Exception) {}
      }, 1500)
    }
  }
}

/**
 * Carries unfinished downloads on while the app's process is gone (B-14.20). JobScheduler belongs
 * to the system, so the job outlives the process: when a network the download may use is there
 * (any network with "use mobile data" on, otherwise one that is not metered), the system starts
 * the process for it, the manifest is read, and each download that stopped by itself continues
 * from its bytes. The job ends when nothing is moving; it asks to run again when downloads are
 * still waiting, and when the system stops it they stop cleanly and wait for the next run.
 */
class PorticoDownloadJob : JobService() {
  @Volatile private var params: JobParameters? = null

  override fun onStartJob(params: JobParameters?): Boolean {
    this.params = params
    running = true
    // A user-initiated data transfer (Android 14 and later) shows its notification for as long as it runs.
    if (Build.VERSION.SDK_INT >= 34 && params != null && params.isUserInitiatedJob) {
      try { setNotification(params, PorticoDownloadService.NOTIFICATION, PorticoDownloadService.notification(this), JOB_END_NOTIFICATION_POLICY_REMOVE) } catch (_: Exception) {}
    }
    PorticoDownloadCenter.open(applicationContext)
    PorticoDownloadCenter.post {
      PorticoDownloadCenter.onIdle = { finish() }
      if (!PorticoDownloadCenter.resumeUnfinished()) finish()
    }
    return true
  }

  override fun onStopJob(params: JobParameters?): Boolean {
    this.params = null
    running = false
    PorticoDownloadCenter.post {
      PorticoDownloadCenter.onIdle = null
      PorticoDownloadCenter.interruptAll()
    }
    return true
  }

  /** On the bookkeeping thread: nothing is moving any more. */
  private fun finish() {
    val current = params ?: return
    params = null
    running = false
    scheduledCellular = null
    scheduledUserInitiated = false
    PorticoDownloadCenter.onIdle = null
    try { jobFinished(current, PorticoDownloadCenter.hasUnfinished()) } catch (_: Exception) {}
  }

  companion object {
    private const val JOB = 4102

    /** Whether the job is running now: scheduling it again would stop it. */
    @Volatile private var running = false
    /** The network the scheduled job waits for, so a change of "use mobile data" schedules it again. */
    @Volatile private var scheduledCellular: Boolean? = null
    /** Whether the waiting job is a user-initiated data transfer (Android 14 and later). */
    @Volatile private var scheduledUserInitiated = false

    /**
     * Asks the system to carry unfinished downloads on if the process goes, and after a restart
     * of the device (the job is persisted: RECEIVE_BOOT_COMPLETED). One job: left alone while it
     * is running or already waiting for the same kind of network (scheduling the same job again
     * would stop a running one). `userInitiated`: the person started a download with the app in
     * front, so on Android 14 and later it becomes a user-initiated data transfer, which runs as
     * long as the transfer needs instead of in ten-minute turns. Where the system refuses that,
     * the ordinary job is scheduled.
     */
    fun schedule(context: Context, cellular: Boolean, userInitiated: Boolean = false) {
      val wantsUser = userInitiated && Build.VERSION.SDK_INT >= 34
      try {
        val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        if (running || (scheduler.getPendingJob(JOB) != null && scheduledCellular == cellular && (!wantsUser || scheduledUserInitiated))) return
        if (wantsUser && submit(scheduler, context, cellular, true)) return
        submit(scheduler, context, cellular, false)
      } catch (_: Exception) {}
    }

    private fun submit(scheduler: JobScheduler, context: Context, cellular: Boolean, user: Boolean): Boolean = try {
      val builder = JobInfo.Builder(JOB, ComponentName(context, PorticoDownloadJob::class.java))
          .setRequiredNetworkType(if (cellular) JobInfo.NETWORK_TYPE_ANY else JobInfo.NETWORK_TYPE_UNMETERED)
          .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
          .setPersisted(true)
      if (user && Build.VERSION.SDK_INT >= 34) builder.setUserInitiated(true)
      val ok = scheduler.schedule(builder.build()) == JobScheduler.RESULT_SUCCESS
      if (ok) { scheduledCellular = cellular; scheduledUserInitiated = user }
      ok
    } catch (_: Exception) { false }

    fun cancel(context: Context) {
      if (running) return
      scheduledCellular = null
      scheduledUserInitiated = false
      try { (context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler).cancel(JOB) } catch (_: Exception) {}
    }
  }
}

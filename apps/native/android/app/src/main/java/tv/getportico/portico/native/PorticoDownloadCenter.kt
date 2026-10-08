package tv.getportico.portico.native

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
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
 * The server prepares a file and hands out a short-lived address for it; this moves the bytes and
 * keeps them. A transfer belongs to the process, not to the React instance, and a foreground
 * service keeps the process alive while one runs, so it goes on with the app out of sight. A
 * finished file is checked against the server's SHA-256 before it is called ready: a truncated or
 * substituted file is deleted, never played. Files live in the app's no-backup storage (they are
 * re-downloadable and can be tens of gigabytes).
 *
 * This knows nothing about accounts, receipts or what may be played; that is decided in JavaScript
 * from the server's signed receipt.
 */
internal object PorticoDownloadCenter {
  /** An entry changed (or was removed: `{id, state: "removed"}`). Called on the bookkeeping thread. */
  var onChanged: ((Map<String, Any?>) -> Unit)? = null

  private class Transfer(val attempt: Double, @Volatile var call: Call? = null, @Volatile var stopped: String? = null)

  private val work = Executors.newSingleThreadExecutor { Thread(it, "portico-downloads") }
  private val transfers = Executors.newFixedThreadPool(2) { Thread(it, "portico-download-transfer") }
  private val entries = HashMap<String, MutableMap<String, Any?>>()
  private val active = HashMap<String, Transfer>()
  private val lastEmit = HashMap<String, Long>()
  private var attempts = 0.0
  private var cellular = false
  private lateinit var app: Context
  private var loaded = false
  private val http: OkHttpClient by lazy {
    OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).cache(null)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
  }

  /** Everything that touches the entries runs on one thread. */
  fun post(block: () -> Unit) { work.execute(block) }

  /** Reads the manifest once. A transfer the last process left running is shown as paused. */
  fun open(context: Context) {
    if (loaded) return
    loaded = true
    app = context.applicationContext
    cellular = app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean("cellular", false)
    root().listFiles()?.forEach { if (it.name.endsWith(".incoming")) it.delete() }
    @Suppress("UNCHECKED_CAST") val stored = try { PorticoListeningOwner.parse(File(root(), "manifest.json").readBytes()) as? Map<String, Any?> } catch (_: Exception) { null }
    stored?.forEach { (key, value) ->
      @Suppress("UNCHECKED_CAST") val entry = value as? Map<String, Any?> ?: return@forEach
      if (!safeIdentifier(key)) return@forEach
      val copy = HashMap(entry)
      if (copy["state"] == "downloading") { copy["state"] = "paused"; copy["error"] = "" }
      entries[key] = copy
    }
    try {
      (app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
        // "Never use mobile data" means now: a transfer in flight is suspended, keeping its bytes.
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = post { if (!cellular && onCellular()) pauseAll() }
      })
    } catch (_: Exception) {}
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
    onChanged?.invoke(entries[id]?.let { HashMap(it) } ?: mapOf("id" to id, "state" to "removed"))
  }

  private fun onCellular(): Boolean {
    val manager = app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
    return manager.getNetworkCapabilities(manager.activeNetwork ?: return false)?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
  }

  // --- the JavaScript interface (all on the bookkeeping thread) --------------------------------

  fun list(): List<Map<String, Any?>> = entries.values.map { HashMap(it) }

  /** The entry as it stands once the transfer has begun, or null for an invalid request. */
  fun start(request: Map<String, Any?>): Map<String, Any?>? {
    val id = request["id"] as? String
    val url = request["url"] as? String
    if (!safeIdentifier(id) || url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return null
    id!!
    val entry = entries[id] ?: HashMap()
    if (entry["state"] == "ready") return HashMap(entry)
    // Continue and retry both arrive here: an earlier transfer for the same download ends first.
    active.remove(id)?.let { it.stopped = "superseded"; it.call?.cancel() }
    for (key in TEXT_FIELDS) (request[key] as? String)?.let { entry[key] = it }
    entry["id"] = id
    entry["bytes"] = (request["bytes"] as? Number)?.toDouble() ?: 0.0
    entry["bytesDone"] = 0.0
    entry["state"] = "downloading"
    entry["error"] = ""
    if (entry["addedAt"] == null) entry["addedAt"] = System.currentTimeMillis().toDouble()
    // What is already on the device is only continued under the grant it was fetched with: a new
    // grant is a new address, and the old bytes cannot be vouched for by it.
    if (entry["grantUrl"] != url) partial(id).delete()
    entry["grantUrl"] = url
    val transfer = Transfer(++attempts)
    entry["taskIdentifier"] = transfer.attempt
    entries[id] = entry
    active[id] = transfer
    save()
    changed(id, true)
    if (!cellular && onCellular()) { suspend(id, transfer); return HashMap(entry) }
    running = active.size
    PorticoDownloadService.keepAlive(app)
    transfers.execute { transfer(id, url, transfer) }
    return HashMap(entry)
  }

  private fun accepts(id: String, transfer: Transfer): MutableMap<String, Any?>? {
    val entry = entries[id] ?: return null
    return if (entry["state"] != "ready" && entry["taskIdentifier"] == transfer.attempt && active[id] === transfer) entry else null
  }

  private fun suspend(id: String, transfer: Transfer) {
    transfer.stopped = "paused"
    transfer.call?.cancel()
    val entry = accepts(id, transfer) ?: return
    active.remove(id)
    entry["state"] = "paused"
    entry["error"] = ""
    save()
    changed(id, true)
    release()
  }

  private fun pauseAll() { for ((id, transfer) in active.toList()) suspend(id, transfer) }

  fun pause(id: String?) { active[id ?: return]?.let { suspend(id, it) } }

  fun remove(id: String?): Boolean {
    if (!safeIdentifier(id)) return false
    id!!
    active.remove(id)?.let { it.stopped = "removed"; it.call?.cancel() }
    entries.remove(id)
    directory(id).deleteRecursively()
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

  fun storage(): Map<String, Any?> {
    var used = 0.0
    for (entry in entries.values) if (entry["state"] == "ready") used += (entry["bytes"] as? Number)?.toDouble() ?: 0.0
    return mapOf("freeBytes" to root().usableSpace.toDouble(), "usedBytes" to used)
  }

  fun setCellular(allowed: Boolean) {
    app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putBoolean("cellular", allowed).apply()
    val tightened = cellular && !allowed
    cellular = allowed
    if (tightened && onCellular()) pauseAll()
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

  fun durationSeconds(file: File): Double = try {
    val reader = MediaMetadataRetriever()
    try { reader.setDataSource(file.path); (reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0) / 1000.0 } finally { reader.release() }
  } catch (_: Exception) { 0.0 }

  // --- the transfer --------------------------------------------------------------------------

  private fun transfer(id: String, url: String, transfer: Transfer) {
    val part = partial(id)
    var failure: String? = null
    try {
      directory(id).mkdirs()
      val offset = if (part.isFile) part.length() else 0L
      val request = Request.Builder().url(url)
      if (offset > 0) request.header("Range", "bytes=$offset-")
      val call = http.newCall(request.build())
      transfer.call = call
      if (transfer.stopped != null) return
      call.execute().use { response ->
        val status = response.code
        if (status !in 200..299) { failure = if (status == 401 || status == 403 || status == 404 || status == 410) "grant_expired" else "server_refused"; return@use }
        val appending = status == 206 && offset > 0
        val body = response.body
        if (body == null) { failure = "transfer_failed"; return@use }
        val length = body.contentLength()
        var done = if (appending) offset else 0L
        val total = if (length > 0) length + done else 0L
        RandomAccessFile(part, "rw").use { out ->
          if (appending) out.seek(offset) else out.setLength(0)
          val source = body.byteStream()
          val buffer = ByteArray(1 shl 16)
          while (true) {
            val read = source.read(buffer)
            if (read == -1) break
            out.write(buffer, 0, read)
            done += read
            val reached = done
            post {
              val entry = accepts(id, transfer) ?: return@post
              entry["bytesDone"] = reached.toDouble()
              if (total > 0) entry["bytes"] = total.toDouble()
              entry["state"] = "downloading"
              changed(id, false)
            }
            if (transfer.stopped != null) return
          }
        }
      }
    } catch (error: IOException) {
      if (transfer.stopped != null) return
      failure = when {
        error is UnknownHostException || error is ConnectException || error is SocketTimeoutException || error is SocketException -> "network"
        error.message?.contains("ENOSPC") == true -> "storage_full"
        else -> "transfer_failed"
      }
    } catch (_: Exception) {
      failure = "transfer_failed"
    }
    if (transfer.stopped != null) return
    val digest = if (failure == null) sha256(part) else ""
    post { finish(id, transfer, part, failure, digest) }
  }

  private fun finish(id: String, transfer: Transfer, part: File, failure: String?, digest: String) {
    val entry = accepts(id, transfer) ?: return
    active.remove(id)
    var error = failure
    if (error == null) {
      val expected = (entry["sha256"] as? String)?.lowercase() ?: ""
      if (expected.isNotEmpty() && digest != expected) { part.delete(); error = "verification_failed" }
    }
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
    save()
    changed(id, true)
    release()
  }

  /** Transfers in flight, for the service that keeps the process alive for them. */
  @Volatile var running = 0
    private set

  private fun release() { running = active.size; if (active.isEmpty()) PorticoDownloadService.done(app) }

  private fun sha256(file: File): String = try {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(1 shl 20)
      while (true) { val read = input.read(buffer); if (read == -1) break; digest.update(buffer, 0, read) }
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
  private val IDENTIFIER = Regex("^[A-Za-z0-9_-]{1,160}$")
  private val TEXT_FIELDS = listOf("itemId", "title", "subtitle", "quality", "fileName", "sha256", "contentType", "artworkUrl", "meta")
}

/**
 * Keeps the process alive while a download runs with the app out of sight. Android requires a
 * foreground service to carry a notification; it says only that a download is in progress.
 */
class PorticoDownloadService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.downloads_channel), NotificationManager.IMPORTANCE_LOW))
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
    val notification = builder.setContentTitle(getString(R.string.downloads_running)).setSmallIcon(android.R.drawable.stat_sys_download).setOngoing(true).build()
    try {
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(NOTIFICATION, notification)
    } catch (_: Exception) {
      // Not allowed to go to the foreground from here: the transfer goes on for as long as the process does.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  companion object {
    private const val CHANNEL = "portico.downloads"
    private const val NOTIFICATION = 4101

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

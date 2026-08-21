package tv.getportico.player

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.module.annotations.ReactModule
import java.nio.charset.StandardCharsets
import java.util.Locale

@ReactModule(name = PorticoNearbyDevicesModule.NAME)
internal class PorticoNearbyDevicesModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {
  private val handler = Handler(Looper.getMainLooper())
  private val nsdManager = reactContext.getSystemService(Context.NSD_SERVICE) as? NsdManager
  private val connectivityManager =
    reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
  private val discoveryListeners = mutableMapOf<String, NsdManager.DiscoveryListener>()
  private val requestedTypes = linkedSetOf<String>()
  private val resolving = mutableMapOf<String, Long>()
  private val resolveTimeouts = mutableMapOf<String, Runnable>()
  private val emitted = mutableMapOf<String, String>()
  private var browseEpoch = 0L
  private var connectivityEpoch = 0L
  private var connectivityCallback: ConnectivityManager.NetworkCallback? = null
  private var activeNetwork: Network? = null
  private var networkAvailable = false
  private var networkRecoveryRunnable: Runnable? = null
  private var hostResumed = true
  private var destroyed = false

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun startBrowsing(serviceTypes: ReadableArray, promise: Promise) {
    if (destroyed) {
      promise.reject("PORTICO_ANDROID_NSD_UNAVAILABLE", "Android network service discovery is unavailable.")
      return
    }
    val types = linkedSetOf<String>()
    for (index in 0 until serviceTypes.size()) {
      val type = normalizeServiceType(serviceTypes.getString(index))
      if (type != null) types.add(type)
    }
    if (types.isEmpty()) {
      promise.reject("PORTICO_ANDROID_NSD_INVALID_SERVICE", "No supported Android NSD service type was requested.")
      return
    }
    requestedTypes.clear()
    requestedTypes.addAll(types)
    if (!hostResumed) {
      promise.resolve(null)
      return
    }
    try {
      restartBrowsing()
      promise.resolve(null)
    } catch (_: Throwable) {
      requestedTypes.clear()
      stopBrowsingInternal()
      promise.reject(
        "PORTICO_ANDROID_NSD_UNAVAILABLE",
        "Android network service discovery is unavailable.",
      )
    }
  }

  @ReactMethod
  fun stopBrowsing(promise: Promise) {
    requestedTypes.clear()
    stopBrowsingInternal()
    promise.resolve(null)
  }

  @ReactMethod
  fun startAdvertisingSetup(instanceName: String, txt: ReadableMap, promise: Promise) {
    rejectAdvertising(promise)
  }

  @ReactMethod
  fun stopAdvertisingSetup(promise: Promise) {
    promise.resolve(null)
  }

  @ReactMethod
  fun startAdvertisingReceiver(instanceName: String, port: Int, txt: ReadableMap, promise: Promise) {
    rejectAdvertising(promise)
  }

  @ReactMethod
  fun stopAdvertisingReceiver(promise: Promise) {
    promise.resolve(null)
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // React Native requires these methods for NativeEventEmitter. Native discovery
    // itself is controlled by the explicit start/stop boundary above.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // See addListener.
  }

  @ReactMethod
  fun logDiagnostic(stage: String, details: ReadableMap) {
    // Deliberately do not log TXT values or any caller-provided data.
  }

  override fun onHostResume() {
    if (destroyed) return
    hostResumed = true
    if (requestedTypes.isNotEmpty()) {
      try {
        restartBrowsing()
      } catch (_: Throwable) {
        stopBrowsingInternal()
        emitError("PORTICO_ANDROID_NSD_UNAVAILABLE")
      }
    }
  }

  override fun onHostPause() {
    hostResumed = false
    stopBrowsingInternal()
  }

  override fun onHostDestroy() {
    destroyed = true
    hostResumed = false
    requestedTypes.clear()
    stopBrowsingInternal()
  }

  override fun onCatalystInstanceDestroy() {
    destroyed = true
    hostResumed = false
    requestedTypes.clear()
    stopBrowsingInternal()
    reactApplicationContext.removeLifecycleEventListener(this)
    super.onCatalystInstanceDestroy()
  }

  private fun restartBrowsing() {
    stopDiscoveryInternal()
    if (destroyed || !hostResumed || requestedTypes.isEmpty()) return
    val manager = nsdManager ?: throw IllegalStateException("NSD unavailable")
    ensureConnectivityCallback()
    if (!networkAvailable) {
      emitError("PORTICO_ANDROID_NSD_NETWORK_UNAVAILABLE")
      return
    }
    val epoch = browseEpoch
    try {
      requestedTypes.forEach { serviceType ->
        val listener = discoveryListener(serviceType, epoch)
        discoveryListeners[serviceType] = listener
        manager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
      }
    } catch (error: Throwable) {
      stopDiscoveryInternal()
      throw error
    }
  }

  private fun ensureConnectivityCallback() {
    if (connectivityCallback != null) return
    val manager = connectivityManager ?: throw IllegalStateException("Connectivity unavailable")
    val callbackEpoch = connectivityEpoch + 1
    connectivityEpoch = callbackEpoch
    activeNetwork = manager.activeNetwork
    networkAvailable = activeNetwork != null
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        handler.post {
          if (!isActiveConnectivityCallback(callbackEpoch)) return@post
          val wasAvailable = networkAvailable
          val changedNetwork = activeNetwork != null && activeNetwork != network
          activeNetwork = network
          networkAvailable = true
          if (!wasAvailable || changedNetwork) {
            scheduleNetworkRecovery(callbackEpoch)
          }
        }
      }

      override fun onLost(network: Network) {
        handler.post {
          if (!isActiveConnectivityCallback(callbackEpoch) || activeNetwork != network) return@post
          activeNetwork = null
          networkAvailable = false
          stopDiscoveryInternal()
          emitError("PORTICO_ANDROID_NSD_NETWORK_UNAVAILABLE")
        }
      }
    }
    connectivityCallback = callback
    try {
      manager.registerDefaultNetworkCallback(callback)
    } catch (error: Throwable) {
      connectivityCallback = null
      connectivityEpoch += 1
      activeNetwork = null
      networkAvailable = false
      throw error
    }
  }

  private fun scheduleNetworkRecovery(callbackEpoch: Long) {
    if (!isActiveConnectivityCallback(callbackEpoch)) return
    networkRecoveryRunnable?.let { handler.removeCallbacks(it) }
    val recovery = Runnable {
      networkRecoveryRunnable = null
      if (!isActiveConnectivityCallback(callbackEpoch) || !networkAvailable) return@Runnable
      try {
        restartBrowsing()
      } catch (_: Throwable) {
        stopDiscoveryInternal()
        emitError("PORTICO_ANDROID_NSD_UNAVAILABLE")
      }
    }
    networkRecoveryRunnable = recovery
    handler.postDelayed(recovery, NETWORK_RECOVERY_DEBOUNCE_MS)
  }

  private fun isActiveConnectivityCallback(callbackEpoch: Long): Boolean {
    return !destroyed && hostResumed && requestedTypes.isNotEmpty() &&
      callbackEpoch == connectivityEpoch && connectivityCallback != null
  }

  private fun unregisterConnectivityCallback() {
    networkRecoveryRunnable?.let { handler.removeCallbacks(it) }
    networkRecoveryRunnable = null
    val callback = connectivityCallback
    connectivityCallback = null
    connectivityEpoch += 1
    activeNetwork = null
    networkAvailable = false
    if (callback != null) {
      try {
        connectivityManager?.unregisterNetworkCallback(callback)
      } catch (_: Throwable) {
        // The callback may already have been unregistered by the platform.
      }
    }
  }

  private fun stopDiscoveryInternal() {
    browseEpoch += 1
    networkRecoveryRunnable?.let { handler.removeCallbacks(it) }
    networkRecoveryRunnable = null
    val manager = nsdManager
    discoveryListeners.values.toList().forEach { listener ->
      try {
        manager?.stopServiceDiscovery(listener)
      } catch (_: Throwable) {
        // Discovery may already have failed or stopped.
      }
    }
    discoveryListeners.clear()
    resolveTimeouts.values.toList().forEach { handler.removeCallbacks(it) }
    resolveTimeouts.clear()
    resolving.clear()
    emitted.clear()
  }

  private fun stopBrowsingInternal() {
    stopDiscoveryInternal()
    unregisterConnectivityCallback()
  }

  private fun isActiveBrowseEpoch(epoch: Long): Boolean {
    return !destroyed && hostResumed && requestedTypes.isNotEmpty() && epoch == browseEpoch
  }

  private fun isActiveDiscovery(
    epoch: Long,
    serviceType: String,
    listener: NsdManager.DiscoveryListener,
  ): Boolean {
    return isActiveBrowseEpoch(epoch) && requestedTypes.contains(serviceType) &&
      discoveryListeners[serviceType] === listener
  }

  private fun isActiveResolve(key: String, epoch: Long): Boolean {
    return isActiveBrowseEpoch(epoch) && resolving[key] == epoch
  }

  private fun finishResolve(key: String, epoch: Long) {
    if (resolving[key] != epoch) return
    resolving.remove(key)
    resolveTimeouts.remove(key)?.let { handler.removeCallbacks(it) }
  }

  private fun discoveryListener(serviceType: String, epoch: Long): NsdManager.DiscoveryListener {
    return object : NsdManager.DiscoveryListener {
      override fun onStartDiscoveryFailed(callbackServiceType: String, errorCode: Int) {
        if (normalizeServiceType(callbackServiceType) != serviceType) return
        if (!isActiveDiscovery(epoch, serviceType, this)) return
        discoveryListeners.remove(serviceType)
        emitError("PORTICO_ANDROID_NSD_DISCOVERY_FAILED", epoch)
      }

      override fun onStopDiscoveryFailed(callbackServiceType: String, errorCode: Int) {
        if (normalizeServiceType(callbackServiceType) != serviceType) return
        if (!isActiveDiscovery(epoch, serviceType, this)) return
        discoveryListeners.remove(serviceType)
        emitError("PORTICO_ANDROID_NSD_DISCOVERY_FAILED", epoch)
      }

      override fun onDiscoveryStarted(callbackServiceType: String) {
        if (normalizeServiceType(callbackServiceType) != serviceType) return
        if (!isActiveDiscovery(epoch, serviceType, this)) return
      }

      override fun onDiscoveryStopped(callbackServiceType: String) {
        if (normalizeServiceType(callbackServiceType) != serviceType) return
        if (!isActiveDiscovery(epoch, serviceType, this)) return
        discoveryListeners.remove(serviceType)
      }

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        if (!isActiveDiscovery(epoch, serviceType, this)) return
        val foundType = normalizeServiceType(serviceInfo.serviceType) ?: return
        if (foundType != serviceType) return
        val instance = safeText(serviceInfo.serviceName, MAX_INSTANCE_LENGTH) ?: return
        val key = foundType + "|" + instance
        if (resolving.containsKey(key)) return
        val manager = nsdManager
        if (manager == null) {
          emitError("PORTICO_ANDROID_NSD_UNAVAILABLE", epoch)
          return
        }
        resolving[key] = epoch
        val timeout = Runnable {
          if (isActiveResolve(key, epoch)) finishResolve(key, epoch)
        }
        resolveTimeouts[key] = timeout
        handler.postDelayed(timeout, RESOLVE_TIMEOUT_MS)
        try {
          manager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
              if (!isActiveResolve(key, epoch)) return
              finishResolve(key, epoch)
            }

            override fun onServiceResolved(resolved: NsdServiceInfo) {
              if (!isActiveResolve(key, epoch)) return
              finishResolve(key, epoch)
              emitResolved(resolved, foundType, key, epoch)
            }
          })
        } catch (_: Throwable) {
          finishResolve(key, epoch)
        }
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo) {
        if (!isActiveDiscovery(epoch, serviceType, this)) return
        val foundType = normalizeServiceType(serviceInfo.serviceType) ?: return
        if (foundType != serviceType) return
        val instance = safeText(serviceInfo.serviceName, MAX_INSTANCE_LENGTH) ?: return
        val key = foundType + "|" + instance
        emitted.remove(key)
        emitDevice(
          mapOf(
            "action" to "removed",
            "serviceType" to foundType,
            "instanceName" to instance,
          ),
          epoch,
        )
      }
    }
  }

  private fun emitResolved(serviceInfo: NsdServiceInfo, serviceType: String, key: String, epoch: Long) {
    if (!isActiveBrowseEpoch(epoch)) return
    val instance = safeText(serviceInfo.serviceName, MAX_INSTANCE_LENGTH) ?: return
    val port = serviceInfo.port
    if (port !in 1..65535) return
    val txt = safeTxt(serviceType, serviceInfo.attributes) ?: return
    val host = serviceInfo.host ?: return
    val hostName = safeText(host.hostName, MAX_HOST_LENGTH) ?: return
    val addresses = listOfNotNull(safeText(host.hostAddress, MAX_HOST_LENGTH))
    val fingerprint = serviceType + "|" + instance + "|" + hostName + "|" + port + "|" + txt.entries
      .sortedBy { it.key }
      .joinToString("&") { entry -> entry.key + "=" + entry.value }
    if (emitted[key] == fingerprint) return
    if (!isActiveBrowseEpoch(epoch)) return
    emitted[key] = fingerprint
    emitDevice(
      mapOf(
        "action" to "found",
        "serviceType" to serviceType,
        "instanceName" to instance,
        "txt" to txt,
        "hostName" to hostName,
        "port" to port,
        "addresses" to addresses,
      ),
      epoch,
    )
  }

  private fun safeTxt(
    serviceType: String,
    attributes: Map<String, ByteArray>,
  ): Map<String, String>? {
    val allowed = allowedTxtKeys(serviceType)
    val result = linkedMapOf<String, String>()
    attributes.forEach { (rawKey, rawValue) ->
      val key = rawKey.trim().lowercase(Locale.US)
      if (key !in allowed || isCredentialKey(key) || key.length > MAX_KEY_LENGTH) return@forEach
      val value = String(rawValue, StandardCharsets.UTF_8)
      if (value.length > MAX_VALUE_LENGTH || value.any { it == '\u0000' || it == '\r' || it == '\n' }) return@forEach
      result[key] = value
    }
    return result
  }

  private fun emitError(code: String, epoch: Long? = null) {
    emitDevice(
      mapOf(
        "action" to "error",
        "errorCode" to code,
      ),
      epoch,
    )
  }

  private fun emitDevice(values: Map<String, Any?>, epoch: Long? = null) {
    if (destroyed || !hostResumed || requestedTypes.isEmpty()) return
    if (epoch != null && epoch != browseEpoch) return
    val map = Arguments.makeNativeMap(values)
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_NAME, map)
  }

  private fun rejectAdvertising(promise: Promise) {
    promise.reject(
      "PORTICO_ANDROID_ADVERTISING_UNAVAILABLE",
      "Android Portico service advertising is unavailable in this build.",
    )
  }

  private fun normalizeServiceType(value: String?): String? {
    val normalized = value?.trim()?.lowercase(Locale.US)?.removeSuffix(".") ?: return null
    return if (normalized in SUPPORTED_SERVICE_TYPES) normalized else null
  }

  private fun safeText(value: String?, limit: Int): String? {
    val text = value?.trim() ?: return null
    if (text.isEmpty() || text.length > limit || text.any { it == '\u0000' || it == '\r' || it == '\n' }) return null
    return text
  }

  private fun allowedTxtKeys(serviceType: String): Set<String> {
    return when (serviceType) {
      SERVER_SERVICE -> setOf("txtversion", "scheme", "path", "fingerprint", "serverid", "name")
      SETUP_SERVICE -> setOf("txtversion", "setupid", "code", "publickey", "name", "platform", "appversion", "expiresat")
      RECEIVER_SERVICE -> setOf("txtversion", "receiverid", "serverid", "keyfingerprint", "name", "platform", "appversion", "capabilities", "expiresat")
      else -> emptySet()
    }
  }

  private fun isCredentialKey(key: String): Boolean {
    return CREDENTIAL_KEY_PARTS.any { key.contains(it) }
  }

  companion object {
    const val NAME = "PorticoNearbyDevices"
    private const val EVENT_NAME = "PorticoNearbyDeviceChanged"
    private const val SERVER_SERVICE = "_portico._tcp"
    private const val SETUP_SERVICE = "_portico-setup._tcp"
    private const val RECEIVER_SERVICE = "_portico-receiver._tcp"
    private const val MAX_INSTANCE_LENGTH = 256
    private const val MAX_HOST_LENGTH = 256
    private const val MAX_KEY_LENGTH = 64
    private const val MAX_VALUE_LENGTH = 512
    private const val RESOLVE_TIMEOUT_MS = 3000L
    private const val NETWORK_RECOVERY_DEBOUNCE_MS = 250L
    private val SUPPORTED_SERVICE_TYPES = setOf(SERVER_SERVICE, SETUP_SERVICE, RECEIVER_SERVICE)
    private val CREDENTIAL_KEY_PARTS = setOf(
      "token",
      "secret",
      "password",
      "credential",
      "authorization",
      "grant",
      "access",
      "refresh",
      "poll",
    )
  }
}

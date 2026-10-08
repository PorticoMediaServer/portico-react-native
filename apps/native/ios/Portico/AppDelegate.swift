import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import GoogleCast

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  /// SEC-22: one allowlist (`PorticoURLRoutes`, shared with tvOS) for every URL handed to
  /// React Native, whether the app was running or not.
  func application(_ app: UIApplication, open url: URL,
                   options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    guard PorticoURLRoutes.allows(url) else { return false }
    return RCTLinkingManager.application(app, open: url, options: options)
  }

  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // PERF-03: artwork responses revalidate (ETag) instead of re-downloading on every remount;
    // React Native's image loader uses the shared URL cache. tvOS may purge Caches; that's fine.
    URLCache.shared = URLCache(memoryCapacity: 32 << 20, diskCapacity: 256 << 20)

    // IOS-PLAYER-03: Google Cast, only when this build names Portico's receiver application
    // (PORTICO_CAST_APPLICATION_ID). Without one the app offers no Cast row at all.
    if let castApp = Bundle.main.object(forInfoDictionaryKey: "PorticoCastApplicationID") as? String,
       !castApp.isEmpty, !castApp.hasPrefix("$(") {
      let options = GCKCastOptions(discoveryCriteria: GCKDiscoveryCriteria(applicationID: castApp))
      options.physicalVolumeButtonsWillControlDeviceVolume = true
      options.stopReceiverApplicationWhenEndingSession = false
      GCKCastContext.setSharedInstanceWith(options)
    }

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)
    launchedAt = Date()
    PorticoLink.launchedAt = launchedAt

    // SEC-22: a cold launch's URL reaches JavaScript through `getInitialURL()`, which reads these
    // options. Drop anything the allowlist refuses before React Native can see it.
    var options = launchOptions
    if let url = options?[.url] as? URL, !PorticoURLRoutes.allows(url) { options?.removeValue(forKey: .url) }

    factory.startReactNative(
      withModuleName: "Portico",
      in: window,
      launchOptions: options
    )

    return true
  }

  // MARK: Background downloads

  /// A download finished while Portico was suspended or not running: iOS relaunches the app in the
  /// background and waits for this handler to be called once the downloads session has delivered
  /// its events (PorticoDownloads calls it).
  func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                   completionHandler: @escaping () -> Void) {
    PorticoBackgroundEvents.completions[identifier] = completionHandler
  }

  /// When the app launched (PorticoLink uses it to tell a cold-launch link from a later one).
  private var launchedAt = Date()

  // MARK: Universal links, Handoff and Spotlight (OS-08, D-MAIL-2)

  /// A universal link (web.getportico.tv/account…, /device, /join/…), a title handed off from
  /// another device, or a Spotlight result. Each becomes one allowlisted `portico://` route;
  /// anything else is refused (a universal link then opens in Safari).
  func application(_ application: UIApplication, continue userActivity: NSUserActivity,
                   restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    guard let route = PorticoURLRoutes.route(activityType: userActivity.activityType,
                                             userInfo: userActivity.userInfo,
                                             webpageURL: userActivity.webpageURL) else {
      if userActivity.activityType == NSUserActivityTypeBrowsingWeb, let web = userActivity.webpageURL, web.scheme == "https" {
        UIApplication.shared.open(web, options: [:], completionHandler: nil)
        return true
      }
      return false
    }
    PorticoLink.open(route)
    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    if let path = ProcessInfo.processInfo.environment["PORTICO_TEST_BUNDLE_PATH"], !path.isEmpty { return URL(fileURLWithPath: path) }
    if let packaged = Bundle.main.url(forResource: "main", withExtension: "jsbundle") { return packaged }
    RCTBundleURLProvider.sharedSettings().jsLocation = "127.0.0.1:19424"
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

/// Holds the system's completion handlers for background URL sessions until the owning session
/// has delivered its events.
@objc(PorticoBackgroundEvents) final class PorticoBackgroundEvents: NSObject {
  static var completions: [String: () -> Void] = [:]
  @objc static func finish(_ identifier: String) {
    DispatchQueue.main.async { completions.removeValue(forKey: identifier)?() }
  }
}

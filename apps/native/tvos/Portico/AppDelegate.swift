import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  /// The allowlist lives in `PorticoURLRoutes` so its grammar can be compiled
  /// and tested without UIKit. Anything it refuses is not forwarded.
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
    URLCache.shared = URLCache(memoryCapacity: 32 << 20, diskCapacity: 128 << 20)

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

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

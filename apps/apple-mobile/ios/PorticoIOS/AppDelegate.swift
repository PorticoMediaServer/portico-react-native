import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import GoogleCast
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  private var backgroundSessionCompletions: [String: [() -> Void]] = [:]
  private var backgroundSessionWatchdogs: [String: DispatchWorkItem] = [:]
  private var backgroundSessionsFinishedBeforeHandler = Set<String>()
  private static let backgroundDownloadManagerClassName = "PorticoDownloadManager"
  private static let backgroundDownloadSessionIdentifier = "tv.getportico.ios.offline-downloads"
  private static let backgroundSessionWatchdogSeconds: TimeInterval = 10
  private static let notificationLinkMaximumLength = 2_048
  private static let notificationIdentifierMaximumLength = 128
  private static let notificationUniversalLinkHost = "app.getportico.tv"

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  // Keep the legacy app-delegate window accessor available to system and
  // SDK integrations while the app itself uses scene-based ownership.
  weak var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let configuredReceiverID = Bundle.main.object(
      forInfoDictionaryKey: "PorticoGoogleCastReceiverApplicationID"
    ) as? String
    let receiverID = configuredReceiverID?.trimmingCharacters(in: .whitespacesAndNewlines)
    // Custom Receiver configuration is required. Never fall back to Google's
    // Default Media Receiver: it cannot redeem Portico's receiver-bound
    // envelope or attach PorticoMedia headers.
    if let receiverID, !receiverID.isEmpty, !receiverID.hasPrefix("$(") {
      let criteria = GCKDiscoveryCriteria(applicationID: receiverID)
      let castOptions = GCKCastOptions(discoveryCriteria: criteria)
      castOptions.startDiscoveryAfterFirstTapOnCastButton = true
      GCKCastContext.setSharedInstanceWith(castOptions)
    }
    let notificationCenter = UNUserNotificationCenter.current()
    notificationCenter.delegate = self

    NotificationCenter.default.addObserver(
      forName: Notification.Name("PorticoBackgroundDownloadEventsFinished"),
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let identifier = notification.userInfo?["identifier"] as? String else { return }
      self?.completeBackgroundSession(identifier: identifier)
    }
    ensureBackgroundDownloadSession()
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    return true
  }

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "Default Configuration",
      sessionRole: connectingSceneSession.role
    )
    configuration.delegateClass = SceneDelegate.self
    return configuration
  }

  func application(_ application: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    RCTLinkingManager.application(application, open: url, options: options)
  }

  func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
  }

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    PorticoPushNotifications.publish(deviceToken: deviceToken)
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    PorticoPushNotifications.registrationFailed()
  }

  func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    guard
      let portico = userInfo["portico"] as? [String: Any],
      portico["kind"] as? String == "notifications_changed"
    else {
      completionHandler(.noData)
      return
    }
    PorticoPushNotifications.publishNotificationWake()
    completionHandler(.newData)
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .badge, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    let payload = response.notification.request.content.userInfo
    if let url = Self.reviewedNotificationTarget(in: payload) {
      _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
    }
    completionHandler()
  }

  /// Notification payloads are untrusted input. Only Portico routes already
  /// understood by the JS router, or a strict subset of the portable
  /// notification-action contract, may cross the native linking boundary.
  private static func reviewedNotificationTarget(in payload: [AnyHashable: Any]) -> URL? {
    if
      let portico = payload["portico"] as? [String: Any],
      let action = portico["action"] as? [String: Any],
      let target = reviewedStructuredNotificationAction(action)
    {
      return target
    }

    let candidates: [Any?] = [
      (payload["portico"] as? [String: Any])?["deepLink"],
      payload["deepLink"],
      payload["url"],
    ]
    for candidate in candidates {
      guard let value = candidate as? String else { continue }
      if let reviewed = reviewedPorticoNotificationURL(value) { return reviewed }
    }
    return nil
  }

  private static func reviewedStructuredNotificationAction(_ action: [String: Any]) -> URL? {
    guard
      Set(action.keys).isSubset(of: ["id", "labelMessageId", "kind", "target", "parameters"]),
      action["kind"] as? String == "navigate",
      let target = action["target"] as? String,
      target.count <= notificationIdentifierMaximumLength,
      let parameters = action["parameters"] as? [String: Any],
      parameters.count <= 12,
      parameters.values.allSatisfy({ value in
        guard let value = value as? String else { return false }
        return value.count <= notificationIdentifierMaximumLength
      })
    else { return nil }

    switch target {
    case "media.detail":
      guard Set(parameters.keys) == ["mediaId"], let mediaID = reviewedNotificationIdentifier(parameters["mediaId"]) else { return nil }
      return porticoURL(route: "media", identifier: mediaID)
    case "notifications":
      guard parameters.isEmpty else { return nil }
      return porticoURL(route: "notifications")
    case "downloads":
      guard Set(parameters.keys).isSubset(of: ["downloadId"]) else { return nil }
      if let value = parameters["downloadId"], reviewedNotificationIdentifier(value) == nil { return nil }
      return porticoURL(route: "downloads")
    case "dvr.conflicts":
      guard Set(parameters.keys).isSubset(of: ["recordingId"]) else { return nil }
      if let value = parameters["recordingId"], reviewedNotificationIdentifier(value) == nil { return nil }
      return porticoURL(route: "channels")
    case "account.security":
      guard parameters.isEmpty else { return nil }
      return porticoURL(route: "settings")
    default:
      return nil
    }
  }

  private static func reviewedPorticoNotificationURL(_ value: String) -> URL? {
    guard
      !value.isEmpty,
      value.count <= notificationLinkMaximumLength,
      let components = URLComponents(string: value),
      components.user == nil,
      components.password == nil,
      components.fragment == nil,
      components.queryItems?.isEmpty != false
    else { return nil }

    let scheme = components.scheme?.lowercased()
    let route: String
    let pathSegments: [String]
    if scheme == "portico" {
      guard components.port == nil, let host = components.host?.lowercased() else { return nil }
      route = host
      pathSegments = components.path.split(separator: "/").map(String.init)
    } else if scheme == "https" {
      guard
        components.port == nil,
        components.host?.lowercased() == notificationUniversalLinkHost
      else { return nil }
      let segments = components.path.split(separator: "/").map(String.init)
      guard let first = segments.first else { return nil }
      route = first.lowercased()
      pathSegments = Array(segments.dropFirst())
    } else {
      return nil
    }

    switch route {
    case "media", "play":
      guard pathSegments.count == 1, reviewedNotificationIdentifier(pathSegments[0]) != nil else { return nil }
    case "notifications", "downloads", "channels", "account":
      guard pathSegments.isEmpty else { return nil }
    case "settings":
      guard pathSegments.isEmpty || pathSegments == ["account"] else { return nil }
    default:
      return nil
    }
    return components.url
  }

  private static func reviewedNotificationIdentifier(_ value: Any?) -> String? {
    guard let value = value as? String else { return nil }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
      !normalized.isEmpty,
      normalized.count <= notificationIdentifierMaximumLength,
      normalized.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
    else { return nil }
    return normalized
  }

  private static func porticoURL(route: String, identifier: String? = nil) -> URL? {
    var components = URLComponents()
    components.scheme = "portico"
    components.host = route
    if let identifier { components.path = "/\(identifier)" }
    return components.url
  }

  func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    ensureBackgroundDownloadSession()
    guard identifier == Self.backgroundDownloadSessionIdentifier else {
      // No Portico code owns an unknown session identifier. Do not retain a
      // handler forever if a future SDK adds another background session.
      completionHandler()
      return
    }
    if backgroundSessionsFinishedBeforeHandler.remove(identifier) != nil {
      completionHandler()
      return
    }
    backgroundSessionCompletions[identifier, default: []].append(completionHandler)
    backgroundSessionWatchdogs[identifier]?.cancel()
    let watchdog = DispatchWorkItem { [weak self] in
      // URLSession must never be left waiting indefinitely for a React Native
      // bridge notification. The native manager remains durable and will
      // reconcile its records on the next launch; UIKit gets a bounded,
      // exactly-once completion callback now.
      self?.completeBackgroundSession(identifier: identifier, fromWatchdog: true)
    }
    backgroundSessionWatchdogs[identifier] = watchdog
    DispatchQueue.main.asyncAfter(
      deadline: .now() + Self.backgroundSessionWatchdogSeconds,
      execute: watchdog
    )
  }

  private func ensureBackgroundDownloadSession() {
    guard
      let managerClass = NSClassFromString(Self.backgroundDownloadManagerClassName) as? NSObject.Type
    else { return }
    // PorticoDownloadManager.init is singleton-backed, so this is idempotent
    // when the React Native bridge later requests the same module.
    _ = managerClass.init()
  }

  private func completeBackgroundSession(identifier: String, fromWatchdog: Bool = false) {
    guard identifier == Self.backgroundDownloadSessionIdentifier else { return }
    backgroundSessionWatchdogs.removeValue(forKey: identifier)?.cancel()
    let completions = backgroundSessionCompletions.removeValue(forKey: identifier) ?? []
    if completions.isEmpty {
      if fromWatchdog { return }
      // URLSession can finish native callbacks before UIKit presents the
      // completion handler. Retain only the session identity; never attempt to
      // persist or retain the escaping closure across a process restart.
      backgroundSessionsFinishedBeforeHandler.insert(identifier)
      return
    }
    completions.forEach { $0() }
  }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    if let response = connectionOptions.notificationResponse {
      launchOptions[.remoteNotification] = response.notification.request.content.userInfo
    }

    factory.startReactNative(
      withModuleName: "PorticoIOS",
      in: window,
      launchOptions: launchOptions
    )

    // Universal links arrive with the scene connection rather than through the
    // application delegate when they cold-start a scene.
    if let userActivity = connectionOptions.userActivities.first {
      DispatchQueue.main.async {
        _ = RCTLinkingManager.application(
          UIApplication.shared,
          continue: userActivity,
          restorationHandler: { _ in }
        )
      }
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let urlContext = URLContexts.first else { return }
    var options: [UIApplication.OpenURLOptionsKey: Any] = [
      .openInPlace: urlContext.options.openInPlace,
    ]
    if let sourceApplication = urlContext.options.sourceApplication {
      options[.sourceApplication] = sourceApplication
    }
    if let annotation = urlContext.options.annotation {
      options[.annotation] = annotation
    }
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      open: urlContext.url,
      options: options
    )
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

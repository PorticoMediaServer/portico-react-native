import Foundation
import React
import UIKit
import UserNotifications

@objc(PorticoPushNotifications)
final class PorticoPushNotifications: RCTEventEmitter {
  private static let lock = NSLock()
  private static var latestToken: String?
  private static var wakeRevision: UInt64 = 0
  private static weak var activeEmitter: PorticoPushNotifications?
  private var observing = false

  @objc static func publish(deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    lock.lock()
    latestToken = token
    let emitter = activeEmitter
    lock.unlock()
    DispatchQueue.main.async {
      guard emitter?.observing == true else { return }
      emitter?.sendEvent(withName: "PorticoPushTokenChanged", body: emitter?.currentPayload(token: token))
    }
  }

  @objc static func registrationFailed() {
    lock.lock()
    latestToken = nil
    let emitter = activeEmitter
    lock.unlock()
    DispatchQueue.main.async {
      guard emitter?.observing == true else { return }
      emitter?.sendEvent(withName: "PorticoPushTokenUnavailable", body: nil)
    }
  }

  @objc static func publishNotificationWake() {
    lock.lock()
    wakeRevision &+= 1
    let revision = wakeRevision
    let emitter = activeEmitter
    lock.unlock()
    DispatchQueue.main.async {
      guard emitter?.observing == true else { return }
      emitter?.sendEvent(withName: "PorticoNotificationWake", body: ["revision": revision])
    }
  }

  override init() {
    super.init()
    Self.lock.lock()
    Self.activeEmitter = self
    Self.lock.unlock()
  }

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["PorticoPushTokenChanged", "PorticoPushTokenUnavailable", "PorticoNotificationWake"]
  }

  @objc(setBadgeCount:resolver:rejecter:)
  func setBadgeCount(
    _ count: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      UNUserNotificationCenter.current().setBadgeCount(max(0, count.intValue)) { error in
        if let error {
          reject("badge-update-failed", "Portico could not update the notification badge.", error)
        } else {
          resolve(nil)
        }
      }
    }
  }

  @objc(requestRegistration:rejecter:)
  func requestRegistration(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    UNUserNotificationCenter.current().requestAuthorization(
      options: [.alert, .badge, .sound]
    ) { granted, error in
      if let error {
        reject(
          "notification-authorization-failed",
          "Portico could not request notification permission.",
          error
        )
        return
      }
      guard granted else {
        resolve(nil)
        return
      }
      DispatchQueue.main.async {
        UIApplication.shared.registerForRemoteNotifications()
        resolve(nil)
      }
    }
  }

  override func startObserving() {
    observing = true
  }

  override func stopObserving() {
    observing = false
  }

  @objc(currentToken:rejecter:)
  func currentToken(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    Self.lock.lock()
    let token = Self.latestToken
    Self.lock.unlock()
    guard let token else {
      resolve(nil)
      return
    }
    resolve(currentPayload(token: token))
  }

  private func currentPayload(token: String) -> [String: String] {
#if DEBUG
    let environment = "sandbox"
#else
    let environment = "production"
#endif
    return [
      "deviceToken": token,
      "environment": environment,
      "appBundleId": Bundle.main.bundleIdentifier ?? ""
    ]
  }
}

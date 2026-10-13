import AVFoundation
import Foundation
import React
import UIKit
import VideoToolbox

/// The mpv engine's module: the same three methods and the same facts as the AVPlayer engine's
/// `PorticoPlaybackModule` (see `ENGINE-CONTRACT.md`), under its own names so that JavaScript
/// can hold either engine.
///
/// - Methods: `acquire(owner)`, `command(value)`, `release(lease)`, `facts()`.
/// - Events: `PorticoMpvPlaybackFact`, `PorticoMpvPictureInPicture`.
/// - Constants: `engine`, `available`, `features`.
@objc(PorticoMpvPlaybackModule)
final class PorticoMpvPlaybackModule: RCTEventEmitter {
    private static weak var current: PorticoMpvPlaybackModule?
    private var invalidated = false
    private var listening = false

    #if canImport(Libmpv)
    private let controller = PorticoMpvController()
    static let available = true
    #else
    static let available = false
    #endif

    override init() {
        super.init()
        PorticoMpvPlaybackModule.current = self
        #if canImport(Libmpv)
        PorticoMpvController.shared = controller
        controller.onFact = { [weak self] fact in
            guard let self = self, !self.invalidated, self.listening else { return }
            self.sendEvent(withName: "PorticoMpvPlaybackFact", body: fact)
        }
        #endif
    }

    override static func requiresMainQueueSetup() -> Bool { return true }
    override var methodQueue: DispatchQueue! { return DispatchQueue.main }
    override func supportedEvents() -> [String]! { return ["PorticoMpvPlaybackFact", "PorticoMpvPictureInPicture"] }
    override func startObserving() { if !invalidated { listening = true } }
    override func stopObserving() { listening = false }

    /// What this engine is and what it does not do, so the player can hide what does not apply
    /// while it is the active engine. These never change while the app runs.
    override func constantsToExport() -> [AnyHashable: Any]! {
        return [
            "engine": "mpv",
            "available": PorticoMpvPlaybackModule.available,
            "features": [
                // mpv draws into a Metal layer: the system can neither float it in a
                // Picture in Picture window nor send it to an AirPlay receiver as video.
                "pictureInPicture": false,
                "airPlayVideo": false,
                // Channels are positioned by wall-clock dates this engine does not expose.
                "liveChannels": false,
                // Music and audiobooks stay with the native listening owner.
                "musicSessions": false,
                // A direct-played file's audio and subtitle tracks are switched in the engine.
                "audioTrackSwitching": true,
                "subtitleRendering": ["text", "ass", "pgs", "vobsub", "dvb"],
                "chapters": true,
            ] as [String: Any],
        ]
    }

    /// A Picture in Picture answer from the engine's view ({lease, state}).
    static func pictureInPicture(_ body: [String: Any]) {
        guard let module = current, !module.invalidated, module.listening else { return }
        module.sendEvent(withName: "PorticoMpvPictureInPicture", body: body)
    }

    @objc func acquire(_ owner: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        if invalidated { reject("bridge_closed", "Playback bridge is closed.", nil); return }
        #if canImport(Libmpv)
        if let lease = controller.acquire(owner) { resolve(lease) } else { reject("owner_busy", "Another playback owner is still active.", nil) }
        #else
        reject("engine_unavailable", "This build does not include the mpv player.", nil)
        #endif
    }

    @objc func command(_ command: NSDictionary, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        if invalidated { reject("bridge_closed", "Playback bridge is closed.", nil); return }
        #if canImport(Libmpv)
        if let error = controller.accept(command) { reject("command_rejected", error, nil) } else { resolve(true) }
        #else
        reject("engine_unavailable", "This build does not include the mpv player.", nil)
        #endif
    }

    @objc(release:resolver:rejecter:) func releaseLease(_ lease: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        #if canImport(Libmpv)
        controller.releaseLease(lease) { resolve(true) }
        #else
        resolve(true)
        #endif
    }

    /// What this device gives the engine right now, for the mpv capability profile: which codecs
    /// the chip decodes in hardware (everything else is decoded in software, within the limits
    /// the profile sets by memory and processor count), whether the screen can show HDR from this
    /// engine, and how many channels the audio output takes.
    @objc func facts(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        var hdrOutput = false
        #if !os(tvOS)
        if #available(iOS 16.0, *) { hdrOutput = UIScreen.main.potentialEDRHeadroom > 1.0 }
        #endif
        var av1 = false
        if #available(iOS 17.0, tvOS 17.0, *) { av1 = VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1) }
        let session = AVAudioSession.sharedInstance()
        let pixels = UIScreen.main.nativeBounds.size
        resolve([
            "engine": "mpv",
            "available": PorticoMpvPlaybackModule.available,
            "memoryBytes": NSNumber(value: ProcessInfo.processInfo.physicalMemory),
            "processorCount": ProcessInfo.processInfo.activeProcessorCount,
            "hardwareDecode": [
                "h264": VTIsHardwareDecodeSupported(kCMVideoCodecType_H264),
                "hevc": VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC),
                "vp9": VTIsHardwareDecodeSupported(kCMVideoCodecType_VP9),
                "av1": av1,
            ],
            "hdrOutput": hdrOutput,
            "screen": ["width": max(pixels.width, pixels.height), "height": min(pixels.width, pixels.height), "maxFrameRate": UIScreen.main.maximumFramesPerSecond],
            "audio": ["maxOutputChannels": max(2, session.maximumOutputNumberOfChannels)],
        ] as [String: Any])
    }

    override func invalidate() {
        invalidated = true
        listening = false
        #if canImport(Libmpv)
        let controller = self.controller
        if Thread.isMainThread { controller.invalidate() } else { DispatchQueue.main.async { controller.invalidate() } }
        #endif
        super.invalidate()
    }
}

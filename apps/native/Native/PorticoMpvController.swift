#if canImport(Libmpv)
import AVFoundation
import AVKit
import CoreMedia
import MediaAccessibility
import UIKit

extension Notification.Name {
    /// The engine's lease changed: views re-check whether they show its picture.
    static let porticoMpvAttachmentChanged = Notification.Name("PorticoMpvAttachmentChanged")
    /// The text of the app-drawn subtitle overlay, or the picture's shape, changed.
    static let porticoMpvOverlayChanged = Notification.Name("PorticoMpvOverlayChanged")
}

/// The mpv player engine: the second implementation of the contract in `ENGINE-CONTRACT.md`.
///
/// JavaScript owns the playback session; this owns mpv. JavaScript acquires a lease, then sends
/// commands, each of which is the whole desired state. A command is validated in full before
/// anything changes. The engine answers with facts, each fenced by the binding it belongs to, a
/// rising sequence number and the last command revision the engine had seen.
///
/// Everything here runs on the main queue. mpv itself is only ever touched through
/// `PorticoMpvCore`, on its own queue.
final class PorticoMpvController: NSObject, PorticoEngineClockSource {
    static weak var shared: PorticoMpvController?

    /// A fact for JavaScript.
    var onFact: (([String: Any]) -> Void)?

    /// The layer mpv draws into. The view that shows the leased picture adopts it.
    let metalLayer = PorticoMpvMetalLayer()
    private(set) var lease: String?
    weak var attachedView: PorticoMpvPlayerView?

    /// The app-drawn subtitle line (plain cues from the server's cue document), when mpv is not
    /// drawing the chosen track itself.
    private(set) var overlayText = ""
    private(set) var overlayCue: [AnyHashable: Any] = [:]
    /// Width over height of the picture as displayed, when known.
    private(set) var videoAspect: Double?

    private let instanceId = UUID().uuidString
    private var invalidated = false
    private var owner: String?
    private var commandRevision = 0
    private var factSequence = 0
    private var binding: NSDictionary?
    private var command: NSDictionary?
    private var source: String?
    private var intentId = 0
    private var itemInstanceId = ""
    private var paused = true
    private var hasPlayed = false
    private var previousProgress = Double.nan
    private var lastProgressFact = Double.nan
    private var lastProgressPaused = true

    private var acceptedSeekRevision = -1
    private var acceptedSeekTarget = 0.0
    private var seekRetired = false
    private var seekRevision = -1
    private var seeking = false
    private var seekToken: UInt64 = 1000
    private var seekInFlight: (token: UInt64, revision: Int, target: Double, awaitingRestart: Bool)?
    private var startSeek: (revision: Int, target: Double)?

    private var routeSuspended = false
    private var routeResume = false
    private var routeSeeking = false
    private var routeFailed = false
    private var routeEpoch = 0
    private var routePosition = 0.0

    private var core: PorticoMpvCore?
    private let relay = PorticoMpvRelay()
    private var loadEpoch = 0
    /// A load was asked for the current source (the AVPlayer engine's "has a current item").
    private var fileRequested = false
    private var loaded = false
    private var restarted = false
    private var displayHold = false
    private var backgroundHold = false
    private var endedEmitted = false
    private var snapshot = PorticoMpvSnapshot()
    private var lastPosition = Double.nan
    private var tracks: [[String: Any]] = []
    private var chapters: [[String: Any]] = []
    private var videoParams: [String: Any] = [:]
    private var teardown: DispatchWorkItem?
    private var audioSessionActive = false

    private var audioCommand: NSDictionary?
    private var audioMap: [String: Int]?
    private var audioMappingAttempted = false
    private var audioSequence = 0
    private var audioHandledRevision = -1
    private var audioTrackHandled = -1
    private var audioTrackPending: (revision: Int, track: Int, streamIndex: Int)?

    private let subtitleOverlay = PorticoSubtitleSelection()
    private var engineSubtitleKey: String?
    private var refusedSubtitleKeys = Set<String>()
    private var externalSubtitleAddress: String?
    private var subtitleToken: UInt64 = 0
    private var subtitleTokenCount: UInt64 = 0
    private var subtitleTokenKey = ""

    #if os(tvOS)
    private var displayCriteriaSet = false
    private var criteriaClear: DispatchWorkItem?
    #endif

    override init() {
        super.init()
        metalLayer.backgroundColor = UIColor.black.cgColor
        metalLayer.isOpaque = true
        metalLayer.framebufferOnly = true
        subtitleOverlay.onText = { [weak self] cue in
            guard let self = self else { return }
            self.overlayCue = cue ?? [:]
            self.overlayText = (cue?["text"] as? String) ?? ""
            NotificationCenter.default.post(name: .porticoMpvOverlayChanged, object: self)
        }
        subtitleOverlay.onStatus = { [weak self] error in self?.emit("subtitleStatus", error: error) }
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(enteredBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(enteringForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        center.addObserver(self, selector: #selector(memoryWarning), name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
        center.addObserver(self, selector: #selector(audioInterrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(audioRouteChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        center.addObserver(self, selector: #selector(audioServicesReset), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        center.addObserver(self, selector: #selector(captionStyleChanged), name: Notification.Name(kMACaptionAppearanceSettingsChangedNotification as String), object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        core?.destroy()
        relay.stop()
    }

    // MARK: - Lease

    func acquire(_ owner: String?) -> [String: Any]? {
        guard !invalidated, let owner = owner, !owner.isEmpty, owner.count <= 128 else { return nil }
        if lease != nil, self.owner != owner { return nil }
        if lease == nil {
            self.owner = owner
            lease = UUID().uuidString
            commandRevision = 0
            factSequence = 0
            // A lease taken while the app is in the background starts without a picture.
            backgroundHold = UIApplication.shared.applicationState == .background
        }
        return ["lease": lease ?? "", "instanceId": instanceId, "engine": "mpv"]
    }

    func releaseLease(_ value: String?) {
        guard let value = value, lease == value else { return }
        unload()
        resetAudio()
        subtitleOverlay.invalidate()
        engineSubtitleKey = nil
        refusedSubtitleKeys = []
        externalSubtitleAddress = nil
        relay.unbind()
        source = nil
        binding = nil
        command = nil
        lease = nil
        owner = nil
        seeking = false
        routeSuspended = false
        routeResume = false
        routeSeeking = false
        routeFailed = false
        routeEpoch += 1
        if PorticoEngineClock.active === self { PorticoEngineClock.active = nil }
        NotificationCenter.default.post(name: .porticoMpvAttachmentChanged, object: self)
        releaseAudioSession()
        scheduleTeardown()
        #if os(tvOS)
        scheduleCriteriaClear()
        #endif
    }

    func invalidate() {
        invalidated = true
        onFact = nil
        releaseLease(lease)
        teardown?.cancel()
        teardown = nil
        core?.destroy()
        core = nil
        relay.stop()
    }

    // MARK: - Commands

    /// Accepts a command, or answers why not. Nothing changes unless the whole command is valid.
    func accept(_ value: Any?) -> String? {
        if invalidated { return "Playback controller is closed." }
        guard let command = value as? NSDictionary, let binding = command["binding"] as? NSDictionary else { return "Invalid playback binding." }
        guard let lease = lease, (binding["lease"] as? String) == lease else { return "Playback lease is no longer active." }
        guard let paused = PorticoMpvSupport.boolean(command["paused"]) else { return "Invalid paused flag." }
        guard let source = command["source"] as? String, PorticoMpvSupport.number(command["rate"]) != nil else { return "Invalid playback command." }
        guard let intent = PorticoMpvSupport.integer(binding["intentId"]), let generation = PorticoMpvSupport.integer(binding["generation"]) else { return "Invalid playback binding." }
        guard let revision = PorticoMpvSupport.integer(command["commandRevision"]) else { return "Invalid playback revision." }
        if revision < commandRevision { return "Stale playback command." }
        if revision == commandRevision { return (self.command?.isEqual(command) ?? false) ? nil : "Conflicting playback command." }
        guard let sessionId = binding["sessionId"] as? String, let itemId = binding["itemId"] as? String else { return "Invalid playback binding." }
        if let clock = command["timelineOriginMs"], !(clock is NSNull) {
            guard PorticoMpvSupport.integer(clock) != nil else { return "Invalid channel clock." }
            return "This player does not play live channels."
        }
        let route = command["routeRevision"]
        if let connection = command["connectionState"], !(connection is NSNull) {
            guard let state = connection as? String, state == "ready" || state == "verifying", PorticoMpvSupport.integer(route, minimum: 0) != nil else { return "Invalid route transition." }
        }
        let previousRoute = PorticoMpvSupport.number(self.command?["routeRevision"])
        let nextRoute = PorticoMpvSupport.number(route)
        if let previousRoute = previousRoute, nextRoute == nil || nextRoute! < previousRoute { return "Stale route transition." }
        if let listening = command["listeningOwner"], !(listening is NSNull) { return "This player does not play music sessions." }
        if let render = command["audioRender"], !(render is NSNull) { return "Unsupported audio render context." }
        if let old = self.binding {
            let oldIntent = PorticoMpvSupport.integer(old["intentId"]) ?? 0
            let sameBinding = old.isEqual(binding)
            let sameSource = self.source == source
            let oldURL = URL(string: self.source ?? ""), nextURL = URL(string: source)
            let sameResource = oldURL != nil && nextURL != nil && oldURL!.path == nextURL!.path && (oldURL!.query ?? "") == (nextURL!.query ?? "") && (nextURL!.user ?? "").isEmpty && (nextURL!.password ?? "").isEmpty && (nextURL!.fragment ?? "").isEmpty
            let routeChange = sameBinding && sameResource && nextRoute != nil && nextRoute! > (previousRoute ?? 0)
            let same = sameBinding && (sameSource || routeChange)
            if intent < oldIntent || (intent == oldIntent && !same) { return "Stale playback binding." }
        }
        var pendingSeek: (revision: Int, target: Double)?
        if let pending = command["pendingSeek"], !(pending is NSNull) {
            guard let seek = pending as? NSDictionary, let seekRevisionValue = PorticoMpvSupport.number(seek["revision"]), let target = PorticoMpvSupport.number(seek["positionSeconds"]),
                  abs(seekRevisionValue) <= PorticoMpvSupport.maximumSafeInteger, abs(target) <= PorticoMpvSupport.maximumSafeInteger, seekRevisionValue >= 0, target >= 0 else { return "Invalid seek command." }
            guard seekRevisionValue >= 1, seekRevisionValue.rounded(.down) == seekRevisionValue else { return "Invalid seek revision." }
            pendingSeek = (Int(seekRevisionValue), target)
        }
        let sameBinding = self.binding?.isEqual(binding) ?? false
        if sameBinding, let pendingSeek = pendingSeek {
            if pendingSeek.revision < acceptedSeekRevision { return "Stale seek command." }
            if pendingSeek.revision == acceptedSeekRevision && (seekRetired || pendingSeek.target != acceptedSeekTarget) { return "Conflicting or retired seek command." }
        }
        if let track = command["audioTrack"], !(track is NSNull) {
            guard let wanted = track as? NSDictionary, PorticoMpvSupport.integer(wanted["revision"]) != nil, let index = PorticoMpvSupport.integer(wanted["streamIndex"], minimum: 0), index <= 65535 else { return "Invalid audio track command." }
        }
        _ = (paused, generation, sessionId, itemId)
        // Every check comes before any change. A live seek that is repeated still lets a newer
        // pause or rate through.
        if !sameBinding { acceptedSeekRevision = -1; seekRetired = false }
        if let pendingSeek = pendingSeek {
            acceptedSeekRevision = pendingSeek.revision
            acceptedSeekTarget = pendingSeek.target
            seekRetired = false
        } else if acceptedSeekRevision >= 0 {
            seekRetired = true
        }
        commandRevision = revision
        self.binding = binding.copy() as? NSDictionary
        apply(command.copy() as? NSDictionary ?? command)
        NotificationCenter.default.post(name: .porticoMpvAttachmentChanged, object: self)
        return nil
    }

    private func pendingSeekCommand() -> NSDictionary? {
        return command?["pendingSeek"] as? NSDictionary
    }

    private func apply(_ next: NSDictionary) {
        let sameBinding = (command?["binding"] as? NSDictionary)?.isEqual(next["binding"]) ?? false
        let verifying = (next["connectionState"] as? String) == "verifying"
        let nextIntent = PorticoMpvSupport.integer((next["binding"] as? NSDictionary)?["intentId"]) ?? 0
        let nextSource = (next["source"] as? String) ?? ""
        if !sameBinding {
            routeResume = false
            routeSeeking = false
            routeSuspended = false
            routeFailed = false
            routeEpoch += 1
        }
        let changed = source != nextSource
        // A change of route is not a new playback and not a seek: the position already reached
        // is kept, and playback returns to it on the new route.
        if sameBinding, verifying || changed, !routeResume, !routeSuspended {
            let position = routeFailed ? routePosition : currentPosition()
            if position.isFinite, position >= 0 {
                routePosition = position
                routeResume = true
                routeFailed = false
                routeEpoch += 1
            }
        }
        command = next
        paused = PorticoMpvSupport.boolean(next["paused"]) ?? true
        if verifying {
            if !routeSuspended {
                subtitleOverlay.invalidate()
                resetAudio()
                unload()
                routeSeeking = false
                seeking = false
            }
            routeSuspended = true
            return
        }
        let reload = routeSuspended || nextIntent != intentId || changed || !fileRequested
        routeSuspended = false
        if reload {
            hasPlayed = false
            previousProgress = .nan
            routeEpoch += 1
            subtitleOverlay.invalidate()
            resetAudio()
            seeking = false
            routeSeeking = false
            unload()
            intentId = nextIntent
            source = nextSource
            seekRevision = -1
            if !nextSource.isEmpty {
                guard let url = URL(string: nextSource), PorticoMpvSupport.allowedSource(url) else {
                    emit("error", error: "Invalid media address.")
                    return
                }
                configureAudioSession()
                itemInstanceId = UUID().uuidString
                beginLoad(url)
                if routeResume {
                    let epoch = routeEpoch
                    let load = loadEpoch
                    DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
                        guard let self = self, !self.invalidated, self.routeEpoch == epoch, self.loadEpoch == load, self.routeResume else { return }
                        self.routeResume = false
                        self.routeSeeking = false
                        self.routeFailed = true
                        self.routeEpoch += 1
                        self.core?.set("pause", "yes")
                        self.emit("error", error: "Connection restored, but the retained position is not available. Your playback session was not replaced.")
                    }
                }
            }
        }
        let pending = pendingSeekCommand()
        if pending != nil, routeResume || routeSeeking || routeFailed {
            // A seek the viewer asked for takes the place of the position being restored.
            routeResume = false
            routeSeeking = false
            routeFailed = false
            routeEpoch += 1
        }
        if pending == nil, seeking {
            seeking = false
            seekInFlight = nil
            startSeek = nil
        }
        applyAudio()
        applyAudioTrack()
        applySubtitles()
        applyPendingSeek()
        applyIntent()
    }

    // MARK: - Loading

    private func mpvOptions() -> [(String, String)] {
        let memory = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
        let small = memory > 0 && memory <= 2.5
        var options: [(String, String)] = []
        // Devices with little memory or an older graphics chip keep the cheaper scalers.
        if memory > 0, memory < 3.5 { options.append(("profile", "fast")) }
        options += [
            ("config", "no"), ("load-scripts", "no"), ("osc", "no"), ("osd-level", "0"), ("ytdl", "no"), ("terminal", "no"),
            ("input-default-bindings", "no"), ("input-vo-keyboard", "no"),
            ("idle", "yes"), ("keep-open", "yes"), ("pause", "yes"),
            // Picture: mpv's own renderer through Vulkan on Metal, into the layer it was given.
            ("vo", "gpu-next"), ("gpu-api", "vulkan"), ("gpu-context", "moltenvk"),
            // Decoding: VideoToolbox where the chip has the codec, software otherwise.
            ("hwdec", "videotoolbox"),
            ("target-colorspace-hint", "no"), ("tone-mapping", "auto"),
            // Sound: decoded on the device and handed to the system as PCM, in as many channels
            // as the output takes. Nothing is passed through as a bitstream.
            ("ao", "audiounit"),
            ("hr-seek", "yes"),
            ("cache", "yes"), ("demuxer-max-bytes", small ? "48MiB" : "150MiB"), ("demuxer-max-back-bytes", small ? "8MiB" : "48MiB"),
            ("network-timeout", "30"),
            // Tracks are chosen by command, never by mpv's own preferences or by files nearby.
            ("sub-auto", "no"), ("audio-file-auto", "no"), ("sid", "no"), ("audio-display", "no"),
            // Text subtitles look the way the AVPlayer engine draws them: white on a soft black
            // box, inside the picture. Styled (ASS) tracks keep their own look.
            ("sub-use-margins", "no"), ("sub-ass-force-margins", "no"),
            ("sub-font-size", "45"), ("sub-margin-y", "58"), ("sub-color", "1.0/1.0/1.0/1.0"),
            ("sub-border-style", "background-box"), ("sub-back-color", "0.0/0.0/0.0/0.7"), ("sub-outline-size", "0"), ("sub-shadow-offset", "0"),
            ("sub-scale", String(format: "%.2f", PorticoMpvSupport.captionScale())),
            ("user-agent", "Portico"),
        ]
        return options
    }

    private func ensureCore() -> PorticoMpvCore? {
        teardown?.cancel()
        teardown = nil
        if let core = core { return core }
        guard let made = PorticoMpvCore(layer: metalLayer, options: mpvOptions()) else { return nil }
        made.onEvent = { [weak self] epoch, event, snapshot in self?.handle(epoch: epoch, event: event, snapshot: snapshot) }
        core = made
        return made
    }

    /// mpv is kept for a short while after a lease ends, so the next title starts at once.
    private func scheduleTeardown() {
        teardown?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.lease == nil else { return }
            self.core?.destroy()
            self.core = nil
            self.relay.stop()
        }
        teardown = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: work)
    }

    private func unload() {
        loadEpoch += 1
        fileRequested = false
        loaded = false
        restarted = false
        displayHold = false
        startSeek = nil
        seekInFlight = nil
        audioTrackPending = nil
        tracks = []
        chapters = []
        videoParams = [:]
        if engineSubtitleKey != nil { engineSubtitleKey = nil; externalSubtitleAddress = nil }
        core?.setFastTicks(false)
        core?.stop()
        setVideoAspect(nil)
        updateOutputRange()
    }

    private func beginLoad(_ url: URL) {
        loadEpoch += 1
        let epoch = loadEpoch
        fileRequested = true
        loaded = false
        restarted = false
        displayHold = false
        endedEmitted = false
        lastPosition = .nan
        lastProgressFact = .nan
        snapshot = PorticoMpvSnapshot()
        audioTrackHandled = -1
        refusedSubtitleKeys = []
        #if os(tvOS)
        criteriaClear?.cancel()
        criteriaClear = nil
        #endif
        guard ensureCore() != nil else {
            publishFailure(code: -15, message: "mpv could not start", log: [])
            return
        }
        PorticoEngineClock.active = self
        if url.isFileURL {
            startLoad(url.path, epoch: epoch)
            return
        }
        relay.clearFailure()
        relay.bind(source: url) { [weak self] local in
            guard let self = self, self.loadEpoch == epoch, self.fileRequested else { return }
            guard let local = local else {
                self.publishFailure(code: -13, message: "relay unavailable", log: [])
                return
            }
            self.startLoad(local.absoluteString, epoch: epoch)
        }
    }

    private func startLoad(_ address: String, epoch: Int) {
        guard let core = core else { return }
        var options: [String: String] = [:]
        // The position to start at is part of opening the file, so nothing is decoded from the
        // beginning only to be thrown away.
        if routeResume, !routeSuspended {
            routeSeeking = true
            options["start"] = String(format: "%.3f", routePosition)
        } else if let pending = pendingSeekCommand(), let revision = PorticoMpvSupport.integer(pending["revision"]), let target = PorticoMpvSupport.number(pending["positionSeconds"]), revision > seekRevision {
            seekRevision = revision
            seeking = true
            startSeek = (revision, target)
            options["start"] = String(format: "%.3f", target)
        }
        core.set("pause", "yes")
        core.set("sid", "no")
        core.set("aid", "auto")
        core.set("vid", backgroundHold ? "no" : "auto")
        core.set("sub-delay", "0")
        core.set("target-colorspace-hint", hdrOutputAvailable() ? "yes" : "no")
        core.load(address, options: options, epoch: epoch)
    }

    // MARK: - mpv events

    private func handle(epoch: Int, event: PorticoMpvEvent, snapshot next: PorticoMpvSnapshot) {
        guard epoch == loadEpoch, fileRequested, !invalidated, lease != nil else { return }
        if case .fastTick(let time) = event {
            subtitleOverlay.tick(CMTime(seconds: time, preferredTimescale: 1_000_000))
            return
        }
        let before = snapshot
        snapshot = next
        if next.timePos.isFinite { lastPosition = next.timePos }
        switch event {
        case .fileLoaded(let list, let marks):
            loaded = true
            tracks = list
            chapters = marks
            applyAudio()
            applyAudioTrack()
            applySubtitles()
        case .playbackRestart:
            if !restarted {
                restarted = true
                firstFrame()
            } else if let flight = seekInFlight, flight.awaitingRestart {
                seekInFlight = nil
                completeSeek(revision: flight.revision, target: flight.target, finished: true)
            }
        case .endFile(let reason, let code, let message, let log):
            if reason == .error { publishFailure(code: code, message: message, log: log) } else if reason == .eof { reachedEnd() }
        case .tracksChanged(let list):
            tracks = list
            if loaded {
                applyAudio()
                applySubtitles()
                publishMediaInfo()
            }
        case .videoParams(let params):
            videoParams = params
            if let width = (params["dw"] as? NSNumber)?.doubleValue, let height = (params["dh"] as? NSNumber)?.doubleValue, width > 0, height > 0 { setVideoAspect(width / height) }
            updateOutputRange()
            if restarted { publishMediaInfo() }
        case .changed(let name):
            switch name {
            case "paused-for-cache":
                if next.pausedForCache, !before.pausedForCache, hasPlayed, !next.eofReached { emit("stalled", error: nil) }
                emit("rateStatus", error: nil)
                PorticoEngineClock.changed()
            case "eof-reached":
                if next.eofReached { reachedEnd() } else { endedEmitted = false }
            case "aid":
                sampleAudio()
                confirmAudioTrack()
            case "pause", "speed", "core-idle":
                emit("rateStatus", error: nil)
                PorticoEngineClock.changed()
            case "duration":
                if restarted { publishMediaInfo() }
            default:
                break
            }
        case .reply(let token, let code):
            if var flight = seekInFlight, flight.token == token {
                if code < 0 {
                    seekInFlight = nil
                    completeSeek(revision: flight.revision, target: flight.target, finished: false)
                } else {
                    flight.awaitingRestart = true
                    seekInFlight = flight
                }
            } else if token == subtitleToken, token != 0, code < 0 {
                // The subtitle file could not be opened: fall back to the plain cue document.
                subtitleToken = 0
                refusedSubtitleKeys.insert(subtitleTokenKey)
                engineSubtitleKey = nil
                externalSubtitleAddress = nil
                applySubtitles()
            }
        case .tick:
            applyPendingSeek()
            let position = currentPosition()
            // A paused picture reports once, not twice a second for as long as it stays paused.
            if position.isFinite, position != lastProgressFact || next.pause != lastProgressPaused {
                lastProgressFact = position
                lastProgressPaused = next.pause
                emit("progress", error: nil)
            }
        case .fastTick:
            break
        }
    }

    /// The first frame of a newly opened file is decoded and on screen.
    private func firstFrame() {
        // mpv plays on without a picture, or without sound, when it has no decoder for a track.
        // That is a failure of this engine for this file, and the server is told so.
        if !backgroundHold, PorticoMpvSupport.hasVideo(tracks), snapshot.vid == "no" {
            publishFailure(code: -18, message: "video track could not be decoded", log: [], engine: "decode_error")
            return
        }
        if !PorticoMpvSupport.tracks(tracks, type: "audio").isEmpty, snapshot.aid == "no" {
            publishFailure(code: -18, message: "audio track could not be decoded", log: [], engine: "decode_error")
            return
        }
        hasPlayed = true
        emit("firstFrame", error: nil)
        matchDisplay { [weak self] in self?.displayReady() }
    }

    private func displayReady() {
        if routeResume {
            routeSeeking = false
            let actual = currentPosition()
            if !actual.isFinite || abs(actual - routePosition) > 0.5 {
                routeResume = false
                routeFailed = true
                routeEpoch += 1
                core?.set("pause", "yes")
                emit("error", error: "The previous playback position is unavailable on this connection. Your position has been retained.")
                return
            }
            routeResume = false
            emit("ready", error: nil)
        } else if !routeFailed {
            emit("ready", error: nil)
        }
        if let start = startSeek {
            startSeek = nil
            completeSeek(revision: start.revision, target: start.target, finished: true)
        }
        publishMediaInfo()
        applyPendingSeek()
        applyIntent()
    }

    private func reachedEnd() {
        guard restarted, !endedEmitted else { return }
        let duration = snapshot.duration, position = currentPosition()
        // A connection that died leaves mpv at the end of what it had: that is not the end of
        // the title. It is told from a real end by the relay having just failed upstream.
        if let failure = relay.lastFailure, ProcessInfo.processInfo.systemUptime - failure.at <= 20, !(URL(string: source ?? "")?.isFileURL ?? false), duration > 0, position.isFinite, position < duration - 3 {
            publishFailure(code: -13, message: "stream ended early", log: [])
            return
        }
        endedEmitted = true
        emit("ended", error: nil)
    }

    // MARK: - Intent, seeking

    private func desiredRate() -> Double {
        return PorticoMpvSupport.number(command?["rate"]) ?? 1
    }

    private func ready() -> Bool {
        return fileRequested && loaded && restarted
    }

    private func supportedRates() -> [Double] {
        return ready() ? PorticoMpvSupport.rates : []
    }

    private func effectiveRate() -> Double {
        guard ready(), !snapshot.pause, !snapshot.pausedForCache, !snapshot.coreIdle, !snapshot.eofReached else { return 0 }
        return snapshot.speed
    }

    private func currentPosition() -> Double {
        guard fileRequested else { return lastPosition }
        return snapshot.timePos.isFinite ? snapshot.timePos : lastPosition
    }

    private func applyIntent() {
        guard let core = core, fileRequested else { return }
        let hold = paused || seeking || pendingSeekCommand() != nil || routeSuspended || routeResume || routeSeeking || routeFailed || displayHold || backgroundHold || !ready()
        if hold {
            core.set("pause", "yes")
        } else {
            let rate = desiredRate()
            if PorticoMpvSupport.rates.contains(rate) {
                core.set("speed", String(format: "%.2f", rate))
                core.set("pause", "no")
            } else {
                core.set("pause", "yes")
            }
        }
        emit("rateStatus", error: nil)
    }

    private func applyPendingSeek() {
        guard let core = core, let pending = pendingSeekCommand(), !routeSuspended, !routeResume, !routeSeeking, ready(), !displayHold,
              let revision = PorticoMpvSupport.integer(pending["revision"]), revision > seekRevision,
              let target = PorticoMpvSupport.number(pending["positionSeconds"]), target >= 0 else { return }
        seekRevision = revision
        seeking = true
        startSeek = nil
        seekToken += 1
        seekInFlight = (seekToken, revision, target, false)
        core.set("pause", "yes")
        core.command(["seek", String(format: "%.3f", target), "absolute+exact"], token: seekToken)
    }

    private func completeSeek(revision: Int, target: Double, finished: Bool) {
        guard seekRevision == revision, let current = pendingSeekCommand(), PorticoMpvSupport.integer(current["revision"]) == revision else { return }
        seeking = false
        endedEmitted = false
        let observed = currentPosition()
        let applied = finished && observed.isFinite && abs(observed - target) <= 0.5
        var fact: [String: Any] = [
            "instanceId": instanceId, "type": applied ? "seekApplied" : "seekFailed", "intentId": intentId, "seekRevision": revision,
            "position": observed.isFinite ? observed : 0, "paused": pausedFact(),
            "error": applied ? "" : "That position is not available yet. Try seeking again.",
        ]
        for (key, value) in rateFacts() { fact[key] = value }
        publish(fact)
        PorticoEngineClock.changed()
    }

    // MARK: - Facts

    private func pausedFact() -> Bool {
        return snapshot.pause && !seeking && !routeResume
    }

    private func rateFacts() -> [String: Any] {
        let isReady = ready()
        let valid = PorticoMpvSupport.rates.contains(desiredRate())
        return [
            "effectiveRate": effectiveRate(), "supportedRates": supportedRates(), "rateReady": isReady,
            "rateWaiting": isReady && !snapshot.pause && (snapshot.pausedForCache || snapshot.coreIdle) && !snapshot.eofReached,
            "rateError": isReady && !valid ? "This speed is unavailable for this media. Choose a supported speed, then press Play." : "",
            "monotonicSeconds": ProcessInfo.processInfo.systemUptime,
        ]
    }

    private func publish(_ value: [String: Any]) {
        guard let onFact = onFact, let binding = binding, lease != nil, !routeSuspended else { return }
        if routeResume || routeSeeking || routeFailed, (value["type"] as? String) != "error" { return }
        var fact = value
        fact["itemInstanceId"] = itemInstanceId
        fact["binding"] = binding
        factSequence += 1
        fact["factSequence"] = factSequence
        fact["lastCommandRevision"] = commandRevision
        fact["seeking"] = seeking || pendingSeekCommand() != nil
        fact["engine"] = "mpv"
        onFact(fact)
    }

    private func emit(_ type: String, error: String?) {
        guard onFact != nil, let source = source, !source.isEmpty else { return }
        let position = (routeResume || routeFailed) ? routePosition : currentPosition()
        if type == "progress" {
            if effectiveRate() > 0, !seeking, !routeResume, position.isFinite, previousProgress.isFinite, position > previousProgress + 0.05 { hasPlayed = true }
            previousProgress = position
        }
        var fact: [String: Any] = ["instanceId": instanceId, "type": type, "intentId": intentId, "position": position.isFinite ? position : 0, "paused": pausedFact(), "error": error ?? ""]
        for (key, value) in rateFacts() { fact[key] = value }
        publish(fact)
    }

    /// URL failures that waiting will not change (the AVPlayer engine's list).
    private static let permanentURLErrors: Set<Int> = [NSURLErrorCancelled, NSURLErrorFileDoesNotExist, NSURLErrorFileIsDirectory, NSURLErrorNoPermissionsToReadFile, NSURLErrorDataNotAllowed, NSURLErrorAppTransportSecurityRequiresSecureConnection, NSURLErrorUserAuthenticationRequired, NSURLErrorUserCancelledAuthentication, NSURLErrorCannotDecodeRawData, NSURLErrorCannotDecodeContentData]

    /// One failure, classified the way the AVPlayer engine classifies its own: a network failure
    /// is weather and is retried on the same route; an engine failure (no decoder, a file mpv
    /// cannot read) carries its class so the server can be asked for the next route; anything
    /// whose cause is unclear says so and blames nobody.
    private func publishFailure(code: Int32, message: String, log: [String], engine named: String = "") {
        var network = false, delivery = false, uncertain = false
        var httpStatus = 0
        var engine = named
        let local = URL(string: source ?? "")?.isFileURL ?? false
        if engine.isEmpty {
            if !local, let failure = relay.lastFailure, ProcessInfo.processInfo.systemUptime - failure.at <= 15 {
                if failure.httpStatus >= 400, failure.httpStatus <= 599 {
                    httpStatus = failure.httpStatus
                } else if let urlError = failure.urlErrorCode {
                    if PorticoMpvController.permanentURLErrors.contains(urlError) { delivery = true } else { network = true }
                }
            }
            if httpStatus != 0 {
                delivery = true
                network = httpStatus >= 500 || httpStatus == 408 || httpStatus == 429
            } else if !network, !delivery {
                switch code {
                case -17, -16, -18:
                    // Not a format mpv knows, nothing in it mpv can play, or not supported.
                    engine = "source_not_supported"
                case -13:
                    // The file could not be opened at all. On this device that is the file; over
                    // the network, with no answer to go by, it is most often the connection.
                    if local { delivery = true } else { network = true }
                default:
                    // The picture or sound output would not start, or mpv gave no reason: the
                    // media is not to blame, and nothing is reported against it.
                    uncertain = true
                }
            }
        }
        let position = (routeResume || routeFailed) ? routePosition : currentPosition()
        var detail = "mpv \(code) \(message)"
        if let last = log.last, !last.isEmpty { detail += " / " + last }
        var fact: [String: Any] = [
            "instanceId": instanceId, "type": "error", "intentId": intentId, "position": position.isFinite ? position : 0, "paused": true,
            "networkError": network, "deliveryError": delivery, "httpStatus": httpStatus, "hasPlayed": hasPlayed, "uncertain": uncertain,
            "engineCode": (network || delivery) ? "" : engine, "errorDetail": String(detail.prefix(240)),
            "error": network ? "The media connection was interrupted. Verifying another route." : "This media could not be played. Check its format or try again.",
        ]
        for (key, value) in rateFacts() { fact[key] = value }
        core?.set("pause", "yes")
        publish(fact)
    }

    /// What the file turned out to hold: its length, chapters, picture and tracks.
    private func publishMediaInfo() {
        guard onFact != nil, ready() else { return }
        let video = PorticoMpvSupport.tracks(tracks, type: "video").first { ($0["selected"] as? Bool) ?? false }
        var picture: [String: Any] = ["dynamicRange": sourceRange(), "hardwareDecoding": snapshot.hwdec != "no" && !snapshot.hwdec.isEmpty, "outputDynamicRange": outputIsHDR() ? "hdr" : "sdr"]
        if let width = (videoParams["w"] as? NSNumber)?.intValue { picture["width"] = width }
        if let height = (videoParams["h"] as? NSNumber)?.intValue { picture["height"] = height }
        if let fps = (video?["demux-fps"] as? NSNumber)?.doubleValue, fps > 0 { picture["framesPerSecond"] = fps }
        if let codec = video?["codec"] as? String { picture["codec"] = codec }
        let describe: ([String: Any]) -> [String: Any] = { track in
            var out: [String: Any] = ["selected": (track["selected"] as? Bool) ?? false, "external": (track["external"] as? Bool) ?? false]
            if let index = (track["ff-index"] as? NSNumber)?.intValue { out["streamIndex"] = index }
            if let language = track["lang"] as? String { out["language"] = language }
            if let title = track["title"] as? String { out["title"] = title }
            if let codec = track["codec"] as? String { out["codec"] = codec }
            if let channels = (track["demux-channel-count"] as? NSNumber)?.intValue { out["channels"] = channels }
            if (track["default"] as? Bool) ?? false { out["default"] = true }
            if (track["forced"] as? Bool) ?? false { out["forced"] = true }
            return out
        }
        var marks: [[String: Any]] = []
        for chapter in chapters.prefix(500) {
            guard let time = (chapter["time"] as? NSNumber)?.doubleValue, time.isFinite, time >= 0 else { continue }
            marks.append(["startSeconds": time, "title": String(((chapter["title"] as? String) ?? "").prefix(256))])
        }
        var fact: [String: Any] = [
            "instanceId": instanceId, "type": "mediaInfo", "intentId": intentId, "position": currentPosition().isFinite ? currentPosition() : 0, "paused": pausedFact(), "error": "",
            "durationSeconds": snapshot.duration, "chapters": marks, "video": picture,
            "audioTracks": PorticoMpvSupport.tracks(tracks, type: "audio").prefix(64).map(describe),
            "subtitleTracks": PorticoMpvSupport.tracks(tracks, type: "sub").prefix(128).map(describe),
        ]
        for (key, value) in rateFacts() { fact[key] = value }
        publish(fact)
    }

    // MARK: - Audio

    /// A track command applies only to the playback it was made for.
    private func scoped(_ value: Any?) -> NSDictionary? {
        guard let dictionary = value as? NSDictionary, let own = dictionary["binding"] as? NSDictionary, let binding = binding else { return nil }
        for field in ["intentId", "sessionId", "generation"] {
            guard let left = own[field] as? NSObject, let right = binding[field] as? NSObject, left.isEqual(right) else { return nil }
        }
        return dictionary
    }

    private func resetAudio() {
        audioCommand = nil
        audioMap = nil
        audioMappingAttempted = false
        audioSequence = 0
        audioHandledRevision = -1
    }

    private func emitAudio(_ type: String, _ extra: [String: Any]) {
        guard let audio = audioCommand, onFact != nil, let source = source, !source.isEmpty,
              let audioBinding = audio["binding"] as? NSDictionary, PorticoMpvSupport.integer(audioBinding["intentId"]) == intentId, let epoch = audio["epoch"] else { return }
        var fact: [String: Any] = ["type": type, "audioBinding": audioBinding, "audioEpoch": epoch, "intentId": intentId, "instanceId": instanceId]
        for (key, value) in extra { fact[key] = value }
        let position = currentPosition()
        fact["position"] = position.isFinite ? position : 0
        fact["paused"] = pausedFact()
        for (key, value) in rateFacts() { fact[key] = value }
        publish(fact)
    }

    /// The server's audio renditions (an HLS stream's named tracks, or a file's tracks by stream
    /// index) are mapped onto mpv's tracks once per file; the pending choice is then selected.
    private func applyAudio() {
        guard let audio = scoped(command?["audio"]), audio["binding"] is NSDictionary, PorticoMpvSupport.number(audio["epoch"]) != nil, audio["renditions"] is NSArray else {
            resetAudio()
            return
        }
        let sameBinding = (audioCommand?["binding"] as? NSDictionary)?.isEqual(audio["binding"]) ?? false
        let sameEpoch = (audioCommand?["epoch"] as? NSNumber)?.isEqual(audio["epoch"]) ?? false
        if !sameBinding || !sameEpoch { resetAudio() }
        audioCommand = audio
        guard loaded else { return }
        if audioMap == nil {
            if audioMappingAttempted { return }
            audioMappingAttempted = true
            let renditions = (audio["renditions"] as? [NSDictionary]) ?? []
            guard let map = PorticoMpvSupport.mapRenditions(renditions, audio: PorticoMpvSupport.tracks(tracks, type: "audio")) else {
                emitAudio("audioMapped", ["renditionIds": [String](), "audioMappingFailure": "unsupported_metadata"])
                return
            }
            audioMap = map
            emitAudio("audioMapped", ["renditionIds": Array(map.keys)])
            sampleAudio()
        }
        selectPendingAudio()
    }

    private func sampleAudio() {
        guard let map = audioMap, let audio = audioCommand else { return }
        let current = Int(snapshot.aid)
        let observed = map.first { $0.value == current }?.key
        audioSequence += 1
        emitAudio("audioObserved", ["audioSequence": audioSequence, "renditionId": observed ?? NSNull()])
        if let pending = audio["pending"] as? NSDictionary, let revision = PorticoMpvSupport.integer(pending["revision"]), revision == audioHandledRevision,
           let wanted = pending["renditionId"] as? String, wanted == observed {
            emitAudio("audioApplied", ["audioRevision": revision, "renditionId": wanted])
        }
    }

    private func selectPendingAudio() {
        guard let map = audioMap, let pending = audioCommand?["pending"] as? NSDictionary, let revision = PorticoMpvSupport.integer(pending["revision"]), revision != audioHandledRevision else { return }
        audioHandledRevision = revision
        guard let wanted = pending["renditionId"] as? String, let track = map[wanted] else {
            emitAudio("audioFailed", ["audioRevision": revision, "error": "This audio track is unavailable in the current player."])
            return
        }
        core?.set("aid", String(track))
        // Choosing the track already in use changes nothing, so no change is announced: sample now.
        if Int(snapshot.aid) == track { sampleAudio() }
    }

    /// A direct-played file's audio track, chosen by its stream index (`audioTrack`).
    private func applyAudioTrack() {
        guard loaded, let wanted = command?["audioTrack"] as? NSDictionary, let revision = PorticoMpvSupport.integer(wanted["revision"]), revision != audioTrackHandled,
              let index = PorticoMpvSupport.integer(wanted["streamIndex"], minimum: 0) else { return }
        audioTrackHandled = revision
        let found = PorticoMpvSupport.tracks(tracks, type: "audio").filter { ($0["ff-index"] as? NSNumber)?.intValue == index }
        guard found.count == 1, let track = PorticoMpvSupport.trackId(found[0]) else {
            var fact: [String: Any] = ["instanceId": instanceId, "type": "audioTrackFailed", "intentId": intentId, "position": currentPosition().isFinite ? currentPosition() : 0, "paused": pausedFact(), "audioTrackRevision": revision, "streamIndex": index, "error": "This audio track is unavailable in the current player."]
            for (key, value) in rateFacts() { fact[key] = value }
            publish(fact)
            return
        }
        audioTrackPending = (revision, track, index)
        core?.set("aid", String(track))
        if Int(snapshot.aid) == track { confirmAudioTrack() }
    }

    private func confirmAudioTrack() {
        guard let pending = audioTrackPending, Int(snapshot.aid) == pending.track else { return }
        audioTrackPending = nil
        var fact: [String: Any] = ["instanceId": instanceId, "type": "audioTrackApplied", "intentId": intentId, "position": currentPosition().isFinite ? currentPosition() : 0, "paused": pausedFact(), "audioTrackRevision": pending.revision, "streamIndex": pending.streamIndex, "error": ""]
        for (key, value) in rateFacts() { fact[key] = value }
        publish(fact)
    }

    // MARK: - Subtitles

    /// Whether the chosen subtitles are being drawn by the app (the plain cue document) rather
    /// than by mpv.
    var subtitleOverlayActive: Bool { return subtitleOverlay.overlayActive }

    private func clearEngineSubtitle() {
        guard engineSubtitleKey != nil else { return }
        engineSubtitleKey = nil
        core?.set("sid", "no")
        removeExternalSubtitle()
    }

    private func removeExternalSubtitle() {
        guard let address = externalSubtitleAddress else { return }
        externalSubtitleAddress = nil
        for track in PorticoMpvSupport.tracks(tracks, type: "sub") where (track["external-filename"] as? String) == address {
            if let id = PorticoMpvSupport.trackId(track) { core?.command(["sub-remove", String(id)]) }
        }
    }

    /// Draws the chosen track with mpv itself (styled text through libass, image subtitles as
    /// images) when the command says where the track is; otherwise the app draws the server's
    /// plain cue document over the picture, exactly as the AVPlayer engine does.
    private func applySubtitles() {
        guard let subtitles = scoped(command?["subtitles"]), (subtitles["mode"] as? String) == "track" else {
            clearEngineSubtitle()
            subtitleOverlay.apply(nil, item: nil, source: source)
            core?.setFastTicks(false)
            return
        }
        let offset = max(-600, min(600, (Double((subtitles["offsetUs"] as? String) ?? "0") ?? 0) / 1_000_000))
        if let render = subtitles["render"] as? NSDictionary {
            // Which mpv track that is can only be said once the file is open.
            guard loaded else { return }
            let key = "\(subtitles["resourceId"] ?? "")|\(subtitles["resourceRevision"] ?? "")|\(render["kind"] ?? "")|\(render["streamIndex"] ?? "")|\(render["ordinal"] ?? "")|\(render["url"] ?? "")"
            if !refusedSubtitleKeys.contains(key) {
                if key == engineSubtitleKey {
                    core?.set("sub-delay", String(format: "%.3f", offset))
                    return
                }
                clearEngineSubtitle()
                if startEngineSubtitle(render, key: key) {
                    engineSubtitleKey = key
                    core?.set("sub-delay", String(format: "%.3f", offset))
                    subtitleOverlay.apply(nil, item: nil, source: source)
                    core?.setFastTicks(false)
                    emit("subtitleStatus", error: "")
                    return
                }
                refusedSubtitleKeys.insert(key)
            }
        }
        clearEngineSubtitle()
        guard subtitles["documentUrl"] is String else {
            subtitleOverlay.apply(nil, item: nil, source: source)
            core?.setFastTicks(false)
            emit("subtitleStatus", error: "This subtitle track is unavailable in the current player.")
            return
        }
        subtitleOverlay.apply(subtitles as? [AnyHashable: Any], item: nil, source: source)
        core?.setFastTicks(true)
    }

    private func startEngineSubtitle(_ render: NSDictionary, key: String) -> Bool {
        guard let core = core, let kind = render["kind"] as? String else { return false }
        if let format = (render["format"] as? String)?.lowercased(), !PorticoMpvSupport.renderedSubtitleFormats.contains(format) { return false }
        if kind == "embedded" {
            guard let track = PorticoMpvSupport.embeddedSubtitle(render, subtitles: PorticoMpvSupport.tracks(tracks, type: "sub")) else { return false }
            core.set("sid", String(track))
            return true
        }
        guard kind == "external", let text = render["url"] as? String, text.utf8.count <= 8192, let url = URL(string: text), let media = URL(string: source ?? "") else { return false }
        var address: String?
        if url.isFileURL {
            if media.isFileURL, PorticoMpvSupport.allowedLocalSource(url) { address = url.path }
        } else if PorticoMpvSupport.subtitleFileBelongs(url, toMedia: media) {
            address = relay.localURL(for: url)?.absoluteString
        }
        guard let target = address else { return false }
        externalSubtitleAddress = target
        subtitleTokenCount += 1
        subtitleToken = 1_000_000_000 + subtitleTokenCount
        subtitleTokenKey = key
        core.command(["sub-add", target, "select"], token: subtitleToken)
        return true
    }

    @objc private func captionStyleChanged() {
        core?.set("sub-scale", String(format: "%.2f", PorticoMpvSupport.captionScale()))
        NotificationCenter.default.post(name: .porticoMpvOverlayChanged, object: self)
    }

    private func setVideoAspect(_ value: Double?) {
        if videoAspect == value { return }
        videoAspect = value
        NotificationCenter.default.post(name: .porticoMpvOverlayChanged, object: self)
    }

    // MARK: - Picture: dynamic range and the display

    /// The source's dynamic range, by the capability document's names.
    private func sourceRange() -> String {
        if (videoParams["colormatrix"] as? String) == "dolbyvision" { return "dolby_vision" }
        switch (videoParams["gamma"] as? String) ?? "" {
        case "pq": return "hdr10"
        case "hlg": return "hlg"
        default: return "sdr"
        }
    }

    /// Whether this screen can show more than standard range from a Metal layer. An iPhone or
    /// iPad with an HDR panel can (iOS 16 and later). On Apple TV a Metal layer is always
    /// standard range, so HDR titles are tone-mapped on the device there.
    private func hdrOutputAvailable() -> Bool {
        #if os(tvOS)
        return false
        #else
        if #available(iOS 16.0, *) {
            let screen = attachedView?.window?.screen ?? UIScreen.main
            return screen.potentialEDRHeadroom > 1.0
        }
        return false
        #endif
    }

    private func outputIsHDR() -> Bool {
        return sourceRange() != "sdr" && hdrOutputAvailable()
    }

    private func updateOutputRange() {
        #if !os(tvOS)
        if #available(iOS 16.0, *) {
            let wanted = fileRequested && outputIsHDR()
            if metalLayer.wantsExtendedDynamicRangeContent != wanted { metalLayer.wantsExtendedDynamicRangeContent = wanted }
        }
        #endif
    }

    func attach(_ view: PorticoMpvPlayerView) {
        attachedView = view
        updateOutputRange()
        #if os(tvOS)
        // A view that arrives after the first frame still gets the television matched.
        if restarted, !displayCriteriaSet { matchDisplay {} }
        #endif
    }

    func detach(_ view: PorticoMpvPlayerView) {
        guard attachedView === view else { return }
        #if os(tvOS)
        clearDisplayCriteria(in: view.window)
        #endif
        attachedView = nil
    }

    #if os(tvOS)
    /// Asks the television to match the title's frame rate before playback starts, and waits for
    /// the switch to finish, so the first seconds are not lost to a blank screen. The picture is
    /// standard range (see `hdrOutputAvailable`), so only the rate is asked for.
    private func matchDisplay(_ done: @escaping () -> Void) {
        guard #available(tvOS 17.0, *), let manager = attachedView?.window?.avDisplayManager, manager.isDisplayCriteriaMatchingEnabled, let criteria = displayCriteria() else {
            done()
            return
        }
        criteriaClear?.cancel()
        criteriaClear = nil
        let epoch = loadEpoch
        displayHold = true
        displayCriteriaSet = true
        manager.preferredDisplayCriteria = criteria
        var settled = false
        var observer: NSObjectProtocol?
        let settle: () -> Void = { [weak self] in
            if settled { return }
            settled = true
            if let observer = observer { NotificationCenter.default.removeObserver(observer) }
            guard let self = self, self.loadEpoch == epoch, self.displayHold else { return }
            self.displayHold = false
            done()
        }
        observer = NotificationCenter.default.addObserver(forName: .AVDisplayManagerModeSwitchEnd, object: nil, queue: .main) { _ in
            // A television needs a moment after the switch before its picture is steady.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { settle() }
        }
        // No switch begins when the television is already in the right mode.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak manager] in
            if manager?.isDisplayModeSwitchInProgress != true { settle() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { settle() }
    }

    @available(tvOS 17.0, *)
    private func displayCriteria() -> AVDisplayCriteria? {
        let video = PorticoMpvSupport.tracks(tracks, type: "video").first { ($0["selected"] as? Bool) ?? false }
        guard let fps = (video?["demux-fps"] as? NSNumber)?.doubleValue, fps.isFinite, fps >= 1, fps <= 240,
              let width = (videoParams["w"] as? NSNumber)?.int32Value ?? (video?["demux-w"] as? NSNumber)?.int32Value, width > 0,
              let height = (videoParams["h"] as? NSNumber)?.int32Value ?? (video?["demux-h"] as? NSNumber)?.int32Value, height > 0 else { return nil }
        let extensions: [CFString: Any] = [
            kCMFormatDescriptionExtension_ColorPrimaries: kCMFormatDescriptionColorPrimaries_ITU_R_709_2,
            kCMFormatDescriptionExtension_TransferFunction: kCMFormatDescriptionTransferFunction_ITU_R_709_2,
            kCMFormatDescriptionExtension_YCbCrMatrix: kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2,
        ]
        var description: CMVideoFormatDescription?
        let status = CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault, codecType: kCMVideoCodecType_H264, width: width, height: height, extensions: extensions as CFDictionary, formatDescriptionOut: &description)
        guard status == noErr, let made = description else { return nil }
        return AVDisplayCriteria(refreshRate: Float(fps), formatDescription: made)
    }

    private func clearDisplayCriteria(in window: UIWindow?) {
        guard displayCriteriaSet else { return }
        displayCriteriaSet = false
        window?.avDisplayManager.preferredDisplayCriteria = nil
    }

    /// The television goes back to its own mode a moment after playback is left, not between
    /// two episodes.
    private func scheduleCriteriaClear() {
        criteriaClear?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.lease == nil else { return }
            self.clearDisplayCriteria(in: self.attachedView?.window ?? UIApplication.shared.windows.first)
        }
        criteriaClear = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }
    #else
    private func matchDisplay(_ done: @escaping () -> Void) { done() }
    #endif

    // MARK: - Sound

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, options: [])
        try? session.setSupportsMultichannelContent(true)
        try? session.setActive(true)
        // mpv opens its output with as many channels as the session offers.
        let channels = min(8, session.maximumOutputNumberOfChannels)
        if channels > 2 { try? session.setPreferredOutputNumberOfChannels(channels) }
        audioSessionActive = true
    }

    /// Lets another app's audio (music the film interrupted) know it may resume, unless this app
    /// is still playing something else.
    private func releaseAudioSession() {
        guard audioSessionActive else { return }
        audioSessionActive = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self = self, self.lease == nil else { return }
            if let other = PorticoPlaybackController.shared, other.listeningActive || other.lease != nil { return }
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    @objc private func audioInterrupted(_ note: Notification) {
        guard lease != nil, fileRequested, let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
        // The system took the output away for a call or Siri; mpv opens it again.
        try? AVAudioSession.sharedInstance().setActive(true)
        core?.command(["ao-reload"])
    }

    @objc private func audioRouteChanged(_ note: Notification) {
        guard lease != nil, fileRequested, let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt, let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
              reason == .newDeviceAvailable || reason == .oldDeviceUnavailable else { return }
        // Another output may take a different number of channels.
        let session = AVAudioSession.sharedInstance()
        let channels = min(8, session.maximumOutputNumberOfChannels)
        try? session.setPreferredOutputNumberOfChannels(max(2, channels))
        core?.command(["ao-reload"])
    }

    @objc private func audioServicesReset() {
        guard lease != nil, fileRequested else { return }
        configureAudioSession()
        core?.command(["ao-reload"])
    }

    // MARK: - App life

    /// The system does not let an app draw in the background. The picture is put away and
    /// playback is held; JavaScript is told, so its intent becomes "paused" and the Play button
    /// says so when the viewer comes back.
    @objc private func enteredBackground() {
        backgroundHold = true
        guard lease != nil, fileRequested, let core = core else { return }
        let wasPlaying = !paused
        core.set("pause", "yes")
        core.set("vid", "no")
        if wasPlaying {
            var fact: [String: Any] = ["instanceId": instanceId, "type": "systemPaused", "intentId": intentId, "position": currentPosition().isFinite ? currentPosition() : 0, "paused": true, "error": "", "reason": "background"]
            for (key, value) in rateFacts() { fact[key] = value }
            publish(fact)
        }
    }

    @objc private func enteringForeground() {
        guard backgroundHold else { return }
        backgroundHold = false
        guard lease != nil, fileRequested, let core = core else { return }
        core.set("vid", "auto")
        applyIntent()
    }

    @objc private func memoryWarning() {
        guard lease == nil, core != nil else { return }
        teardown?.cancel()
        teardown = nil
        core?.destroy()
        core = nil
        relay.stop()
    }

    // MARK: - PorticoEngineClockSource

    func engineClockPosition() -> Double { return currentPosition() }
    func engineClockRate() -> Double { return effectiveRate() }
    func engineClockDuration() -> Double { return snapshot.duration }
}
#endif

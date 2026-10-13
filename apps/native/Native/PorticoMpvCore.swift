#if canImport(Libmpv)
import Foundation
import QuartzCore
import Libmpv

/// The properties the engine acts on, read together on the core's queue.
struct PorticoMpvSnapshot {
    /// Seconds in the file's own timeline; NaN when mpv has no position yet.
    var timePos = Double.nan
    var duration = 0.0
    var pause = true
    var pausedForCache = false
    var coreIdle = true
    var eofReached = false
    var seeking = false
    var speed = 1.0
    /// `aid`, `sid` and `vid` as mpv prints them: a track id, "no" or "auto".
    var aid = "no"
    var sid = "no"
    var vid = "no"
    /// The hardware decoder in use ("videotoolbox"), or "no" when frames are decoded in software.
    var hwdec = "no"
}

enum PorticoMpvEndReason {
    case eof, stop, quit, error, redirect, other
}

enum PorticoMpvEvent {
    /// The file is open: its tracks and chapters are known. Nothing has been shown yet.
    case fileLoaded(tracks: [[String: Any]], chapters: [[String: Any]])
    /// Playback (re)started after a load or a seek: the frame at the new position is ready.
    case playbackRestart
    case endFile(reason: PorticoMpvEndReason, code: Int32, message: String, log: [String])
    case tracksChanged([[String: Any]])
    case videoParams([String: Any])
    /// An observed property other than the two above changed; the snapshot has the new value.
    case changed(String)
    /// An asynchronous command finished. `code` is 0 or a negative mpv error.
    case reply(token: UInt64, code: Int32)
    /// Twice a second while a file is open.
    case tick
    /// Twenty times a second while the app is drawing a subtitle overlay itself.
    case fastTick(Double)
}

/// A thin, serialised wrapper round one libmpv handle.
///
/// Every libmpv call happens on `queue`, never on the main thread, so a busy player core can
/// never stall the interface. Events are delivered on the main queue together with a property
/// snapshot and the "epoch" of the load they belong to; the controller discards anything whose
/// epoch is not its current one, so nothing from a replaced file is ever read as current.
final class PorticoMpvCore {
    /// Called on the main queue.
    var onEvent: ((Int, PorticoMpvEvent, PorticoMpvSnapshot) -> Void)?

    private let queue = DispatchQueue(label: "tv.getportico.mpv.core", qos: .userInitiated)
    private var handle: OpaquePointer?
    // The C window pointer is unretained; keep its layer until asynchronous destruction ends.
    private let layer: CAMetalLayer
    private var initializationError: Int32 = -15
    private var initializationDetail = "mpv could not start"
    private let wakeLock = NSLock()
    private var wakeQueued = false
    private var epoch = 0
    /// mpv has announced the start of the file loaded for `epoch`.
    private var started = false
    /// mpv's own id for the playlist entry of that load; 0 when it could not be read.
    private var entry: Int64 = 0
    private var ticker: DispatchSourceTimer?
    private var fastTicker: DispatchSourceTimer?
    private var logTail: [String] = []
    private(set) var version = ""

    private static let observed = ["pause", "paused-for-cache", "core-idle", "eof-reached", "seeking", "speed", "duration", "aid", "sid", "vid", "track-list", "video-params"]

    /// Creates and initialises mpv, drawing into `layer`. Startup failures arrive through the first load event.
    /// `options` are set before initialisation, in order.
    init(layer: CAMetalLayer, options: [(String, String)]) {
        self.layer = layer
        queue.async { self.initialize(options: options) }
    }

    private func initialize(options: [(String, String)]) {
        guard let created = mpv_create() else { return }
        var window = Int64(bitPattern: UInt64(UInt(bitPattern: Unmanaged.passUnretained(layer).toOpaque())))
        var code = mpv_set_option(created, "wid", MPV_FORMAT_INT64, &window)
        for (name, value) in options where code >= 0 {
            code = mpv_set_option_string(created, name, value)
            // MPVKit compiles Lua out on Apple mobile platforms, so these switches may not
            // exist. If they do exist in a build with scripting, explicitly disable them.
            if code == -5, ["osc", "ytdl", "load-scripts"].contains(name) { code = 0 }
            if code < 0 { initializationDetail = "Could not set mpv option " + name }
        }
        guard code >= 0 else {
            initializationError = code
            mpv_terminate_destroy(created)
            return
        }
        mpv_request_log_messages(created, "warn")
        code = mpv_initialize(created)
        guard code >= 0 else {
            initializationError = code
            mpv_terminate_destroy(created)
            return
        }
        handle = created
        if let text = mpv_get_property_string(created, "mpv-version") {
            version = String(cString: text)
            mpv_free(text)
        }
        for name in PorticoMpvCore.observed { mpv_observe_property(created, 0, name, MPV_FORMAT_NONE) }
        mpv_set_wakeup_callback(created, { context in
            guard let context = context else { return }
            Unmanaged<PorticoMpvCore>.fromOpaque(context).takeUnretainedValue().wake()
        }, Unmanaged.passUnretained(self).toOpaque())
    }

    private func wake() {
        wakeLock.lock()
        if wakeQueued { wakeLock.unlock(); return }
        wakeQueued = true
        wakeLock.unlock()
        queue.async { [weak self] in
            guard let self = self else { return }
            self.wakeLock.lock()
            self.wakeQueued = false
            self.wakeLock.unlock()
            self.drain()
        }
    }

    // MARK: - Commands (any thread)

    /// Replaces whatever is open with `url`. `options` apply to this file only.
    func load(_ url: String, options: [String: String], epoch next: Int) {
        queue.async {
            self.epoch = next
            self.started = false
            self.entry = 0
            self.logTail.removeAll()
            let list = options.keys.sorted().map { "\($0)=\(options[$0] ?? "")" }.joined(separator: ",")
            let code = list.isEmpty ? self.run(["loadfile", url, "replace"]) : self.run(["loadfile", url, "replace", "-1", list])
            if code < 0 {
                self.started = true
                self.deliver(.endFile(reason: .error, code: code, message: PorticoMpvCore.text(code), log: self.handle == nil ? [self.initializationDetail] : []))
                self.started = false
                return
            }
            // The load replaced the playlist, so its one entry is this file. Its id tells this
            // file's events from those of the file it replaced, which may still be queued.
            var id: Int64 = 0
            if let handle = self.handle, mpv_get_property(handle, "playlist/0/id", MPV_FORMAT_INT64, &id) >= 0 { self.entry = id } else { self.entry = 0 }
            self.startTicker()
        }
    }

    /// Closes the open file. Events for it are no longer delivered.
    func stop() {
        queue.async {
            self.epoch = 0
            self.started = false
            self.stopTickers()
            _ = self.run(["stop"])
        }
    }

    func set(_ name: String, _ value: String) {
        queue.async {
            guard let handle = self.handle else { return }
            mpv_set_property_string(handle, name, value)
        }
    }

    /// Runs a command; when `token` is not 0 its completion arrives as `.reply`.
    func command(_ arguments: [String], token: UInt64 = 0) {
        queue.async {
            guard let handle = self.handle else { return }
            var pointers = PorticoMpvCore.pointers(arguments)
            defer { PorticoMpvCore.release(pointers) }
            let code = pointers.withUnsafeMutableBufferPointer { mpv_command_async(handle, token, $0.baseAddress) }
            if code < 0, token != 0 { self.deliver(.reply(token: token, code: code)) }
        }
    }

    /// Whether the app wants `.fastTick` (it is drawing subtitles itself).
    func setFastTicks(_ wanted: Bool) {
        queue.async {
            if !wanted { self.fastTicker?.cancel(); self.fastTicker = nil; return }
            guard self.fastTicker == nil, self.handle != nil else { return }
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now() + 0.05, repeating: 0.05)
            timer.setEventHandler { [weak self] in
                guard let self = self, self.started, let time = self.double("time-pos") else { return }
                let epoch = self.epoch
                DispatchQueue.main.async { [weak self] in self?.onEvent?(epoch, .fastTick(time), PorticoMpvSnapshot()) }
            }
            timer.resume()
            self.fastTicker = timer
        }
    }

    /// Ends mpv. Nothing is delivered afterwards. The core stays alive until mpv has gone.
    func destroy(completion: (() -> Void)? = nil) {
        if Thread.isMainThread { onEvent = nil } else { DispatchQueue.main.async { self.onEvent = nil } }
        queue.async {
            self.stopTickers()
            self.epoch = 0
            self.started = false
            if let handle = self.handle {
                self.handle = nil
                mpv_set_wakeup_callback(handle, nil, nil)
                mpv_terminate_destroy(handle)
            }
            if let completion = completion { DispatchQueue.main.async { completion() } }
        }
    }

    // MARK: - Core queue

    private static func pointers(_ arguments: [String]) -> [UnsafePointer<CChar>?] {
        var pointers: [UnsafePointer<CChar>?] = []
        for argument in arguments {
            let copy: UnsafeMutablePointer<CChar>? = strdup(argument)
            pointers.append(UnsafePointer(copy))
        }
        pointers.append(nil)
        return pointers
    }

    private static func release(_ pointers: [UnsafePointer<CChar>?]) {
        for pointer in pointers {
            if let pointer = pointer { free(UnsafeMutableRawPointer(mutating: pointer)) }
        }
    }

    private static func text(_ code: Int32) -> String {
        guard let text = mpv_error_string(code) else { return "" }
        return String(cString: text)
    }

    private func run(_ arguments: [String]) -> Int32 {
        guard let handle = handle else { return initializationError }
        var pointers = PorticoMpvCore.pointers(arguments)
        defer { PorticoMpvCore.release(pointers) }
        return pointers.withUnsafeMutableBufferPointer { mpv_command(handle, $0.baseAddress) }
    }

    private func startTicker() {
        guard ticker == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.5, repeating: 0.5)
        timer.setEventHandler { [weak self] in
            guard let self = self, self.started else { return }
            self.deliver(.tick)
        }
        timer.resume()
        ticker = timer
    }

    private func stopTickers() {
        ticker?.cancel(); ticker = nil
        fastTicker?.cancel(); fastTicker = nil
    }

    private func double(_ name: String) -> Double? {
        guard let handle = handle else { return nil }
        var value = 0.0
        return mpv_get_property(handle, name, MPV_FORMAT_DOUBLE, &value) >= 0 ? value : nil
    }

    private func flag(_ name: String) -> Bool? {
        guard let handle = handle else { return nil }
        var value: Int32 = 0
        return mpv_get_property(handle, name, MPV_FORMAT_FLAG, &value) >= 0 ? value != 0 : nil
    }

    private func string(_ name: String) -> String? {
        guard let handle = handle, let text = mpv_get_property_string(handle, name) else { return nil }
        defer { mpv_free(text) }
        return String(cString: text)
    }

    /// A list or map property, which mpv prints as JSON.
    private func json(_ name: String) -> Any? {
        guard let text = string(name), text.utf8.count <= 2 * 1024 * 1024, let data = text.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [])
    }

    private func readSnapshot() -> PorticoMpvSnapshot {
        var snapshot = PorticoMpvSnapshot()
        snapshot.timePos = double("time-pos") ?? .nan
        snapshot.duration = double("duration") ?? 0
        snapshot.pause = flag("pause") ?? true
        snapshot.pausedForCache = flag("paused-for-cache") ?? false
        snapshot.coreIdle = flag("core-idle") ?? true
        snapshot.eofReached = flag("eof-reached") ?? false
        snapshot.seeking = flag("seeking") ?? false
        snapshot.speed = double("speed") ?? 1
        snapshot.aid = string("aid") ?? "no"
        snapshot.sid = string("sid") ?? "no"
        snapshot.vid = string("vid") ?? "no"
        snapshot.hwdec = string("hwdec-current") ?? "no"
        return snapshot
    }

    private func deliver(_ event: PorticoMpvEvent) {
        let snapshot = readSnapshot()
        let epoch = self.epoch
        DispatchQueue.main.async { [weak self] in self?.onEvent?(epoch, event, snapshot) }
    }

    private func drain() {
        while let handle = handle {
            guard let pointer = mpv_wait_event(handle, 0) else { return }
            let event = pointer.pointee
            if event.event_id == MPV_EVENT_NONE { return }
            switch event.event_id {
            case MPV_EVENT_SHUTDOWN:
                return
            case MPV_EVENT_START_FILE:
                guard epoch != 0 else { break }
                if entry != 0, let data = event.data {
                    started = data.assumingMemoryBound(to: mpv_event_start_file.self).pointee.playlist_entry_id == entry
                } else {
                    started = true
                }
            case MPV_EVENT_FILE_LOADED:
                guard started else { break }
                let tracks = (json("track-list") as? [[String: Any]]) ?? []
                let chapters = (json("chapter-list") as? [[String: Any]]) ?? []
                deliver(.fileLoaded(tracks: tracks, chapters: chapters))
            case MPV_EVENT_PLAYBACK_RESTART:
                if started { deliver(.playbackRestart) }
            case MPV_EVENT_END_FILE:
                guard started, let data = event.data else { break }
                let end = data.assumingMemoryBound(to: mpv_event_end_file.self).pointee
                if entry != 0, end.playlist_entry_id != entry { break }
                let reason: PorticoMpvEndReason
                switch end.reason {
                case MPV_END_FILE_REASON_EOF: reason = .eof
                case MPV_END_FILE_REASON_STOP: reason = .stop
                case MPV_END_FILE_REASON_QUIT: reason = .quit
                case MPV_END_FILE_REASON_ERROR: reason = .error
                case MPV_END_FILE_REASON_REDIRECT: reason = .redirect
                default: reason = .other
                }
                // A redirect (a playlist that names the real stream) is followed by another start.
                if reason == .redirect { break }
                deliver(.endFile(reason: reason, code: end.error, message: PorticoMpvCore.text(end.error), log: logTail))
                started = false
            case MPV_EVENT_PROPERTY_CHANGE:
                guard started, let data = event.data else { break }
                let property = data.assumingMemoryBound(to: mpv_event_property.self).pointee
                guard let namePointer = property.name else { break }
                let name = String(cString: namePointer)
                if name == "track-list" {
                    deliver(.tracksChanged((json("track-list") as? [[String: Any]]) ?? []))
                } else if name == "video-params" {
                    deliver(.videoParams((json("video-params") as? [String: Any]) ?? [:]))
                } else {
                    deliver(.changed(name))
                }
            case MPV_EVENT_COMMAND_REPLY:
                if event.reply_userdata != 0 { deliver(.reply(token: event.reply_userdata, code: event.error)) }
            case MPV_EVENT_LOG_MESSAGE:
                guard let data = event.data else { break }
                let message = data.assumingMemoryBound(to: mpv_event_log_message.self).pointee
                guard let prefix = message.prefix, let text = message.text else { break }
                let line = "\(String(cString: prefix)): \(String(cString: text).trimmingCharacters(in: .whitespacesAndNewlines))"
                logTail.append(String(line.prefix(300)))
                if logTail.count > 24 { logTail.removeFirst(logTail.count - 24) }
            default:
                break
            }
        }
    }
}
#endif

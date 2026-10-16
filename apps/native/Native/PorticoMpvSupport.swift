import Foundation
import CoreFoundation
import UIKit
import MediaAccessibility

/// Pieces of the mpv engine that need no libmpv: command validation, track matching and the
/// address rules. Kept apart so they can be read (and reused by a test target) on their own.
enum PorticoMpvSupport {
    static let rates: [Double] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
    static let maximumSafeInteger = 9_007_199_254_740_991.0

    // MARK: - Values from JavaScript

    /// A JSON boolean, and nothing that merely converts to one.
    static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    /// A finite JSON number that is not a boolean.
    static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        return double.isFinite ? double : nil
    }

    /// A whole number in `minimum...2^53-1`.
    static func integer(_ value: Any?, minimum: Double = 1) -> Int? {
        guard let double = number(value), double >= minimum, double <= maximumSafeInteger, double.rounded(.down) == double else { return nil }
        return Int(double)
    }

    static func dictionary(_ value: Any?) -> NSDictionary? {
        return value as? NSDictionary
    }

    /// `next` is a newer presentation of the playback `previous` is bound to: the same lease,
    /// intent, session and title, a later generation. The server planned the session again in
    /// place (a quality, version, audio or subtitle change), so the command is the current one,
    /// not a stale one, and the engine opens its source. The Android engines apply the same rule.
    static func replannedInPlace(_ previous: NSDictionary, _ next: NSDictionary) -> Bool {
        guard let before = integer(previous["generation"]), let after = integer(next["generation"]), let intent = integer(next["intentId"]),
              let session = next["sessionId"] as? String, let item = next["itemId"] as? String, let lease = next["lease"] as? String else { return false }
        return after > before && intent == integer(previous["intentId"]) && lease == (previous["lease"] as? String)
            && session == (previous["sessionId"] as? String) && item == (previous["itemId"] as? String)
    }

    // MARK: - Addresses

    /// A downloaded title: a file inside the app's own Downloads folder, checked after symlinks
    /// are resolved, and nowhere else on the device. The same rule as the AVPlayer engine.
    static func allowedLocalSource(_ url: URL) -> Bool {
        guard url.isFileURL, (url.query ?? "").isEmpty, (url.fragment ?? "").isEmpty,
              let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return false }
        let root = base.appendingPathComponent("Downloads", isDirectory: true).resolvingSymlinksInPath().standardizedFileURL.path
        let path = url.resolvingSymlinksInPath().standardizedFileURL.path
        var directory: ObjCBool = false
        return !root.isEmpty && path.hasPrefix(root + "/") && FileManager.default.fileExists(atPath: path, isDirectory: &directory) && !directory.boolValue
    }

    static func allowedSource(_ url: URL) -> Bool {
        if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            return !(url.host ?? "").isEmpty && url.user == nil && url.password == nil
        }
        return allowedLocalSource(url)
    }

    /// An external subtitle file belongs to the playback when it is on the media's own origin and
    /// under the media's own grant, with no credentials or fragment: beside the media itself
    /// (`/v1/media/<grant>/...`) or where the server keeps subtitle files and their fonts
    /// (`/v1/media/subtitles/<grant>/...`).
    static func subtitleFileBelongs(_ url: URL, toMedia media: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              scheme == media.scheme?.lowercased(), url.host?.lowercased() == media.host?.lowercased(), (url.port ?? 0) == (media.port ?? 0),
              url.user == nil, url.password == nil, url.fragment == nil else { return false }
        let parts = media.path.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count >= 3, parts[0] == "v1", parts[1] == "media" else { return false }
        let path = url.path
        guard !path.contains("\\"), !path.lowercased().contains("%"),
              !path.split(separator: "/", omittingEmptySubsequences: false).contains(where: { $0 == "." || $0 == ".." }) else { return false }
        return path.hasPrefix("/v1/media/\(parts[2])/") || path.hasPrefix("/v1/media/subtitles/\(parts[2])/")
    }

    /// HLS references (variants, segments, keys, maps and renditions) must pass through the
    /// same relay as the manifest. Resolve relative references against the upstream URL first.
    static func relayPlaylist(_ data: Data, source: URL, local: (URL) -> URL?) -> Data? {
        guard data.count <= 2 * 1024 * 1024, let text = String(data: data, encoding: .utf8),
              text.hasPrefix("#EXTM3U"),
              let uriPattern = try? NSRegularExpression(pattern: "URI=\"([^\"]*)\"") else { return nil }
        func address(_ value: String) -> String? {
            guard !value.isEmpty, value.utf8.count <= 8192, !value.contains("{$"),
                  let remote = URL(string: value, relativeTo: source)?.absoluteURL,
                  subtitleFileBelongs(remote, toMedia: source), let rewritten = local(remote) else { return nil }
            return rewritten.absoluteString
        }
        var lines: [String] = []
        for line in text.components(separatedBy: "\n") {
            let clean = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if clean.isEmpty { lines.append(""); continue }
            if !clean.hasPrefix("#") {
                guard let rewritten = address(clean) else { return nil }
                lines.append(rewritten)
                continue
            }
            if clean.hasPrefix("#EXT-X-DEFINE:") { return nil }
            let matches = uriPattern.matches(in: clean, range: NSRange(clean.startIndex..., in: clean))
            // Unquoted or malformed URI attributes must never pass through untouched.
            if clean.components(separatedBy: "URI=").count - 1 != matches.count { return nil }
            var rewritten = clean
            for match in matches.reversed() {
                guard let valueRange = Range(match.range(at: 1), in: rewritten),
                      let value = address(String(rewritten[valueRange])) else { return nil }
                rewritten.replaceSubrange(valueRange, with: value)
            }
            lines.append(rewritten)
        }
        return lines.joined(separator: "\n").data(using: .utf8)
    }

    // MARK: - Tracks

    static func tracks(_ all: [[String: Any]], type: String) -> [[String: Any]] {
        return all.filter { ($0["type"] as? String) == type }
    }

    static func trackId(_ track: [String: Any]) -> Int? {
        return (track["id"] as? NSNumber)?.intValue
    }

    /// A real video track, not cover art.
    static func hasVideo(_ all: [[String: Any]]) -> Bool {
        return tracks(all, type: "video").contains { !(($0["albumart"] as? Bool) ?? false) && !(($0["image"] as? Bool) ?? false) }
    }

    /// The name an HLS audio rendition was given in its playlist, which FFmpeg files as the
    /// stream's comment; otherwise the track's own title.
    static func names(of track: [String: Any]) -> [String] {
        var names: [String] = []
        if let title = track["title"] as? String, !title.isEmpty { names.append(title) }
        if let metadata = track["metadata"] as? [String: Any] {
            for (key, value) in metadata {
                let lowered = key.lowercased()
                if lowered == "comment" || lowered == "name" || lowered == "title", let text = value as? String, !text.isEmpty { names.append(text) }
            }
        }
        return names
    }

    /// Maps each server rendition (`id`, `name`, optional `streamIndex`) to exactly one mpv audio
    /// track. Every rendition must find its own track, or nothing is mapped: by the file's stream
    /// index when the server gives one, else by name, else by position when the counts agree.
    static func mapRenditions(_ renditions: [NSDictionary], audio: [[String: Any]]) -> [String: Int]? {
        guard !renditions.isEmpty, renditions.count <= 64 else { return nil }
        var ids: [String] = []
        for rendition in renditions {
            guard let id = rendition["id"] as? String, !id.isEmpty, !ids.contains(id) else { return nil }
            ids.append(id)
        }
        var mapped: [String: Int] = [:]
        var used = Set<Int>()
        var exact = true
        for (position, rendition) in renditions.enumerated() {
            var match: Int?
            if let index = integer(rendition["streamIndex"], minimum: 0) {
                let found = audio.filter { ($0["ff-index"] as? NSNumber)?.intValue == index }
                if found.count == 1 { match = trackId(found[0]) }
            }
            if match == nil, let name = rendition["name"] as? String, !name.isEmpty {
                let found = audio.filter { names(of: $0).contains(name) }
                if found.count == 1 { match = trackId(found[0]) }
            }
            guard let track = match, !used.contains(track) else { exact = false; break }
            mapped[ids[position]] = track
            used.insert(track)
        }
        if exact { return mapped }
        guard audio.count == renditions.count else { return nil }
        mapped = [:]
        for (position, id) in ids.enumerated() {
            guard let track = trackId(audio[position]) else { return nil }
            mapped[id] = track
        }
        return mapped
    }

    /// The codecs FFmpeg reports for each subtitle kind of the capability document.
    static let subtitleCodecs: [String: Set<String>] = [
        "text": ["subrip", "srt", "webvtt", "mov_text", "text", "microdvd", "sami", "ttml"],
        "ass": ["ass", "ssa"],
        "pgs": ["hdmv_pgs_subtitle"],
        "vobsub": ["dvd_subtitle"],
        "dvb": ["dvb_subtitle", "dvb_teletext"],
    ]

    /// The track inside the media itself that an `embedded` description names: of the wanted
    /// kind, by stream index, else by its position among the file's own subtitle tracks, else by
    /// language (and title when several share the language). Nil when nothing, or more than one
    /// track, fits.
    static func embeddedSubtitle(_ embedded: NSDictionary, kind: String, subtitles: [[String: Any]]) -> Int? {
        let codecs = subtitleCodecs[kind] ?? []
        let own = subtitles.filter { !(($0["external"] as? Bool) ?? false) }
        let ofKind = own.filter { codecs.contains((($0["codec"] as? String) ?? "").lowercased()) }
        if let index = integer(embedded["streamIndex"], minimum: 0) {
            let found = ofKind.filter { ($0["ff-index"] as? NSNumber)?.intValue == index }
            if found.count == 1 { return trackId(found[0]) }
        }
        if let ordinal = integer(embedded["ordinal"], minimum: 0), ordinal < own.count, codecs.contains(((own[ordinal]["codec"] as? String) ?? "").lowercased()) {
            return trackId(own[ordinal])
        }
        guard let language = (embedded["language"] as? String)?.lowercased(), !language.isEmpty, language.count <= 35 else { return nil }
        let wanted = baseLanguage(language)
        var matches = ofKind.filter { baseLanguage((($0["lang"] as? String) ?? "").lowercased()) == wanted }
        if matches.count > 1, let title = embedded["title"] as? String, !title.isEmpty {
            let titled = matches.filter { (($0["title"] as? String) ?? "").localizedCaseInsensitiveCompare(title) == .orderedSame }
            if titled.count == 1 { matches = titled }
        }
        return matches.count == 1 ? trackId(matches[0]) : nil
    }

    /// Two- and three-letter codes for the same language compare equal for the common cases.
    static func baseLanguage(_ tag: String) -> String {
        let base = tag.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init) ?? tag
        let three: [String: String] = ["eng": "en", "fra": "fr", "fre": "fr", "deu": "de", "ger": "de", "spa": "es", "ita": "it", "por": "pt", "nld": "nl", "dut": "nl", "jpn": "ja", "kor": "ko", "zho": "zh", "chi": "zh", "rus": "ru", "swe": "sv", "nor": "no", "dan": "da", "fin": "fi", "pol": "pl", "tur": "tr", "ara": "ar", "heb": "he", "hin": "hi", "ces": "cs", "cze": "cs", "ell": "el", "gre": "el", "hun": "hu", "ron": "ro", "rum": "ro", "ukr": "uk", "vie": "vi", "tha": "th", "ind": "id"]
        return three[base] ?? base
    }

    /// The subtitle kinds mpv draws itself, by the names the capability document uses.
    static let renderedSubtitleKinds: Set<String> = ["text", "ass", "pgs", "vobsub", "dvb"]

    // MARK: - Device

    /// The viewer's caption size from the system's Accessibility settings, as a scale on the
    /// engine's own subtitle size (1 when the viewer has not set one).
    static func captionScale() -> Double {
        let size = Double(MACaptionAppearanceGetRelativeCharacterSize(.user, nil))
        return size.isFinite && size > 0 ? min(3, max(0.5, size)) : 1
    }

    /// The size of Portico's own caption style (the subtitle command's `style.scale`), 1 when absent.
    static func styleScale(_ style: [AnyHashable: Any]) -> Double {
        guard let scale = number(style["scale"]), scale >= 0.5, scale <= 3 else { return 1 }
        return scale
    }

    /// The background of Portico's own caption style: "none", "translucent" (the default) or "opaque".
    static func styleBackground(_ style: [AnyHashable: Any]) -> String {
        let value = style["background"] as? String
        return value == "none" || value == "opaque" ? value! : "translucent"
    }
}

/// Fetches the fonts attached to a styled subtitle file into a folder mpv can read them from.
/// Bounded in number, size and time; never follows a redirect; a font that cannot be fetched is
/// left out, and the subtitles are then drawn with the nearest system font.
final class PorticoMpvFontFetcher: NSObject, URLSessionDownloadDelegate {
    private static let maximumFonts = 16
    private static let maximumBytes: Int64 = 24 * 1024 * 1024
    private var session: URLSession?
    private(set) var folder: URL?
    private var names: [Int: String] = [:]
    private var received: [Int: Int64] = [:]
    private var stored = 0
    private var completion: ((URL?) -> Void)?
    /// Counts gathers (and cancels), so a copy that finishes after a newer choice is dropped.
    private var gathering = 0

    /// The server's certificate is checked the way every Portico connection checks it: system
    /// trust, or the owner's certificate pinned for this address (PorticoServerTrust).
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        PorticoServerTrust.handle(challenge, completion: completionHandler)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    /// Runs on the main queue. At most 24 MiB are downloaded in total, without buffering fonts
    /// in memory. A stale session cannot write into or complete a newer subtitle selection.
    func fetch(_ fonts: [NSDictionary], media: URL, completion: @escaping (URL?) -> Void) {
        cancel()
        var wanted: [(String, URL)] = []
        for font in fonts.prefix(PorticoMpvFontFetcher.maximumFonts) {
            guard let text = font["url"] as? String, text.utf8.count <= 2048, let url = URL(string: text, relativeTo: media)?.absoluteURL, PorticoMpvSupport.subtitleFileBelongs(url, toMedia: media) else { continue }
            let raw = (font["name"] as? String) ?? "font"
            let safe = String(raw.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "." || $0 == "-" || $0 == "_" }.prefix(80).map(Character.init))
            wanted.append((safe.isEmpty ? "font" : safe, url))
        }
        guard !wanted.isEmpty else { completion(nil); return }
        let directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("portico-mpv-fonts", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) } catch { completion(nil); return }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 20
        let made = URLSession(configuration: configuration, delegate: self, delegateQueue: OperationQueue.main)
        session = made
        folder = directory
        self.completion = completion
        for (position, entry) in wanted.enumerated() {
            let task = made.downloadTask(with: entry.1)
            names[task.taskIdentifier] = "\(position)-\(entry.0)"
            task.resume()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard session === self.session else { return }
        received[downloadTask.taskIdentifier] = totalBytesWritten
        if received.values.reduce(0, +) > Self.maximumBytes || totalBytesExpectedToWrite > Self.maximumBytes {
            session.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard session === self.session, let directory = folder, let name = names[downloadTask.taskIdentifier],
              (downloadTask.response as? HTTPURLResponse)?.statusCode == 200,
              let attributes = try? FileManager.default.attributesOfItem(atPath: location.path),
              let size = attributes[.size] as? NSNumber, size.int64Value > 0, size.int64Value <= Self.maximumBytes else { return }
        // Account for the last chunk even if no progress delegate callback was delivered.
        received[downloadTask.taskIdentifier] = size.int64Value
        guard received.values.reduce(0, +) <= Self.maximumBytes else { return }
        do {
            try FileManager.default.moveItem(at: location, to: directory.appendingPathComponent(name))
            stored += 1
        } catch { }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard session === self.session else { return }
        names[task.taskIdentifier] = nil
        guard names.isEmpty else { return }
        let done = completion
        completion = nil
        self.session = nil
        session.finishTasksAndInvalidate()
        done?(stored > 0 ? folder : nil)
    }

    /// A download's styled track: its attached fonts are files beside the download (`file:` URLs
    /// inside Downloads). mpv reads every file of the folder it is given as a font, so they are
    /// copied, alone, into a fresh folder of their own, on the same budget as a fetch; the
    /// download's folder itself is never handed over. Runs on the main queue; `completion` runs
    /// there with the folder, or nil when no font could be copied.
    func gather(_ fonts: [NSDictionary], completion: @escaping (URL?) -> Void) {
        cancel()
        var wanted: [(String, URL)] = []
        for font in fonts.prefix(PorticoMpvFontFetcher.maximumFonts) {
            guard let text = font["url"] as? String, text.utf8.count <= 2048, let url = URL(string: text), url.isFileURL, PorticoMpvSupport.allowedLocalSource(url) else { continue }
            let raw = (font["name"] as? String) ?? "font"
            let safe = String(raw.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "." || $0 == "-" || $0 == "_" }.prefix(80).map(Character.init))
            wanted.append((safe.isEmpty ? "font" : safe, url))
        }
        guard !wanted.isEmpty else { completion(nil); return }
        let directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("portico-mpv-fonts", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) } catch { completion(nil); return }
        folder = directory
        gathering += 1
        let attempt = gathering
        self.completion = completion
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var total: Int64 = 0
            var copied = 0
            for (position, entry) in wanted.enumerated() {
                guard let size = (try? FileManager.default.attributesOfItem(atPath: entry.1.path))?[.size] as? NSNumber, size.int64Value > 0, total + size.int64Value <= PorticoMpvFontFetcher.maximumBytes else { continue }
                do {
                    try FileManager.default.copyItem(at: entry.1, to: directory.appendingPathComponent("\(position)-\(entry.0)"))
                    total += size.int64Value
                    copied += 1
                } catch { }
            }
            DispatchQueue.main.async {
                guard let self = self, self.gathering == attempt, self.folder == directory else { return }
                let done = self.completion
                self.completion = nil
                done?(copied > 0 ? directory : nil)
            }
        }
    }

    func cancel() {
        gathering += 1
        completion = nil
        session?.invalidateAndCancel()
        session = nil
        names = [:]
        received = [:]
        stored = 0
        if let folder = folder { try? FileManager.default.removeItem(at: folder) }
        folder = nil
    }
}

import Foundation
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

    /// Plain HTTP is for this device and the home network only: localhost, a `.local` name, or a
    /// private or link-local address. The rule the app applies to every server address.
    static func privateHost(_ value: String?) -> Bool {
        guard var host = value?.lowercased(), !host.isEmpty, host.count <= 255 else { return false }
        if host.count > 2, host.hasPrefix("["), host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        if host == "localhost" || host == "::1" { return true }
        if host.hasSuffix(".local") {
            return host.unicodeScalars.allSatisfy { "abcdefghijklmnopqrstuvwxyz0123456789._-".unicodeScalars.contains($0) }
        }
        if host.contains(":") {
            let characters = Array(host)
            guard characters.count >= 5, characters.allSatisfy({ "0123456789abcdef:".contains($0) }), characters[2] != ":", characters[3] != ":", characters[4] == ":" else { return false }
            return host.hasPrefix("fc") || host.hasPrefix("fd") || (host.hasPrefix("fe") && "89ab".contains(characters[2]))
        }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        var numbers: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.count <= 3, !(part.count > 1 && part.hasPrefix("0")), part.allSatisfy({ $0 >= "0" && $0 <= "9" }), let number = Int(part), number <= 255 else { return false }
            numbers.append(number)
        }
        return numbers[0] == 10 || numbers[0] == 127 || (numbers[0] == 192 && numbers[1] == 168) || (numbers[0] == 172 && numbers[1] >= 16 && numbers[1] <= 31) || (numbers[0] == 169 && numbers[1] == 254)
    }

    /// An external subtitle file belongs to the playback when it is on the media's own origin and
    /// under the media's own grant (`/v1/media/<grant>/...`), with no credentials or fragment.
    static func subtitleFileBelongs(_ url: URL, toMedia media: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || (scheme == "http" && privateHost(url.host)),
              scheme == media.scheme?.lowercased(), url.host?.lowercased() == media.host?.lowercased(), (url.port ?? 0) == (media.port ?? 0),
              url.user == nil, url.password == nil, url.fragment == nil else { return false }
        let parts = media.path.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count >= 3, parts[0] == "v1", parts[1] == "media" else { return false }
        return url.path.hasPrefix("/v1/media/\(parts[2])/")
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

    /// The embedded subtitle track a `render` description names: by stream index, else by its
    /// position among the file's own subtitle tracks, else by language (and title when several
    /// share the language). Nil when nothing or more than one track fits.
    static func embeddedSubtitle(_ render: NSDictionary, subtitles: [[String: Any]]) -> Int? {
        let own = subtitles.filter { !(($0["external"] as? Bool) ?? false) }
        if let index = integer(render["streamIndex"], minimum: 0) {
            let found = own.filter { ($0["ff-index"] as? NSNumber)?.intValue == index }
            if found.count == 1 { return trackId(found[0]) }
        }
        if let ordinal = integer(render["ordinal"], minimum: 0), ordinal < own.count {
            return trackId(own[ordinal])
        }
        guard let language = (render["language"] as? String)?.lowercased(), !language.isEmpty, language.count <= 35 else { return nil }
        let wanted = baseLanguage(language)
        var matches = own.filter { baseLanguage((($0["lang"] as? String) ?? "").lowercased()) == wanted }
        if matches.count > 1, let title = render["title"] as? String, !title.isEmpty {
            let titled = matches.filter { (($0["title"] as? String) ?? "").localizedCaseInsensitiveContains(title) || title.localizedCaseInsensitiveContains(($0["title"] as? String) ?? "\u{0}") }
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

    /// The subtitle formats mpv draws itself, by the names the capability document uses.
    static let renderedSubtitleFormats: Set<String> = ["srt", "vtt", "ass", "ssa", "pgs", "sup", "vobsub", "idx", "dvb"]

    // MARK: - Device

    /// The viewer's caption size from the system's Accessibility settings, as a scale on the
    /// engine's own subtitle size (1 when the viewer has not set one).
    static func captionScale() -> Double {
        let size = Double(MACaptionAppearanceGetRelativeCharacterSize(.user, nil))
        return size.isFinite && size > 0 ? min(3, max(0.5, size)) : 1
    }
}

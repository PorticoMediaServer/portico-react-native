import XCTest
@testable import Portico

@MainActor
final class PorticoMpvTests: XCTestCase {
    private let source = URL(string: "https://media.example/v1/media/grant/hls/master.m3u8")!

    private func rewrite(_ text: String) -> String? {
        let data = PorticoMpvSupport.relayPlaylist(Data(text.utf8), source: source) { remote in
            var parts = URLComponents(url: remote, resolvingAgainstBaseURL: false)!
            parts.scheme = "http"
            parts.host = "127.0.0.1"
            parts.port = 12345
            return parts.url
        }
        return data.flatMap { String(data: $0, encoding: .utf8) }
    }

    func testPlaylistReferencesAllUseTheRelay() throws {
        let text = """
        #EXTM3U
        #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio/en.m3u8"
        #EXT-X-KEY:METHOD=AES-128,URI="https://media.example/v1/media/grant/keys/one"
        #EXT-X-MAP:URI="../init.mp4"
        #EXT-X-STREAM-INF:BANDWIDTH=1000000
        /v1/media/grant/hls/video.m3u8
        #EXTINF:6,
        segment.ts?part=1
        """
        let result = try XCTUnwrap(rewrite(text))
        XCTAssertFalse(result.contains("https://"))
        XCTAssertTrue(result.contains("URI=\"http://127.0.0.1:12345/v1/media/grant/hls/audio/en.m3u8\""))
        XCTAssertTrue(result.contains("URI=\"http://127.0.0.1:12345/v1/media/grant/keys/one\""))
        XCTAssertTrue(result.contains("URI=\"http://127.0.0.1:12345/v1/media/grant/init.mp4\""))
        XCTAssertTrue(result.contains("http://127.0.0.1:12345/v1/media/grant/hls/video.m3u8"))
        XCTAssertTrue(result.contains("http://127.0.0.1:12345/v1/media/grant/hls/segment.ts?part=1"))
    }

    func testPlaylistCannotEscapeItsOriginOrGrant() {
        for address in [
            "https://elsewhere.example/v1/media/grant/segment.ts",
            "//elsewhere.example/v1/media/grant/segment.ts",
            "/v1/media/other/segment.ts", "../../../private",
            "file:///private/file", "data:text/plain,hello",
            "https://user:secret@media.example/v1/media/grant/segment.ts",
            "/v1/media/grant/segment.ts#fragment",
        ] {
            XCTAssertNil(rewrite("#EXTM3U\n#EXTINF:6,\n" + address), address)
            XCTAssertNil(rewrite("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"" + address + "\""), address)
        }
    }

    func testMalformedAndOversizedPlaylistsAreRefused() {
        XCTAssertNil(rewrite("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=/v1/media/grant/key"))
        XCTAssertNil(rewrite("#EXTM3U\n#EXT-X-KEY:URI=\"key\",URI=/outside"))
        XCTAssertNil(rewrite("#EXTM3U\n#EXT-X-DEFINE:NAME=\"path\",VALUE=\"outside\""))
        XCTAssertNil(rewrite("#EXTM3U\n{$path}/segment.ts"))
        XCTAssertNil(rewrite("not a playlist"))
        XCTAssertNil(PorticoMpvSupport.relayPlaylist(Data(repeating: 120, count: 2 * 1024 * 1024 + 1), source: source, local: { $0 }))
    }

    func testPublicHTTPKeepsTheOriginAndGrantBoundary() {
        let media = URL(string: "http://media.example/v1/media/grant/file")!
        // Subtitle files and their fonts live beside the media, under the same grant.
        XCTAssertTrue(PorticoMpvSupport.subtitleFileBelongs(URL(string: "http://media.example/v1/media/subtitles/grant/a/1/original.ass")!, toMedia: media))
        XCTAssertTrue(PorticoMpvSupport.subtitleFileBelongs(URL(string: "http://media.example/v1/media/subtitles/grant/a/1/fonts/3")!, toMedia: media))
        XCTAssertFalse(PorticoMpvSupport.subtitleFileBelongs(URL(string: "http://other.example/v1/media/subtitles/grant/a/1/original.ass")!, toMedia: media))
        XCTAssertFalse(PorticoMpvSupport.subtitleFileBelongs(URL(string: "http://media.example/v1/media/subtitles/another-grant/a/1/original.ass")!, toMedia: media))
        XCTAssertFalse(PorticoMpvSupport.subtitleFileBelongs(URL(string: "http://media.example/v1/media/grant/../other/file")!, toMedia: media))
    }

    func testJSONNumbersDoNotAcceptBooleansOrUnsafeIntegers() {
        XCTAssertNil(PorticoMpvSupport.number(NSNumber(value: true)))
        XCTAssertNil(PorticoMpvSupport.boolean(NSNumber(value: 1)))
        XCTAssertNil(PorticoMpvSupport.integer(NSNumber(value: 1.5)))
        XCTAssertNil(PorticoMpvSupport.integer(NSNumber(value: Double.infinity)))
        XCTAssertNil(PorticoMpvSupport.integer(NSNumber(value: 9_007_199_254_740_992.0)))
        XCTAssertEqual(PorticoMpvSupport.integer(NSNumber(value: 0), minimum: 0), 0)
    }

    func testEmbeddedSubtitleMappingRefusesAmbiguousLanguages() {
        let tracks: [[String: Any]] = [
            ["id": 1, "type": "sub", "codec": "ass", "ff-index": 3, "lang": "eng", "title": "Signs"],
            ["id": 2, "type": "sub", "codec": "ass", "ff-index": 4, "lang": "en", "title": "Full"],
            ["id": 3, "type": "sub", "codec": "ass", "external": true, "lang": "en"],
        ]
        XCTAssertNil(PorticoMpvSupport.embeddedSubtitle(["language": "en"], kind: "ass", subtitles: tracks))
        XCTAssertEqual(PorticoMpvSupport.embeddedSubtitle(["language": "en", "title": "Full"], kind: "ass", subtitles: tracks), 2)
        XCTAssertEqual(PorticoMpvSupport.embeddedSubtitle(["streamIndex": 3], kind: "ass", subtitles: tracks), 1)
        XCTAssertNil(PorticoMpvSupport.embeddedSubtitle(["streamIndex": 3], kind: "pgs", subtitles: tracks))
    }

    #if canImport(Libmpv)
    func testCommandsAreFencedByLeaseRevisionAndSeekRetirement() throws {
        let controller = PorticoMpvController()
        defer { controller.invalidate() }
        let lease = try XCTUnwrap(controller.acquire("viewer")?["lease"] as? String)
        XCTAssertNil(controller.acquire("other"))
        let binding: [String: Any] = ["lease": lease, "intentId": 1, "sessionId": "session", "generation": 1, "itemId": "item"]
        var command: [String: Any] = ["binding": binding, "commandRevision": 1, "source": "", "rate": 1, "paused": true]
        XCTAssertNil(controller.accept(command as NSDictionary))
        XCTAssertNil(controller.accept(command as NSDictionary))
        command["paused"] = false
        XCTAssertEqual(controller.accept(command as NSDictionary), "Conflicting playback command.")
        command["commandRevision"] = 2
        command["pendingSeek"] = ["revision": 1, "positionSeconds": 30]
        XCTAssertNil(controller.accept(command as NSDictionary))
        command["commandRevision"] = 3
        command["pendingSeek"] = NSNull()
        XCTAssertNil(controller.accept(command as NSDictionary))
        command["commandRevision"] = 4
        command["pendingSeek"] = ["revision": 1, "positionSeconds": 30]
        XCTAssertEqual(controller.accept(command as NSDictionary), "Conflicting or retired seek command.")
        controller.releaseLease(lease)
        XCTAssertEqual(controller.accept(command as NSDictionary), "Playback lease is no longer active.")
    }
    #endif
}

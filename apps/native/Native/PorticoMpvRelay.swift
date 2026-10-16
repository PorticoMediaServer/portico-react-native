import Foundation
import Network

/// The mpv engine's only way to the network.
///
/// mpv (FFmpeg) has its own HTTP client. On iOS and tvOS that client cannot see the system's
/// trusted certificates, so it would either skip TLS validation or need a certificate file of its
/// own. Instead mpv is only ever given an address on this device (`http://127.0.0.1:<port>/...`),
/// and this relay fetches the real resource with `URLSession`: the same TLS validation, the same
/// App Transport Security rules and the same certificates the rest of the app trusts.
///
/// The relay serves one playback at a time. It forwards a request only when its path lies under
/// the media grant of the source it was bound to (`/v1/media/<grant>/...`). That grant is the
/// capability the server issued for this playback, so another app on the device that does not
/// already hold it gets nothing here. Redirects are refused, as they are for the app's other media
/// fetches. Only GET and HEAD are served.
final class PorticoMpvRelay: NSObject, URLSessionDataDelegate {
    /// What the last failed upstream request said, for the engine's error classification.
    struct Failure {
        /// The upstream HTTP status (400...599), or 0 when there was no answer.
        let httpStatus: Int
        /// The `URLError` code when the request failed without an answer, else nil.
        let urlErrorCode: Int?
        /// `ProcessInfo.systemUptime` when it happened.
        let at: TimeInterval
    }

    private final class Exchange {
        let connection: NWConnection
        var task: URLSessionDataTask?
        var head = Data()
        var answered = false
        var finished = false
        var queuedBytes = 0
        var upstreamSuspended = false
        var playlist: Data?
        var playlistSource: URL?
        init(connection: NWConnection) { self.connection = connection }
    }

    private let queue = DispatchQueue(label: "tv.getportico.mpv.relay", qos: .userInitiated)
    private var listener: NWListener?
    private var session: URLSession?
    private var exchanges: [ObjectIdentifier: Exchange] = [:]
    private var byTask: [Int: Exchange] = [:]
    private var origin: URL?
    private var prefixes: [String] = []
    private var listeningPort: UInt16 = 0
    private var waiters: [(UInt16) -> Void] = []
    private let lock = NSLock()
    private var failure: Failure?

    private static let highWater = 4 * 1024 * 1024
    private static let lowWater = 1024 * 1024
    private static let maximumHead = 16 * 1024

    /// The most recent upstream failure, or nil. Safe from any thread.
    var lastFailure: Failure? {
        lock.lock(); defer { lock.unlock() }
        return failure
    }

    func clearFailure() {
        lock.lock(); failure = nil; lock.unlock()
    }

    private func record(status: Int, urlErrorCode: Int?) {
        lock.lock()
        failure = Failure(httpStatus: status, urlErrorCode: urlErrorCode, at: ProcessInfo.processInfo.systemUptime)
        lock.unlock()
    }

    /// Binds the relay to `source` and answers with the address mpv should open instead, or nil
    /// when the relay could not listen. The completion runs on the main queue.
    func bind(source: URL, completion: @escaping (URL?) -> Void) {
        queue.async {
            guard let scheme = source.scheme?.lowercased(), scheme == "http" || scheme == "https",
                  let host = source.host, !host.isEmpty, source.user == nil, source.password == nil else {
                DispatchQueue.main.async { completion(nil) }
                return
            }
            var components = URLComponents()
            components.scheme = scheme
            components.host = host
            components.port = source.port
            self.origin = components.url
            self.prefixes = PorticoMpvRelay.prefixes(for: source.path)
            self.cancelAll()
            self.ensureListening { port in
                let local = port == 0 ? nil : PorticoMpvRelay.local(source, port: port)
                DispatchQueue.main.async { completion(local) }
            }
        }
    }

    /// The loopback address for another resource of the bound playback (an external subtitle
    /// file), or nil when it is outside the bound scope or the relay is not listening.
    /// Call on the main queue after `bind` completed.
    func localURL(for remote: URL) -> URL? {
        var result: URL?
        queue.sync {
            guard let origin = self.origin, self.listeningPort != 0,
                  remote.scheme?.lowercased() == origin.scheme, remote.host?.lowercased() == origin.host?.lowercased(),
                  (remote.port ?? -1) == (origin.port ?? -1), remote.user == nil, remote.password == nil, remote.fragment == nil,
                  self.allowed(path: remote.path) else { return }
            result = PorticoMpvRelay.local(remote, port: self.listeningPort)
        }
        return result
    }

    /// Ends every transfer and forgets the bound source. The listener stays for the next playback.
    func unbind() {
        queue.async {
            self.origin = nil
            self.prefixes = []
            self.cancelAll()
        }
    }

    /// Stops listening and ends every transfer.
    func stop() {
        queue.async {
            self.origin = nil
            self.prefixes = []
            self.cancelAll()
            self.listener?.cancel()
            self.listener = nil
            self.listeningPort = 0
            self.session?.invalidateAndCancel()
            self.session = nil
        }
    }

    // MARK: - Scope

    private static func prefixes(for path: String) -> [String] {
        let parts = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if parts.count >= 3, parts[0] == "v1", parts[1] == "media" {
            // The media's own files, and the subtitle files and fonts the server keeps under the same grant.
            return ["/v1/media/" + parts[2], "/v1/media/subtitles/" + parts[2]]
        }
        // A non-grant address grants only the source itself, never a whole server folder.
        return [path]
    }

    private static func local(_ remote: URL, port: UInt16) -> URL? {
        guard var components = URLComponents(url: remote, resolvingAgainstBaseURL: false) else { return nil }
        components.scheme = "http"
        components.host = "127.0.0.1"
        components.port = Int(port)
        components.user = nil
        components.password = nil
        components.fragment = nil
        return components.url
    }

    private func allowed(path: String) -> Bool {
        guard path.hasPrefix("/"), !path.contains("\\") else { return false }
        let lowered = path.lowercased()
        if lowered.contains("%2e") || lowered.contains("%2f") || lowered.contains("%5c") { return false }
        for segment in path.split(separator: "/", omittingEmptySubsequences: false) where segment == ".." || segment == "." { return false }
        for prefix in prefixes {
            if path == prefix { return true }
            if prefix.hasPrefix("/v1/media/"), path.hasPrefix(prefix + "/") { return true }
        }
        return false
    }

    // MARK: - Listener

    private func ensureListening(_ ready: @escaping (UInt16) -> Void) {
        if listener != nil, listeningPort != 0 { ready(listeningPort); return }
        waiters.append(ready)
        if listener != nil { return }
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host.ipv4(IPv4Address.loopback), port: NWEndpoint.Port.any)
        parameters.acceptLocalOnly = true
        parameters.allowLocalEndpointReuse = true
        let made: NWListener
        do { made = try NWListener(using: parameters) } catch { finishWaiting(0); return }
        listener = made
        made.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        made.stateUpdateHandler = { [weak self, weak made] state in
            guard let self = self, let made = made, self.listener === made else { return }
            switch state {
            case .ready:
                self.listeningPort = made.port?.rawValue ?? 0
                self.finishWaiting(self.listeningPort)
            case .failed, .cancelled:
                self.listener = nil
                self.listeningPort = 0
                self.finishWaiting(0)
            default:
                break
            }
        }
        made.start(queue: queue)
    }

    private func finishWaiting(_ port: UInt16) {
        let pending = waiters
        waiters = []
        for waiter in pending { waiter(port) }
    }

    private func upstream() -> URLSession {
        if let session = session { return session }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.httpMaximumConnectionsPerHost = 6
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        delegateQueue.underlyingQueue = queue
        let made = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
        session = made
        return made
    }

    // MARK: - One request

    private func accept(_ connection: NWConnection) {
        guard exchanges.count < 16 else { connection.cancel(); return }
        let exchange = Exchange(connection: connection)
        exchanges[ObjectIdentifier(exchange)] = exchange
        connection.stateUpdateHandler = { [weak self, weak exchange] state in
            guard let self = self, let exchange = exchange else { return }
            switch state {
            case .failed, .cancelled:
                self.end(exchange, cancelConnection: false)
            default:
                break
            }
        }
        connection.start(queue: queue)
        readHead(exchange)
        queue.asyncAfter(deadline: .now() + 10) { [weak self, weak exchange] in
            guard let self = self, let exchange = exchange, exchange.task == nil, !exchange.answered else { return }
            self.end(exchange, cancelConnection: true)
        }
    }

    private func readHead(_ exchange: Exchange) {
        exchange.connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self, weak exchange] data, _, isComplete, error in
            guard let self = self, let exchange = exchange, !exchange.finished else { return }
            if let data = data { exchange.head.append(data) }
            guard exchange.head.count <= PorticoMpvRelay.maximumHead else { self.end(exchange, cancelConnection: true); return }
            if let end = exchange.head.range(of: Data([13, 10, 13, 10])) {
                self.route(exchange, head: exchange.head.subdata(in: exchange.head.startIndex..<end.lowerBound))
                return
            }
            if error != nil || isComplete || exchange.head.count > PorticoMpvRelay.maximumHead {
                self.end(exchange, cancelConnection: true)
                return
            }
            self.readHead(exchange)
        }
    }

    private func route(_ exchange: Exchange, head: Data) {
        guard let text = String(data: head, encoding: .utf8) else { reply(exchange, status: 400); return }
        let lines = text.components(separatedBy: "\r\n")
        let request = (lines.first ?? "").split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        guard request.count == 3, request[0] == "GET" || request[0] == "HEAD" else { reply(exchange, status: 405); return }
        let target = request[1]
        guard target.hasPrefix("/"), target.utf8.count <= 8192, let origin = origin else { reply(exchange, status: 404); return }
        let path: String
        if let mark = target.firstIndex(of: "?") { path = String(target[target.startIndex..<mark]) } else { path = target }
        guard allowed(path: path), let url = URL(string: target, relativeTo: origin)?.absoluteURL,
              url.scheme == origin.scheme, url.host?.lowercased() == origin.host?.lowercased(), url.port == origin.port,
              url.user == nil, url.password == nil, url.fragment == nil,
              allowed(path: url.path) else { reply(exchange, status: 404); return }
        var range: String?
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[line.startIndex..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            if name == "range" {
                let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                if value.count <= 128, value.range(of: "^bytes=[0-9]*-[0-9]*$", options: .regularExpression) != nil { range = value }
            }
        }
        var wire = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        wire.httpMethod = request[0]
        wire.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        wire.setValue("*/*", forHTTPHeaderField: "Accept")
        // Rewritten manifests have different byte offsets; always fetch them in full.
        if let range = range, url.pathExtension.lowercased() != "m3u8" { wire.setValue(range, forHTTPHeaderField: "Range") }
        let task = upstream().dataTask(with: wire)
        exchange.task = task
        byTask[task.taskIdentifier] = exchange
        task.resume()
    }

    /// A short answer the relay makes itself (a refusal or an upstream failure), then closes.
    private func reply(_ exchange: Exchange, status: Int) {
        guard !exchange.answered else { end(exchange, cancelConnection: true); return }
        exchange.answered = true
        let head = "HTTP/1.1 \(status) Relay\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        exchange.connection.send(content: head.data(using: .utf8), contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self, weak exchange] _ in
            guard let self = self, let exchange = exchange else { return }
            self.end(exchange, cancelConnection: true)
        })
    }

    private func end(_ exchange: Exchange, cancelConnection: Bool) {
        if exchange.finished { return }
        exchange.finished = true
        if let task = exchange.task {
            byTask[task.taskIdentifier] = nil
            task.cancel()
        }
        exchange.task = nil
        exchanges[ObjectIdentifier(exchange)] = nil
        if cancelConnection { exchange.connection.cancel() }
    }

    private func cancelAll() {
        for exchange in Array(exchanges.values) { end(exchange, cancelConnection: true) }
    }

    // MARK: - URLSession

    /// The server's certificate is checked the way every Portico connection checks it: system
    /// trust, or the owner's certificate pinned for this address (PorticoServerTrust).
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        PorticoServerTrust.handle(challenge, completion: completionHandler)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let exchange = byTask[dataTask.taskIdentifier], !exchange.finished, let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        let status = http.statusCode
        if status >= 300 && status < 400 {
            // A redirect is never followed, and mpv must not follow it on its own either.
            record(status: 502, urlErrorCode: nil)
            completionHandler(.cancel)
            byTask[dataTask.taskIdentifier] = nil
            exchange.task = nil
            reply(exchange, status: 502)
            return
        }
        if status >= 400 { record(status: status, urlErrorCode: nil) }
        let type = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        if status == 200 || status == 206, dataTask.originalRequest?.httpMethod != "HEAD",
           http.url?.pathExtension.lowercased() == "m3u8" || type.contains("mpegurl") {
            guard http.expectedContentLength <= 2 * 1024 * 1024 else {
                refusePlaylist(exchange)
                completionHandler(.cancel)
                return
            }
            exchange.playlist = Data()
            exchange.playlistSource = http.url
            completionHandler(.allow)
            return
        }
        var head = "HTTP/1.1 \(status) Relay\r\n"
        for name in ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"] {
            if let value = http.value(forHTTPHeaderField: name), value.utf8.count <= 1024, !value.contains("\r"), !value.contains("\n") {
                head += "\(name): \(value)\r\n"
            }
        }
        head += "Connection: close\r\n\r\n"
        exchange.answered = true
        exchange.connection.send(content: head.data(using: .utf8), completion: .contentProcessed { [weak self, weak exchange] error in
            guard let self = self, let exchange = exchange, error != nil else { return }
            self.end(exchange, cancelConnection: true)
        })
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let exchange = byTask[dataTask.taskIdentifier], !exchange.finished else { return }
        if exchange.playlist != nil {
            guard (exchange.playlist?.count ?? 0) + data.count <= 2 * 1024 * 1024 else { refusePlaylist(exchange); return }
            exchange.playlist?.append(data)
            return
        }
        let count = data.count
        exchange.queuedBytes += count
        // mpv stops reading when its cache is full; the upstream transfer waits with it.
        if exchange.queuedBytes > PorticoMpvRelay.highWater, !exchange.upstreamSuspended {
            exchange.upstreamSuspended = true
            dataTask.suspend()
        }
        exchange.connection.send(content: data, completion: .contentProcessed { [weak self, weak exchange] error in
            guard let self = self, let exchange = exchange, !exchange.finished else { return }
            if error != nil { self.end(exchange, cancelConnection: true); return }
            exchange.queuedBytes -= count
            if exchange.upstreamSuspended, exchange.queuedBytes < PorticoMpvRelay.lowWater {
                exchange.upstreamSuspended = false
                exchange.task?.resume()
            }
        })
    }

    private func refusePlaylist(_ exchange: Exchange) {
        record(status: 502, urlErrorCode: nil)
        if let task = exchange.task { byTask[task.taskIdentifier] = nil; task.cancel() }
        exchange.task = nil
        reply(exchange, status: 502)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let exchange = byTask[task.taskIdentifier] else { return }
        byTask[task.taskIdentifier] = nil
        exchange.task = nil
        if exchange.finished { return }
        if let error = error {
            let code = (error as NSError).domain == NSURLErrorDomain ? (error as NSError).code : nil
            if code != NSURLErrorCancelled { record(status: 0, urlErrorCode: code ?? NSURLErrorUnknown) }
            if !exchange.answered { reply(exchange, status: 502); return }
            // The body was cut short: closing here lets mpv ask again from where it stopped.
            end(exchange, cancelConnection: true)
            return
        }
        if let playlist = exchange.playlist {
            guard let source = exchange.playlistSource,
                  let body = PorticoMpvSupport.relayPlaylist(playlist, source: source, local: { remote in
                      guard let origin = self.origin, self.allowed(path: remote.path),
                            remote.scheme == origin.scheme, remote.host?.lowercased() == origin.host?.lowercased(), remote.port == origin.port else { return nil }
                      return PorticoMpvRelay.local(remote, port: self.listeningPort)
                  }) else { refusePlaylist(exchange); return }
            let head = "HTTP/1.1 200 Relay\r\nContent-Type: application/vnd.apple.mpegurl\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
            exchange.answered = true
            exchange.connection.send(content: (head.data(using: .utf8) ?? Data()) + body, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self, weak exchange] _ in
                guard let self = self, let exchange = exchange else { return }
                self.end(exchange, cancelConnection: true)
            })
            return
        }
        exchange.connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self, weak exchange] _ in
            guard let self = self, let exchange = exchange else { return }
            self.end(exchange, cancelConnection: true)
        })
    }
}

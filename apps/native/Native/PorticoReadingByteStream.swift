import Foundation

private actor ReadingByteBody {
    private var iterator: URLSession.AsyncBytes.AsyncIterator
    private var eof = false

    init(_ bytes: URLSession.AsyncBytes) { iterator = bytes.makeAsyncIterator() }

    func read() async throws -> (Data, Bool) {
        if eof { return (Data(), true) }
        var current = iterator
        var data = Data(capacity: 49_152)
        while data.count < 49_152 {
            guard let byte = try await current.next() else { eof = true; break }
            data.append(byte)
        }
        iterator = current
        return (data, eof)
    }
}

/** The task delegate forwards the existing certificate policy and never redirects.
 * Callback state belongs to the queue request and is protected by that request's lock. */
private final class ReadingBytePolicy: NSObject, URLSessionTaskDelegate {
    let attached: (URLSessionTask) -> Void
    let failure: (Error) -> Void
    init(attached: @escaping (URLSessionTask) -> Void, failure: @escaping (Error) -> Void) {
        self.attached = attached; self.failure = failure
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        attached(task)
        PorticoServerTrust.handle(challenge, completion: completionHandler)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        attached(task); completionHandler(nil)
        failure(NSError(domain: "PorticoReadingStream", code: 1, userInfo: [NSLocalizedDescriptionKey: "network_stream_redirect"]))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { attached(task); failure(error) }
    }
}

/** No independent client: this driver receives the queue's session and captured request.
 * Own data is at most one 48KiB pull; task cancellation also covers opening headers. */
@objc(PorticoReadingByteStream)
final class PorticoReadingByteStream: NSObject, PorticoReadingStreamDriver {
    private let lock = NSLock()
    private var closed = false
    private var opening: Task<Void, Never>?
    private var reading: Task<Void, Never>?
    private var body: ReadingByteBody?
    private var task: URLSessionTask?
    private var policy: ReadingBytePolicy?
    private var readPending = false

    private func locked<T>(_ operation: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }; return operation()
    }

    func open(session: URLSession, request: URLRequest, attached: @escaping (URLSessionTask) -> Void,
              headers: @escaping (HTTPURLResponse) -> Void, failure: @escaping (Error) -> Void) {
        locked {
            guard !closed, opening == nil else { return }
            let policy = ReadingBytePolicy(attached: attached, failure: failure)
            self.policy = policy
            opening = Task { [weak self] in
                guard let self else { return }
                do {
                    let (bytes, response) = try await session.bytes(for: request, delegate: policy)
                    guard let http = response as? HTTPURLResponse else {
                        bytes.task.cancel()
                        throw NSError(domain: "PorticoReadingStream", code: 2, userInfo: [NSLocalizedDescriptionKey: "network_stream_response_invalid"])
                    }
                    let current = self.locked {
                        guard !self.closed else { return false }
                        self.task = bytes.task; self.body = ReadingByteBody(bytes); return true
                    }
                    guard current else { bytes.task.cancel(); return }
                    attached(bytes.task); headers(http)
                } catch {
                    if !self.locked({ self.closed }) { failure(error) }
                }
            }
        }
    }

    func read(completion: @escaping (Data?, Bool, Error?) -> Void) {
        let active = locked { () -> ReadingByteBody? in
            guard !closed, !readPending, let body else { return nil }
            readPending = true; return body
        }
        guard let active else {
            completion(nil, false, NSError(domain: "PorticoReadingStream", code: 3, userInfo: [NSLocalizedDescriptionKey: "network_stream_retired"]))
            return
        }
        let pending = Task { [weak self] in
            guard let self else { return }
            do {
                let (data, eof) = try await active.read()
                let current = self.locked { self.readPending = false; return !self.closed }
                if current { completion(data, eof, nil) }
            } catch {
                let current = self.locked { self.readPending = false; return !self.closed }
                if current { completion(nil, false, error) }
            }
        }
        locked { if closed { pending.cancel() } else { reading = pending } }
    }

    func cancel() {
        let pending = locked { () -> (Task<Void, Never>?, Task<Void, Never>?, URLSessionTask?) in
            closed = true; let pending = (opening, reading, task)
            opening = nil; reading = nil; task = nil; body = nil; return pending
        }
        pending.0?.cancel(); pending.1?.cancel(); pending.2?.cancel()
    }
}

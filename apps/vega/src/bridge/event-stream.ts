import {base64, utf8} from './encoding';
import {failure} from './events';
import {parseHeaders, redirected, sdkRequestAllowed} from './transport';

/**
 * `PorticoRuntime.openNetworkStream`, `readNetworkStream` and `cancelNetworkStream`: the server's
 * event streams (the device's one feed of changes, and a Watch Together room's), read a piece at
 * a time by the shared `bridge/event-stream.ts`. The rules are the Apple and Android modules':
 *
 * - Only `GET /v1/events` (the device's one event feed) and `GET /v1/groups/<id>/events`, on `http` or `https`,
 *   with no credentials in the address. At most four streams at once.
 * - `open` answers `{status, headers}` once the response has begun. A redirect is refused.
 * - `read` answers `{done: false, data}` (base64, at most 16 KiB) or `{done: true}`. One read at
 *   a time. A stream is ended, as done, after 1 MiB or 35 minutes: its owner opens the next one
 *   from the last event it saw, exactly as after any dropped connection.
 * - Rejection codes: `event_local` (a bad request, too many streams, a read out of turn),
 *   `event_transport` (the connection could not be opened or broke), `event_timeout` (an open
 *   stream went quiet for a minute), `event_redirect`, `event_cancelled`.
 *
 * There is no streaming socket in the SDK's JavaScript. An `XMLHttpRequest` does deliver text as
 * it arrives, and the text it holds only ever grows, which is what the 1 MiB bound is for here.
 * Credential-bearing streams are refused before dispatch because the SDK follows redirects.
 */
const MAX_STREAMS = 4, PIECE_BYTES = 16384, MAX_BYTES = 1048576;
const OPEN_MS = 15000, QUIET_MS = 60000, LIFETIME_MS = 2100000;
const groupEvents = /^\/v1\/groups\/[A-Za-z0-9_-]{1,128}\/events$/;

type Piece = {done: boolean; data?: string};
type Waiting = {resolve(piece: Piece): void; reject(error: Error): void};
type Stream = {
  xhr: XMLHttpRequest;
  /** The response has begun and `open` has answered. */
  begun: boolean;
  /** Characters of the response text already cut into pieces. */
  seen: number;
  received: number;
  pieces: Uint8Array[];
  /** Nothing more will arrive: `problem` says why when it was not an orderly end. */
  ended: boolean;
  problem?: Error;
  reading?: Waiting;
  timers: ReturnType<typeof setTimeout>[];
  quiet?: ReturnType<typeof setTimeout>;
};

const streams = new Map<string, Stream>();

function allowed(url: unknown): URL | null {
  if (typeof url !== 'string' || url.length > 8192 || url.includes('#')) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)) return null;
  return parsed.pathname === '/v1/events' || groupEvents.test(parsed.pathname) ? parsed : null;
}

function release(identifier: string, stream: Stream): void {
  if (streams.get(identifier) === stream) streams.delete(identifier);
  for (const timer of stream.timers) clearTimeout(timer);
  if (stream.quiet) clearTimeout(stream.quiet);
  try { stream.xhr.abort(); } catch { /* already finished */ }
}

/** Hands the reader what it is waiting for, if that is now known. */
function deliver(identifier: string, stream: Stream): void {
  const reading = stream.reading;
  if (!reading) return;
  const piece = stream.pieces.shift();
  if (piece) { stream.reading = undefined; reading.resolve({done: false, data: base64(piece)}); return; }
  if (!stream.ended) return;
  stream.reading = undefined;
  release(identifier, stream);
  if (stream.problem) reading.reject(stream.problem); else reading.resolve({done: true});
}

function end(identifier: string, stream: Stream, problem?: Error): void {
  if (stream.ended) return;
  stream.ended = true;
  stream.problem = problem;
  // What was already received is not handed on after a failure: the reader starts again.
  if (problem) stream.pieces = [];
  try { stream.xhr.abort(); } catch { /* already finished */ }
  deliver(identifier, stream);
}

/** Cuts what has newly arrived into pieces the reader takes one at a time. */
function take(identifier: string, stream: Stream): void {
  if (stream.ended) return;
  const text = String(stream.xhr.responseText ?? '');
  if (text.length <= stream.seen) return;
  const bytes = utf8(text.slice(stream.seen));
  stream.seen = text.length;
  stream.received += bytes.length;
  for (let at = 0; at < bytes.length; at += PIECE_BYTES) stream.pieces.push(bytes.subarray(at, Math.min(bytes.length, at + PIECE_BYTES)));
  if (stream.quiet) clearTimeout(stream.quiet);
  stream.quiet = setTimeout(() => end(identifier, stream, failure('event_timeout', 'The event connection was interrupted.')), QUIET_MS);
  if (stream.received > MAX_BYTES) { stream.pieces = []; end(identifier, stream); return; }
  deliver(identifier, stream);
}

export function openNetworkStream(identifier: string, url: string, headers: unknown): Promise<{status: number; headers: Record<string, string>}> {
  const target = allowed(url);
  if (target && !sdkRequestAllowed(url, 'GET', headers, null)) return Promise.reject(failure('transport_unavailable', 'The installed transport cannot refuse redirects before sending credentials.'));
  if (!target || typeof identifier !== 'string' || !identifier || identifier.length > 128) return Promise.reject(failure('event_local', 'Invalid event request.'));
  if (streams.size >= MAX_STREAMS || streams.has(identifier)) return Promise.reject(failure('event_local', 'Too many event streams.'));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const stream: Stream = {xhr, begun: false, seen: 0, received: 0, pieces: [], ended: false, timers: []};
    streams.set(identifier, stream);
    const refuse = (code: string, message: string) => { release(identifier, stream); stream.ended = true; reject(failure(code, message)); };
    const begin = () => {
      if (stream.begun || stream.ended || streams.get(identifier) !== stream) return;
      if (redirected(url, xhr.responseURL) || (xhr.status >= 300 && xhr.status <= 399)) { refuse('event_redirect', 'Event redirects are not allowed.'); return; }
      stream.begun = true;
      stream.quiet = setTimeout(() => end(identifier, stream, failure('event_timeout', 'The event connection was interrupted.')), QUIET_MS);
      resolve({status: xhr.status, headers: parseHeaders(xhr.getAllResponseHeaders())});
    };
    // No response has begun, so a silence here is a route that does not answer.
    stream.timers.push(setTimeout(() => { if (!stream.begun) refuse('event_transport', 'The event connection could not be opened.'); }, OPEN_MS));
    stream.timers.push(setTimeout(() => end(identifier, stream), LIFETIME_MS));
    xhr.open('GET', url);
    xhr.withCredentials = false;
    xhr.responseType = 'text';
    if (headers && typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers as Record<string, unknown>)) if (typeof value === 'string') xhr.setRequestHeader(key, value);
    }
    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2) begin();
      if (stream.begun && xhr.readyState >= 3) take(identifier, stream);
      if (stream.begun && xhr.readyState === 4) end(identifier, stream);
    };
    xhr.onprogress = () => { if (stream.begun) take(identifier, stream); };
    xhr.onerror = () => {
      if (!stream.begun) { if (!stream.ended) refuse('event_transport', 'The event connection could not be opened.'); return; }
      end(identifier, stream, failure('event_transport', 'The event connection was interrupted.'));
    };
    xhr.ontimeout = xhr.onerror;
    try { xhr.send(); } catch { refuse('event_transport', 'The event connection could not be opened.'); }
  });
}

export function readNetworkStream(identifier: string): Promise<Piece> {
  const stream = streams.get(identifier);
  if (!stream || !stream.begun || stream.reading) return Promise.reject(failure('event_local', 'The event stream is unavailable.'));
  return new Promise((resolve, reject) => {
    stream.reading = {resolve, reject};
    deliver(identifier, stream);
  });
}

export function cancelNetworkStream(identifier: string): void {
  const stream = streams.get(identifier);
  if (!stream) return;
  const reading = stream.reading;
  stream.reading = undefined;
  stream.ended = true;
  release(identifier, stream);
  reading?.reject(failure('event_cancelled', 'The event stream was cancelled.'));
}

/** How many streams are open (for tests). */
export const openStreamCount = (): number => streams.size;

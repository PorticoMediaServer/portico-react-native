import {failure} from './events';

/**
 * The bounded control transport behind `PorticoRuntime.networkRequest`, `queueRequest` and
 * `profileRequest`, with the Apple module's rules: no cookies, no cache, 15 s, a bounded body
 * each way, at most 12 requests in flight and 64 waiting, and no redirects.
 *
 * The SDK's networking follows redirects itself and offers no way to refuse one before it is
 * followed, so a redirect is refused when the answer arrives (the final address is not the one
 * asked for): the response is discarded, never delivered.
 */
export type WireResponse = {status: number; headers: Record<string, string>; body: string};
type Settle = {resolve(value: WireResponse): void; reject(error: Error): void};
type Pending = Settle & {identifier: string; domain: string; url: string; method: string; headers: Record<string, string>; body: string | null; limit: number; xhr?: XMLHttpRequest; started: boolean; done: boolean};

const MAX_ACTIVE = 12, MAX_WAITING = 64, TIMEOUT_MS = 15000;
const requests = new Map<string, Pending>();
const waiting: Pending[] = [];
let active = 0;

export type Admission = {identifier: string; url: string; method: string; headers: unknown; body: string | null; limit: number; domain: string; busy: string};

export function submit(admission: Admission): Promise<WireResponse> {
  return new Promise((resolve, reject) => {
    const {identifier, domain} = admission;
    if (requests.has(identifier) || (active >= MAX_ACTIVE && waiting.length >= MAX_WAITING)) { reject(failure(domain, admission.busy)); return; }
    const headers: Record<string, string> = {};
    if (admission.headers && typeof admission.headers === 'object') {
      for (const [key, value] of Object.entries(admission.headers as Record<string, unknown>)) if (typeof value === 'string') headers[key] = value;
    }
    const pending: Pending = {identifier, domain, url: admission.url, method: admission.method, headers, body: admission.body, limit: admission.limit, resolve, reject, started: false, done: false};
    requests.set(identifier, pending);
    if (active < MAX_ACTIVE) start(pending); else waiting.push(pending);
  });
}

export function cancel(identifier: string): void {
  const pending = requests.get(identifier);
  if (pending) finish(pending, 'Queue request cancelled.');
}

/**
 * A request that asks the server to hold it (`waitSeconds`, the events long poll) is given that
 * long and a margin; every other request has the Apple module's 15 s. Without this each quiet
 * poll ended as a transport failure, which the player took for a lost route: it paused and
 * resumed whatever was playing, every 15 s.
 */
function limitFor(url: string): number {
  const asked = /[?&]waitSeconds=(\d{1,2})(&|$)/.exec(url);
  return asked ? Math.max(TIMEOUT_MS, (Number(asked[1]) + 10) * 1000) : TIMEOUT_MS;
}

/** Bytes of `text` as UTF-8, without building the encoding. */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

function start(pending: Pending): void {
  pending.started = true;
  active++;
  const xhr = new XMLHttpRequest();
  pending.xhr = xhr;
  xhr.open(pending.method, pending.url);
  xhr.timeout = limitFor(pending.url);
  xhr.withCredentials = false;
  xhr.responseType = 'text';
  for (const [key, value] of Object.entries(pending.headers)) xhr.setRequestHeader(key, value);
  const over = () => {
    const declared = Number(xhr.getResponseHeader('Content-Length'));
    return (Number.isFinite(declared) && declared > pending.limit) || (xhr.responseText?.length ?? 0) > pending.limit;
  };
  xhr.onreadystatechange = () => {
    if (xhr.readyState >= 2 && !pending.done && over()) finish(pending, 'Queue response exceeded its limit.');
  };
  xhr.onprogress = () => { if (over()) finish(pending, 'Queue response exceeded its limit.'); };
  xhr.onerror = () => finish(pending, 'The queue request could not be confirmed.');
  xhr.ontimeout = () => finish(pending, 'The queue request could not be confirmed.');
  xhr.onabort = () => finish(pending, 'Queue request cancelled.');
  xhr.onload = () => {
    if (redirected(pending.url, xhr.responseURL)) { finish(pending, 'Queue control redirects are not allowed.'); return; }
    const body = xhr.responseText ?? '';
    if (utf8Length(body) > pending.limit) { finish(pending, 'Queue response exceeded its limit.'); return; }
    finish(pending, undefined, {status: xhr.status, headers: parseHeaders(xhr.getAllResponseHeaders()), body});
  };
  try { xhr.send(pending.body ?? undefined); } catch { finish(pending, 'The queue request could not be confirmed.'); }
}

function finish(pending: Pending, problem?: string, response?: WireResponse): void {
  if (pending.done) return;
  pending.done = true;
  if (requests.get(pending.identifier) === pending) requests.delete(pending.identifier);
  if (!pending.started) {
    const at = waiting.indexOf(pending);
    if (at >= 0) waiting.splice(at, 1);
  } else {
    active = Math.max(0, active - 1);
    if (problem) { try { pending.xhr?.abort(); } catch { /* already finished */ } }
    while (active < MAX_ACTIVE && waiting.length) start(waiting.shift()!);
  }
  if (problem || !response) pending.reject(failure(pending.domain, problem ?? 'Invalid queue response.'));
  else pending.resolve(response);
}

/** True when the response came from somewhere other than the address that was asked for. */
function redirected(asked: string, answered: string | undefined | null): boolean {
  if (!answered) return false;
  try {
    const a = new URL(asked), b = new URL(answered);
    return a.protocol !== b.protocol || a.host !== b.host || a.pathname !== b.pathname || a.search !== b.search;
  } catch {
    return true;
  }
}

function parseHeaders(raw: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of (raw ?? '').split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim(), value = line.slice(at + 1).trim();
    headers[key] = key in headers ? `${headers[key]}, ${value}` : value;
  }
  return headers;
}

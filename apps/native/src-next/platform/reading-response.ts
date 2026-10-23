import {routes, type RouteId} from '../../../../packages/contracts/src/routes';
import {routeBytes, RouteError} from '../../../../packages/client-core/src/route-identity';

const operations = new Set<RouteId>(['get_reading_items', 'get_items_itemId_reading_versions', 'post_reading_sessions',
  'get_reading_sessions_sessionId_progress', 'put_reading_sessions_sessionId_progress', 'delete_reading_sessions_sessionId',
  'head_reading_sessions_sessionId_source', 'get_reading_sessions_sessionId_source', 'get_reading_sessions_sessionId_assets', 'get_reading_sessions_sessionId_pages_pageIndex']);
const compiled = routes.filter(route => operations.has(route.id)).map(route => ({...route,
  pattern: new RegExp('^' + route.path.split(/(\{[^}]+\})/).map(part => part.startsWith('{') ? '[A-Za-z0-9_-]{1,128}' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$')}));
const binary = new Map<RouteId, number>([['head_reading_sessions_sessionId_source', 65536], ['get_reading_sessions_sessionId_source', 65536],
  ['get_reading_sessions_sessionId_assets', 32 * 1024 * 1024], ['get_reading_sessions_sessionId_pages_pageIndex', 16 * 1024 * 1024]]);
/** Generated route identities select the local byte adapter, never an arbitrary URL. */
export function nativeReadingPolicy(url: string, method: string): Readonly<{binaryLimit?: number}> | undefined {
  const path = new URL(url).pathname, operation = compiled.find(route => route.method === method && route.pattern.test(path));
  return operation ? {binaryLimit: binary.get(operation.id)} : undefined;
}
type NativeReply = Readonly<{status: number; headers: Record<string, string>; body?: string; bodyBase64?: string}>;
const invalid = () => new RouteError('invalid_response', 'Invalid native Reading response.');

/** A bounded body reader on this response only. Hermes's ordinary fetch Response
 * has no ReadableStream body; the captured facade still consumes actual bytes
 * using its exact-length/MIME/revision checks. No global stream/Response patch. */
export function nativeReadingResponse(raw: NativeReply, binaryLimit: number | undefined, signal?: AbortSignal): Response {
  if (signal?.aborted) throw new RouteError('cancelled', 'Connection request cancelled.');
  let bytes: Uint8Array;
  if (binaryLimit !== undefined) {
    const text = raw.bodyBase64;
    if (typeof text !== 'string' || text.length > Math.ceil(binaryLimit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw invalid();
    bytes = text ? routeBytes(text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), undefined, binaryLimit) : new Uint8Array();
  } else {
    if (typeof raw.body !== 'string' || raw.body.length > 2 * 1024 * 1024) throw invalid();
    bytes = new TextEncoder().encode(raw.body);
    if (bytes.length > 2 * 1024 * 1024) throw invalid();
  }
  const empty = [204, 205, 304].includes(raw.status);
  if (empty && bytes.length) throw invalid();
  const response = new Response(empty ? null : bytes, {status: raw.status, headers: raw.headers});
  if (empty) return response;
  let data: Uint8Array | undefined = bytes, offset = 0, locked = false, used = false;
  const cancel = () => {data = undefined; signal?.removeEventListener('abort', cancel);};
  signal?.addEventListener('abort', cancel, {once: true});
  const body = {
    get locked() {return locked;},
    async cancel() {cancel();},
    getReader() {
      if (locked) throw invalid(); locked = true;
      let released = false;
      return {
        async read() {
          if (released) throw invalid();
          if (signal?.aborted) throw new RouteError('cancelled', 'Connection request cancelled.');
          used = true;
          if (!data || offset === data.length) {cancel(); return {done: true as const, value: undefined};}
          const value = data.slice(offset, offset + 65536); offset += value.length;
          return {done: false as const, value};
        },
        async cancel() {cancel();},
        releaseLock() {released = true; locked = false; cancel();},
      };
    },
  };
  Object.defineProperties(response, {body: {value: body}, bodyUsed: {get: () => used}});
  return response;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpLocalApi, ReadingError, type Viewer} from '../../../packages/client-core/src';
import {routePath} from '../../../packages/contracts/src/routes';
import {nativeReadingPolicy, nativeReadingResponse} from '../src-next/platform/reading-response';
import {nativeServerFetch} from '../src-next/platform/server-connections';
import {NativeModules} from './react-native-stub.mjs';

const origin = 'http://127.0.0.1:39129', revision = 'a'.repeat(64);
const viewer: Viewer = {accountId: 'a', profileId: 'p', serverId: 's', authority: 'local', role: 'member'};
test('canonical byte operations alone select exact bounds and other Reading controls retain JSON', () => {
  for (const [path, method, limit] of [
    [routePath('head_reading_sessions_sessionId_source', {sessionId: 'session'}), 'HEAD', 65536],
    [routePath('get_reading_sessions_sessionId_source', {sessionId: 'session'}), 'GET', 65536],
    [routePath('get_reading_sessions_sessionId_assets', {sessionId: 'session'}), 'GET', 33554432],
    [routePath('get_reading_sessions_sessionId_pages_pageIndex', {sessionId: 'session', pageIndex: 0}), 'GET', 16777216],
  ] as const) {
    assert.equal(nativeReadingPolicy(origin + path, method, method === 'GET' && path.endsWith('/source') ? {Range: 'bytes=0-9'} : undefined)?.binaryLimit, limit);
    assert.equal(nativeReadingPolicy(origin + path, 'PATCH'), undefined);
  }
  assert.deepEqual(nativeReadingPolicy(origin + routePath('post_reading_sessions'), 'POST'), {binaryLimit: undefined});
  assert.equal(nativeReadingPolicy(origin + '/v1/items/other', 'GET'), undefined);
  assert.deepEqual(nativeReadingPolicy(origin + routePath('get_reading_sessions_sessionId_source', {sessionId: 'session'}), 'GET'), {sequential: true});
});
test('actual captured facade consumes non-UTF8 PDF bytes through native byte exchange and local body reader', async t => {
  const runtime = NativeModules.PorticoRuntime as Record<string, unknown>;
  const before = {request: runtime.networkRequest, bytes: runtime.networkBytesRequest};
  t.after(() => {runtime.networkRequest = before.request; runtime.networkBytesRequest = before.bytes;});
  const data = Uint8Array.from({length: 100003}, (_, index) => index % 256), calls: string[] = [];
  runtime.networkRequest = async (_id: string, url: string, method: string, headers: Record<string, string>) => {
    calls.push(method); assert.equal(new Headers(headers).get('Authorization'), 'Bearer throwaway-test-token');
    const value = method === 'POST' ? {sessionId: 'session', itemId: 'item', sourceId: 'source', revision, format: 'pdf', size: data.length, metadata: {title: 'Stored title'}} : {progress: null};
    return {status: method === 'DELETE' ? 204 : 200, headers: {'Content-Type': 'application/json', ETag: `"${revision}"`}, body: method === 'DELETE' ? '' : JSON.stringify(value)};
  };
  runtime.networkBytesRequest = async (_id: string, url: string, method: string, headers: Record<string, string>, limit: number) => {
    calls.push(method); assert.equal(limit, 65536); const h = new Headers(headers);
    assert.equal(h.get('Authorization'), 'Bearer throwaway-test-token'); assert.equal(h.get('If-Match'), `"${revision}"`);
    assert.equal(new URL(url).pathname, routePath('get_reading_sessions_sessionId_source', {sessionId: 'session'}));
    const range = /^bytes=(\d+)-(\d+)$/.exec(h.get('Range') ?? '');
    const body = method === 'HEAD' ? new Uint8Array() : data.slice(Number(range![1]), Number(range![2]) + 1);
    return {status: method === 'HEAD' ? 200 : 206, headers: {'Content-Type': 'application/pdf', ETag: `"${revision}"`, 'Accept-Ranges': 'bytes',
      'Content-Length': String(method === 'HEAD' ? data.length : body.length), ...(range ? {'Content-Range': `bytes ${range[1]}-${range[2]}/${data.length}`} : {})}, bodyBase64: Buffer.from(body).toString('base64')};
  };
  const api = new HttpLocalApi(origin, 'throwaway-test-token', nativeServerFetch('s'));
  const client = api.reading({viewer, isCurrent: () => true});
  assert.equal(calls.length, 0);
  const session = await client.open({itemId: 'item', sourceId: 'source'});
  await session.headPDF();
  const bytes = await session.readRange({start: 200, endExclusive: 65000});
  assert.deepEqual(bytes, data.slice(200, 65000)); assert.ok(bytes.includes(255));
  assert.equal((await session.progress()).progress, null);
  await session.close(); client.dispose(); assert.deepEqual(calls, ['POST', 'HEAD', 'GET', 'GET', 'DELETE']);
});
test('local response rejects bad base64/overflow and cancellation before reading, without a global patch', async () => {
  const responseBefore = globalThis.Response, streamsBefore = globalThis.ReadableStream;
  const raw = {status: 200, headers: {}, bodyBase64: Buffer.from([0, 255, 128]).toString('base64')};
  const caller = new AbortController(), response = nativeReadingResponse(raw, 3, caller.signal);
  const reader = response.body!.getReader(); assert.deepEqual((await reader.read()).value, Uint8Array.of(0, 255, 128));
  caller.abort(); await assert.rejects(reader.read(), /cancelled/i); reader.releaseLock();
  assert.throws(() => nativeReadingResponse(raw, 2));
  assert.throws(() => nativeReadingResponse({...raw, bodyBase64: '???'}, 3));
  assert.throws(() => nativeReadingResponse(raw, 3, caller.signal));
  assert.equal(globalThis.Response, responseBefore); assert.equal(globalThis.ReadableStream, streamsBefore);
});

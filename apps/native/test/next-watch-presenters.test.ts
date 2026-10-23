import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpLocalApi} from '../../../packages/client-core/src/index.ts';
import {NativeWatchPresenters} from '../src-next/screens/watch/presenters.ts';
import {NativeScreenServices} from '../src-next/screens/screen-services.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {parseOptions} from '../../../packages/client-core/src/playback-v1/types.ts';
import {readNativeFileInfo} from '../src-next/screens/watch/file-info.ts';
import {NativeShellNavigation} from '../src-next/shell/routes.ts';
import type {NativeShellBootstrapContext} from '../src-next/shell/bootstrap.ts';

const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'};
const entry = {id: 'movie', kind: 'movie' as const, title: 'Real title', displayTitle: 'Real title: Edition', libraryId: 'library'};
const file = {id: 'asset', path: '/actual/asset.mkv', available: true, container: 'mkv', size: 1024, duration: 60, audio: [], subtitles: []};
const page = {scope: {serverId: 'server', libraryId: 'library', itemId: 'movie', viewerFence: 'viewer'}, revision: {catalog: 2, viewer: 3}, kind: 'movie', files: [file], manage: {delete: true, split: true, merge: true}};
const offered = parseOptions({itemId: 'movie', versions: [{id: 'asset', parts: [{id: 'asset', index: 0, durationMs: 60000}], durationMs: 60000, sizeBytes: 1024, video: [], audio: [], subtitles: []}]});
const deferred = <T,>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};};
async function fixture() {
  let active = true, changed = 0, respond = async (_path: string, _method: string) => page as unknown;
  const calls: {path: string; method: string; body: unknown; signal?: AbortSignal | null}[] = [];
  const listeners = new Set<() => void>();
  const api = new HttpLocalApi('https://portico.test', '', async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET';
    calls.push({path: url.pathname + url.search, method, body: init?.body && JSON.parse(String(init.body)), signal: init?.signal});
    return new Response(JSON.stringify(await respond(url.pathname, method)), {status: 200});
  });
  const navigation = new NativeShellNavigation(authority);
  navigation.open({kind: 'title', entry}, authority);
  const owner = {api, navigation, current: () => active, authority: () => authority, subscribeAuthority: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};}};
  const common = new NativeScreenServices(owner, async () => '11111111-1111-4111-8111-111111111111');
  const context = {...owner, session: () => ({viewer: {...authority, authority: 'local'}}), playback: {getSnapshot: () => ({fence: undefined}), subscribe: () => () => {}}} as unknown as NativeShellBootstrapContext;
  const presenters = new NativeWatchPresenters(context, common);
  const capture = {entry, authority, routeRevision: navigation.getSnapshot().revision, expectedFence: undefined, current: () => active};
  const info = await readNativeFileInfo(api, {serverId: 'server', viewerId: 'viewer'}, {libraryId: 'library', itemId: 'movie'}, offered, {t: defaultI18n.t}, false, new AbortController().signal);
  const fileInfo = async () => {presenters.openFileInfo(capture, 'real content', {info, changed: async () => {changed++;}});};
  presenters.openMenu(capture, {fileInfo});
  await presenters.fileInfo(presenters.getSnapshot()!);
  return {presenters, common, capture, info, calls, changed: () => changed,
    respond: (next: typeof respond) => {respond = next;}, retire: () => {active = false; for (const listener of listeners) listener();}, navigation,
    dispose: () => {presenters.dispose(); common.dispose();}};
}

test('committed menu close preserves its real File info destination; dismissal and navigation retire it', async () => {
  const d = await fixture();
  try {
    assert.equal(d.presenters.getSnapshot()?.phase, 'file-info');
    assert.equal(d.presenters.getSnapshot()?.owner?.info.files[0]?.id, 'asset');
    d.presenters.close();
    d.presenters.openFileInfo(d.capture, 'late', {info: d.info, changed: async () => {}});
    assert.equal(d.presenters.getSnapshot(), undefined);
    d.presenters.openMenu(d.capture, {fileInfo: async () => {}});
    d.navigation.back(authority);
    assert.equal(d.presenters.getSnapshot(), undefined);
  } finally {d.dispose();}
});

test('wrong physical member and withdrawn manage authority cannot dispatch owner commands', async () => {
  const d = await fixture();
  try {
    d.presenters.manageFile(d.capture, 'delete-version', 'wrong');
    assert.equal(d.presenters.getSnapshot()?.phase, 'file-info');
    d.respond(async () => ({...page, manage: {delete: false, split: false, merge: false}}));
    d.presenters.manageFile(d.capture, 'delete-version', 'asset');
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(d.presenters.getSnapshot()?.error);
    assert.equal(d.calls.filter(call => call.method === 'DELETE').length, 0);
    assert.equal(d.calls.some(call => call.path.includes('/delete/preview')), false);
  } finally {d.dispose();}
});

test('closing during fresh owner read aborts the actual request and refuses a late delete preview', async () => {
  const d = await fixture(), held = deferred<unknown>();
  try {
    d.respond(async () => held.promise);
    d.presenters.manageFile(d.capture, 'delete-version', 'asset');
    const request = d.calls.at(-1)!;
    d.presenters.close(); assert.equal(request.signal?.aborted, true);
    held.resolve(page); await new Promise(resolve => setImmediate(resolve));
    assert.equal(d.presenters.getSnapshot(), undefined);
    assert.equal(d.calls.some(call => call.path.includes('/delete/preview')), false);
  } finally {d.dispose();}
});

test('a changed File info revision cannot become a matching owner action just because its card is still current', async () => {
  const d = await fixture();
  try {
    d.respond(async () => ({...page, revision: {catalog: 4, viewer: 3}}));
    d.presenters.manageFile(d.capture, 'delete-version', 'asset');
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(d.presenters.getSnapshot()?.error);
    assert.equal(d.calls.some(call => call.path.includes('/delete/preview')), false);
  } finally {d.dispose();}
});

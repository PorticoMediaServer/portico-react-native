import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule, hooks} from './helpers/screen-harness.mjs';
import {HttpLocalApi} from '../../../packages/client-core/src/index.ts';
import {PlaybackOptionsClient} from '../../../packages/client-core/src/playback-v1/options.ts';
import {localV1Http} from '../../../packages/client-core/src/playback-v1/local-http.ts';
import {sameFence, playbackFence, type PlaybackFence} from '../../../packages/player-core/src/index.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {sameAuthority} from '../src-next/shell/model.ts';
import {NativeWatchControls} from '../src-next/screens/watch/controls.ts';
import {readNativeFileInfo} from '../src-next/screens/watch/file-info.ts';
import {nativeWatchTracks} from '../src-next/screens/watch/track-identity.ts';
import {nativeVersionChoices} from '../src-next/screens/watch/version-options.ts';

const {react} = hooks();
const {createNativeWatchScreens} = await screenModule(new URL('../src-next/screens/watch/factory.tsx', import.meta.url), {
  react, '../../../../../packages/client-core/src/playback-v1/options': {PlaybackOptionsClient},
  '../../../../../packages/client-core/src/playback-v1/local-http': {localV1Http},
  '../../../../../packages/player-core/src': {sameFence}, '../../../../../packages/i18n/src': {defaultI18n},
  '../../shell/model': {sameAuthority}, './controls': {NativeWatchControls}, './file-info': {readNativeFileInfo},
  './track-identity': {nativeWatchTracks},
  './title-controller': {NativeTitleController: class {}}, './TitleScreen': {NativeTitleScreen: 'Title'},
  './FileInfoContent': {NativeFileInfoContent: 'FileInfo'}, './version-options': {nativeVersionChoices},
  './WatchHost': {NativeWatchHost: 'WatchHost'}, './WatchChrome': {NativeWatchChrome: 'Chrome'}, './picture-slot': {NativeWatchPicture: 'Picture'},
});
const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'};
const entry = {id: 'episode', kind: 'episode', title: 'Actual episode', libraryId: 'library', playback: {itemId: 'episode', startSeconds: 17}};
const fence = playbackFence({kind: 'queue', playback: {scope: {serverId: 'server', accountId: 'account', profileId: 'profile', controllerId: 'controller', controllerEpoch: 'epoch', commandLaneId: 'lane', authority: 'local'}, run: 1}, sessionId: 'session', itemId: 'episode', sourceId: 'v1', entryId: 'entry', generation: 1});
const offered = {itemId: 'episode', resume: {positionMs: 43000, partIndex: 0}, versions: [{id: 'v1'}, {id: 'v2'}]};
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
function fixture(hasDestination = true) {
  const playbackListeners = new Set<() => void>(), routeListeners = new Set<() => void>(), authorityListeners = new Set<() => void>();
  let bound = authority, revision = 3, source: any = {authority, retired: false, fence: undefined as PlaybackFence | undefined, dock: {local: {expanded: true}}, playback: {intent: 'playing'}};
  let respond = async (_url: URL) => offered as unknown;
  const requests: {path: string; signal?: AbortSignal | null}[] = [], menus: any[] = [], versions: any[] = [], starts: any[] = [], errors: unknown[] = [];
  const api = new HttpLocalApi('https://portico.test', '', async (input, init) => {
    const url = new URL(String(input)); requests.push({path: url.pathname, signal: init?.signal});
    return new Response(JSON.stringify(await respond(url)), {status: 200});
  });
  const subscribe = (listeners: Set<() => void>) => (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};
  const screens = createNativeWatchScreens({api, text: {t: defaultI18n.t, locale: 'en-US'}, scope: {serverId: 'server', viewerId: 'viewer'}, authority, current: () => bound,
    subscribeCurrent: subscribe(authorityListeners), navigation: {getSnapshot: () => ({authority: bound, revision, route: {kind: 'title', entry: {id: 'show', libraryId: 'library', kind: 'show'}}}), subscribe: subscribe(routeListeners), back() {}},
    playback: {getSnapshot: () => source, subscribe: subscribe(playbackListeners), startVersion: async (...args: unknown[]) => {starts.push(args);}}, watch: {register() {throw new Error('not mounted');}}, requestId: async () => 'request', isTV: false,
    manageFile() {}, openFileInfo() {}, versionPresentation: {title: 'Play a different version', row: () => ({primary: '4K Dolby Vision', secondary: '4K Dolby Vision, Dolby TrueHD with Atmos 7.1, 58.2 GB'})}, ...(hasDestination ? {openVersions: (...args: unknown[]) => {versions.push(args);}} : {}), openMenu: (...args: unknown[]) => {menus.push(args);},
    title: {aboutLabel: 'About', navigate() {}, myList() {}, renderError() {}, reportError: (error: unknown) => {errors.push(error);}},
  });
  return {screens, requests, menus, versions, starts, errors,
    respond: (value: typeof respond) => {respond = value;},
    source: (next: PlaybackFence) => {source = {...source, fence: next}; for (const listener of playbackListeners) listener();},
    session: (versionId: string) => {source = {...source, session: {id: fence.sessionId, itemId: entry.id, versionId, presentation: {generation: fence.generation}, queue: {entryId: fence.entryId}}};},
    route: () => {revision++; for (const listener of routeListeners) listener();},
    authority: () => {bound = {...bound, epoch: 'next'}; for (const listener of authorityListeners) listener();},
    subscriptions: () => playbackListeners.size + routeListeners.size + authorityListeners.size,
  };
}

test('episode menu retains its real show owner and sends the exact offered version and resume position', async () => {
  const d = fixture();
  try {
    await d.screens.menu(entry, () => true);
    assert.equal(d.requests[0]?.path, '/v1/items/episode/playback-options');
    await d.menus[0][1].differentVersion();
    assert.equal(d.requests.length, 2);
    const destination = d.versions[0][1];
    await destination.choose('unknown'); assert.equal(d.starts.length, 0);
    await destination.choose('v2');
    assert.equal(d.starts[0][0].target.startSeconds, 43);
    assert.equal(entry.playback.startSeconds, 17);
    assert.equal(d.starts[0][1].versionId, 'v2');
    assert.equal(d.starts[0][1].options.itemId, 'episode');
    assert.equal(d.starts[0][1].expectedFence, undefined);
    d.route(); await destination.choose('v1'); assert.equal(d.starts.length, 1); assert.equal(destination.isCurrent(), false);
  } finally {d.screens.dispose();}
  assert.equal(d.subscriptions(), 0);
});

test('no destination action is offered until a genuine approved presenter is installed', async () => {
  const d = fixture(false);
  try {
    await d.screens.menu(entry, () => true);
    assert.equal(d.menus[0][1].differentVersion, undefined);
    assert.equal(typeof d.menus[0][1].fileInfo, 'function');
    const captured = d.screens.capture(entry, () => true);
    await d.screens.versions(captured);
    assert.equal(d.requests.length, 1); assert.equal(d.versions.length, 0); assert.equal(d.starts.length, 0);
  } finally {d.screens.dispose();}
});

test('opening the chooser refreshes the canonical offer and withholds a removed version group', async () => {
  const d = fixture();
  try {
    await d.screens.menu(entry, () => true);
    d.respond(async () => ({...offered, versions: [{id: 'v1'}]}));
    await d.menus[0][1].differentVersion();
    assert.equal(d.requests.length, 2); assert.equal(d.versions.length, 0); assert.equal(d.starts.length, 0);
  } finally {d.screens.dispose();}
});

test('delayed options cannot open after route/authority/absent-to-new source or disposal', async () => {
  for (const change of ['route', 'authority', 'source', 'dispose'] as const) {
    const d = fixture(), held = deferred<unknown>();
    d.respond(async () => held.promise);
    const request = d.screens.menu(entry, () => true);
    await new Promise(resolve => setImmediate(resolve));
    if (change === 'source') d.source(fence); else if (change === 'dispose') d.screens.dispose(); else d[change]();
    assert.equal(d.requests[0]?.signal?.aborted, true);
    held.resolve(offered); await request;
    assert.equal(d.menus.length, 0); assert.equal(d.versions.length, 0);
    d.screens.dispose();
  }
});

test('one/duplicate/removed versions never grant a chooser; options failure keeps File info independent', async () => {
  for (const versions of [[{id: 'v1'}], [{id: 'v1'}, {id: 'v1'}]]) {
    const d = fixture(); d.respond(async () => ({...offered, versions}));
    try {await d.screens.menu(entry, () => true); assert.equal(d.menus[0][1].differentVersion, undefined);} finally {d.screens.dispose();}
  }
  const d = fixture(); let current = true;
  d.respond(async () => {throw new Error('actual options read failed');});
  try {
    await d.screens.menu(entry, () => current);
    assert.equal(typeof d.menus[0][1].fileInfo, 'function');
    assert.equal(d.menus[0][1].differentVersion, undefined);
    current = false; await d.menus[0][1].fileInfo();
    assert.equal(d.requests.length, 1);
  } finally {d.screens.dispose();}
});


test('menu forwards the measured card ref and retains the real owner lifetime', async () => {
  const d = fixture(), anchor = {current: {nativeTag: 37}}; let memberCurrent = true;
  try {
    await d.screens.menu(entry, () => memberCurrent, anchor);
    assert.equal(d.menus[0][2], anchor);
    assert.equal(d.menus[0][0].entry, entry);
    memberCurrent = false; await d.menus[0][1].fileInfo();
    assert.equal(d.requests.length, 1);
  } finally {d.screens.dispose();}
});


test('failed exact grouped version is excluded while one remaining row can start from fresh resume', async () => {
  const d = fixture(); d.source(fence); d.session('v1');
  try {
    const captured = d.screens.capture(entry, () => true);
    await d.screens.versionsAfterFailure(captured, {fence, versionId: 'v2'});
    assert.equal(d.versions.length, 0); assert.equal(d.requests.length, 0);
    await d.screens.versionsAfterFailure(captured, {fence, versionId: 'v1'});
    const destination = d.versions[0][1];
    assert.deepEqual(destination.rows.map((row: any) => row.id), ['v2']);
    assert.equal(await destination.choose('v1'), false); assert.equal(d.starts.length, 0);
    assert.equal(await destination.choose('v2'), true);
    assert.equal(d.starts[0][0].target.startSeconds, 43);
    assert.equal(d.starts[0][1].expectedFence, fence);
    assert.equal(entry.playback.startSeconds, 17);
  } finally {d.screens.dispose();}
});

test('failure can offer a single fresh surviving version when the failed version is no longer offered', async () => {
  const d = fixture(); d.source(fence); d.session('v1');
  d.respond(async () => ({...offered, versions: [{id: 'v2'}]}));
  try {
    await d.screens.versionsAfterFailure(d.screens.capture(entry, () => true), {fence, versionId: 'v1'});
    assert.deepEqual(d.versions[0][1].rows.map((row: any) => row.id), ['v2']);
  } finally {d.screens.dispose();}
});

test('row activation rereads fresh resume and rejects a removed grouped ID without remembering a choice', async () => {
  const d = fixture();
  try {
    await d.screens.menu(entry, () => true); await d.menus[0][1].differentVersion();
    const destination = d.versions[0][1];
    d.respond(async () => ({...offered, resume: {positionMs: 61000, partIndex: 0}}));
    assert.equal(await destination.choose('v2'), true);
    assert.equal(d.starts[0][0].target.startSeconds, 61);
    assert.equal(d.starts[0][1].options.resume.positionMs, 61000);
    assert.equal(entry.playback.startSeconds, 17);
    d.respond(async () => ({...offered, versions: [{id: 'v1'}]}));
    assert.equal(await destination.choose('v2'), false); assert.equal(d.starts.length, 1);
  } finally {d.screens.dispose();}
});

test('new playback output while the activation read is pending cannot start the old menu version', async () => {
  const d = fixture(), held = deferred<unknown>();
  try {
    await d.screens.menu(entry, () => true); await d.menus[0][1].differentVersion();
    d.respond(async () => held.promise);
    const choosing = d.versions[0][1].choose('v2');
    await new Promise(resolve => setImmediate(resolve));
    d.source(fence); assert.equal(d.requests.at(-1)?.signal?.aborted, true);
    held.resolve(offered); assert.equal(await choosing, false); assert.equal(d.starts.length, 0);
  } finally {d.screens.dispose();}
});

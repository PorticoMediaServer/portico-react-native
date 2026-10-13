import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {PlaybackService} from '../../../packages/client-core/src/index.ts';
import {NativeModules} from './react-native-stub.mjs';
import {act, createHookHost} from './hook-driver.ts';
import {control} from './player-hook-stub.mjs';
import type {PlayerEngine} from '../src/player/usePlayer';
register(new URL('./player-hook-loader.mjs', import.meta.url));
(globalThis as {__DEV__?: boolean}).__DEV__ = false;
const {usePlayerEngine} = await import('../src/player/usePlayer.ts');
(NativeModules as unknown as Record<string, any>).PorticoPlaybackModule = {acquire: async () => ({lease: 'lease', instanceId: 'instance'}), command: async () => true, release: async () => true};

const session = (id: string) => ({id, generation: 1, streamUrl: '/v1/media/grant/file.mp4', duration: 100, resumeSeconds: 0, mode: 'direct'});
const entry = (id: string) => ({id, title: id, kind: 'movie', playback: {itemId: id}}) as never;
const defer = <T,>() => { let resolve!: (value: T) => void, reject!: (e: Error) => void; const task = new Promise<T>((a, b) => {resolve = a; reject = b;}); return {task, resolve, reject}; };
function mount() {
  const starts: string[] = [];
  const api = {baseUrl: 'http://server.test', item: async (id: string) => ({id, title: id, kind: 'movie'}), request: async (): Promise<unknown> => ({}), mediaUrl: (s: string) => 'http://server.test' + s,
    getRouteSnapshot: () => undefined, subscribeRoute: () => () => {}};
  const playback = new PlaybackService({createPlayback: async (id: string) => { starts.push(id); return session(id); }, progressPlayback: async () => {}, stopPlayback: async () => {}}, () => 'request', {deferRecovery: true});
  const off = () => () => {};
  let sequence: (() => Promise<void>) | undefined;
  const queue = {playSelector: () => sequence?.() ?? Promise.resolve()};
  control.session = {api, session: undefined} as any;
  control.stack = {playback, playbackState: playback.getSnapshot(), ensureQueue() {}, v1Queue: () => queue,
    playLocal: async (media: any) => { starts.push('offline'); await playback.playLocal(media.itemId, () => ({...session('local:download'), streamUrl: media.fileUrl}), 0); },
    path: {session: () => undefined, subscribeSessions: off, setAutomatic() {}, onNotice: off, setTracks() {}, setRate() {}}} as any;
  let result!: PlayerEngine;
  const host = createHookHost(() => { control.stack.playbackState = playback.getSnapshot(); result = usePlayerEngine(); });
  host.mount();
  return {api, playback, starts, host, result: () => result, sequence: (fn: () => Promise<void>) => {sequence = fn;}, close: () => {host.unmount(); playback.leave();}};
}

for (const newer of ['offline', 'channel'] as const) {
  test(`a delayed preflight cannot replace a newer ${newer} play`, async () => {
    const d = mount(), preflight = defer<unknown>();
    d.api.request = () => preflight.task;
    try {
      await act(() => d.result().play('old', 0, entry('old')));
      await act(() => {
        if (newer === 'offline') void d.result().playOffline({entryId: 'download', itemId: 'download', playId: 'play', fileUrl: 'file:///Downloads/file.mp4', durationSeconds: 100, startSeconds: 0}, {title: 'Download'});
        else d.result().tune({name: 'Channel', provenance: 'tuner', sourceId: 'source', id: 'channel', generation: 1} as never);
      });
      await act(() => preflight.resolve({}));
      assert.equal(d.starts.includes('old'), false);
    } finally { d.close(); }
  });
}

for (const newer of ['play', 'leave', 'unmount'] as const) {
  test(`a rejected old queue start cannot start a fallback after ${newer}`, async () => {
    const d = mount(), request = defer<void>();
    d.sequence(() => request.task);
    try {
      await act(() => d.result().playSequence([entry('old')], 0, 0, {kind: 'series', id: 'series'} as never));
      await act(() => { if (newer === 'play') d.result().play('new', 0, entry('new')); else if (newer === 'leave') d.result().leave(); else d.host.unmount(); });
      await act(() => request.reject(new Error('no answer')));
      assert.equal(d.starts.includes('old'), false);
    } finally { d.close(); }
  });
}

test('a failed queue start does not make a second non-idempotent play request', async () => {
  const d = mount();
  d.sequence(async () => { throw new Error('response lost after dispatch'); });
  try {
    await act(() => d.result().playSequence([entry('old')], 0, 0, {kind: 'series', id: 'series'} as never));
    assert.deepEqual(d.starts, []);
  } finally { d.close(); }
});

test('a delayed download lookup cannot replace a newer play', async () => {
  const d = mount(), media = defer<any>();
  try {
    let offline!: Promise<void>;
    await act(() => { offline = d.result().playOffline(media.task, {title: 'Download'}); });
    await act(() => d.result().play('new', 0, entry('new')));
    await act(() => media.resolve({entryId: 'download', itemId: 'download', playId: 'play', fileUrl: 'file:///Downloads/file.mp4', durationSeconds: 100, startSeconds: 0}));
    await offline;
    assert.deepEqual(d.starts, ['new']);
  } finally { d.close(); }
});

test('the same item ID on a different API does not inherit another server\'s title identity', async () => {
  for (const showTitle of ['First server show', 'Second server show']) {
    const d = mount();
    d.api.request = async () => ({item: {episode: {showTitle, seasonNumber: 1, number: 1}}});
    try {
      await act(() => d.result().play('same-item', 0, {...entry('same-item') as any, kind: 'episode'}));
      assert.equal(d.result().identity.seriesTitle, showTitle);
    } finally { d.close(); }
  }
});

/** TV-PLAYER-03: every start from the screens names its origin, centrally in the player engine; a start from inside the player keeps it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {PlaybackService} from '../../../packages/client-core/src/index.ts';
import {NativeModules, Platform} from './react-native-stub.mjs';
import {act, createHookHost} from './hook-driver.ts';
import {control} from './player-hook-stub.mjs';
import type {PlayerEngine} from '../src/player/usePlayer';
import {cardFocusKey, focusReturn} from '../src/ui/focus-return.ts';
register(new URL('./player-hook-loader.mjs', import.meta.url));
(globalThis as {__DEV__?: boolean}).__DEV__ = false;
const {usePlayerEngine} = await import('../src/player/usePlayer.ts');
(NativeModules as unknown as Record<string, any>).PorticoPlaybackModule = {acquire: async () => ({lease: 'lease', instanceId: 'instance'}), command: async () => true, release: async () => true};

const session = (id: string) => ({id, generation: 1, streamUrl: '/v1/media/grant/file.mp4', duration: 100, resumeSeconds: 0, mode: 'direct'});
const movie = (id: string) => ({id, title: id, kind: 'movie', playback: {itemId: id}}) as never;
const song = (id: string) => ({id, title: id, kind: 'song', playback: {itemId: id}}) as never;

function mount() {
  const api = {baseUrl: 'http://server.test', item: async (id: string) => ({id, title: id, kind: 'movie'}), request: async (): Promise<unknown> => ({}), mediaUrl: (s: string) => 'http://server.test' + s,
    getRouteSnapshot: () => undefined, subscribeRoute: () => () => {}};
  const playback = new PlaybackService({createPlayback: async (id: string) => session(id), progressPlayback: async () => {}, stopPlayback: async () => {}}, () => 'request', {deferRecovery: true});
  const off = () => () => {};
  control.session = {api, session: undefined} as any;
  control.stack = {playback, playbackState: playback.getSnapshot(), ensureQueue() {}, v1Queue: () => undefined,
    playLocal: async () => {},
    path: {session: () => undefined, subscribeSessions: off, setAutomatic() {}, onNotice: off, setTracks() {}, setRate() {}}} as any;
  let result!: PlayerEngine;
  const host = createHookHost(() => { control.stack.playbackState = playback.getSnapshot(); result = usePlayerEngine(); });
  host.mount();
  return {host, result: () => result, close: () => { host.unmount(); playback.leave(); }};
}

/** A named card on Home with focus, as `Focusable` reports it. */
function focusCard(id: string) {
  const key = cardFocusKey('continue', id);
  const unregister = focusReturn.register('home', key, {focus: () => focusReturn.focused('home', key)});
  focusReturn.focused('home', key);
  return {key, unregister, leave: () => focusReturn.blurred('home', key)};
}

test('TV: a start from a card names the card; the next title started inside the player keeps it', async t => {
  Platform.isTV = true;
  t.after(() => { Platform.isTV = false; focusReturn.setOwner(''); });
  focusReturn.setOwner('viewer');
  const d = mount();
  const card = focusCard('m1');
  try {
    await act(() => d.result().play('m1', 0, movie('m1')));
    assert.equal(focusReturn.state().origin?.key, card.key);
    // The player is up: focus is in it. The next episode (Up Next) starts from there.
    card.leave();
    assert.equal(d.result().expanded, true);
    await act(() => d.result().play('m2', 0, movie('m2')));
    assert.equal(focusReturn.state().origin?.key, card.key, 'the origin is still the card');
  } finally { d.close(); card.unregister(); }
});

test('TV: every kind of start is captured where it is asked for — a sequence, a channel, a download', async t => {
  Platform.isTV = true;
  t.after(() => { Platform.isTV = false; focusReturn.setOwner(''); });
  focusReturn.setOwner('viewer');
  for (const start of ['sequence', 'channel', 'offline'] as const) {
    const d = mount();
    const card = focusCard(`c-${start}`);
    try {
      await act(() => {
        if (start === 'sequence') d.result().playSequence([movie('a'), movie('b')], 0, 0);
        else if (start === 'channel') d.result().tune({name: 'Channel', provenance: 'tuner', sourceId: 'source', id: 'channel', generation: 1} as never);
        else void d.result().playOffline({entryId: 'download', itemId: 'download', playId: 'play', fileUrl: 'file:///Downloads/file.mp4', durationSeconds: 100, startSeconds: 0}, {title: 'Download'});
      });
      assert.equal(focusReturn.state().origin?.key, card.key, start);
    } finally { d.close(); card.unregister(); }
  }
});

test('TV: audio sent to the pill and opened again from it returns to the pill', async t => {
  Platform.isTV = true;
  t.after(() => { Platform.isTV = false; focusReturn.setOwner(''); });
  focusReturn.setOwner('viewer');
  const d = mount();
  const card = focusCard('s1');
  try {
    await act(() => d.result().play('s1', 0, song('s1')));
    card.leave();
    await act(() => d.result().collapse());
    assert.equal(d.result().expanded, false);
    // The pill has focus now and opens the player again.
    const unregister = focusReturn.register('shell', 'action:now-playing', {focus: () => {}});
    focusReturn.focused('shell', 'action:now-playing');
    await act(() => d.result().expand());
    assert.equal(focusReturn.state().origin?.key, 'action:now-playing');
    unregister();
  } finally { d.close(); card.unregister(); }
});

test('off television nothing is captured', async t => {
  t.after(() => focusReturn.setOwner(''));
  focusReturn.setOwner('viewer');
  focusReturn.capture();
  const d = mount();
  const card = focusCard('h1');
  try {
    // Clear whatever an earlier capture left, then start as a phone would.
    focusReturn.restore();
    focusReturn.cancel();
    await act(() => d.result().play('h1', 0, movie('h1')));
    assert.equal(focusReturn.state().origin, undefined);
  } finally { d.close(); card.unregister(); }
});

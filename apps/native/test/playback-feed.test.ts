import test from 'node:test';
import assert from 'node:assert/strict';
import {runEventFeed} from '../../../packages/client-core/src/event-feed.ts';
import {playbackFeedBusy} from '../src/bridge/playback-paths.ts';
import type {PlaybackSnapshot} from '../../../packages/client-core/src/index';

test('a retained title is busy only while actively starting or playing', () => {
  for (const phase of ['idle', 'starting', 'ready', 'error', 'ended'] as const) {
    for (const intent of ['paused', 'playing'] as const) assert.equal(playbackFeedBusy({itemId: 'item', phase, intent}), intent === 'playing' && (phase === 'starting' || phase === 'ready'), `${phase}/${intent}`);
  }
  assert.equal(playbackFeedBusy({phase: 'ready', intent: 'playing'}), false);
});

test('the native feed stops after background pause, resumes for playback, and stops at the end', () => {
  let visible = true, mode = 'stopped', visibility!: () => void, busy!: () => void;
  let snapshot: Pick<PlaybackSnapshot, 'itemId' | 'intent' | 'phase'> = {itemId: 'item', phase: 'ready', intent: 'paused'};
  let grace: (() => void) | undefined;
  const stops: string[] = [];
  const feed = {start() {mode = 'streaming';}, stop() {mode = 'stopped'; stops.push('stop');}, getStatus: () => ({mode})};
  const dispose = runEventFeed(feed as never, undefined, {visible: () => visible, busy: () => playbackFeedBusy(snapshot),
    onVisibility: listener => {visibility = listener; return () => {};}, onBusy: listener => {busy = listener; return () => {};},
    setTimer: fn => {grace = fn; return 1;}, clearTimer: () => {grace = undefined;}});
  try {
    visible = false; visibility(); grace?.();
    assert.equal(mode, 'stopped');
    snapshot = {...snapshot, intent: 'playing'}; busy();
    assert.equal(mode, 'streaming');
    snapshot = {...snapshot, phase: 'ended'}; busy(); grace?.();
    assert.equal(mode, 'stopped');
    assert.equal(stops.length, 2);
  } finally {dispose();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultI18n} from '../../../packages/i18n/src';
import type {MusicSignalInput} from '../../../packages/client-core/src/music-signal';
import type {ListeningSnapshot} from '../../../packages/client-core/src/listening';
import {nativeSignalPath} from '../src-next/screens/destinations/music/signal-path-model';
import {nativeListeningNotice, type NativeNoticeIdentity} from '../src-next/screens/destinations/music/listening-notice-model';

const t = defaultI18n.t;
const signal: MusicSignalInput = {
  source: {codec: 'flac', lossless: true, bitDepth: 24, sampleRate: 96000, channels: 2},
  server: {route: 'original'}, output: {platform: 'apple', device: 'appleTv', sampleRate: 96000, sampleRateMatched: true},
  eqOn: false, eqApplied: false, normalization: 'off', levelingApplied: false,
};

test('native short signal retains shared precedence and actual output truth', () => {
  const normal = nativeSignalPath(signal, t);
  assert.equal(normal.rule, 5);
  assert.equal(normal.pill, t('player.signal.pill.rateMatched'));
  const unavailable = nativeSignalPath({...signal, eqOn: true}, t);
  assert.equal(unavailable.rule, 2);
  assert.equal(unavailable.state, t('player.signal.line.eqUnavailable'));
  assert.equal(unavailable.pill, normal.pill);
  assert.equal(unavailable.steps.find(step => step.id === 'eq')?.value, t('player.signal.notApplied'));
  const applied = nativeSignalPath({...signal, eqOn: true, eqApplied: true}, t);
  assert.equal(applied.state, t('player.signal.line.eqOn'));
  assert.equal(applied.pill, t('player.signal.pill.notBitPerfect'));
  const converted = nativeSignalPath({...signal, eqOn: true, server: {route: 'converted', delivered: {codec: 'flac'}, atmosLost: true}}, t);
  assert.equal(converted.rule, 1);
  assert.equal(converted.pill, t('player.signal.pill.atmosLost'));
});

test('native signal exposes short source, accessible long text and real step facts', () => {
  const view = nativeSignalPath({...signal, output: {platform: 'android', device: 'phone', sampleRate: 48000, resampledBy: 'phone'}}, t);
  assert.equal(view.rule, 4);
  assert.ok(view.source?.includes('96'));
  assert.ok(view.accessibleName?.includes('96'));
  assert.deepEqual(view.steps.map(step => step.id), ['file', 'server', 'leveling', 'eq', 'output']);
  assert.ok(view.steps.find(step => step.id === 'output')?.value?.includes('48'));
  assert.equal(view.healthy, false);
  assert.ok(Object.isFrozen(view.steps));
});

const identity: NativeNoticeIdentity = {sessionId: 'session-a', generation: 1, itemId: 'book-part', intentId: 3};
function listening(extra: Partial<ListeningSnapshot> = {}): ListeningSnapshot {
  return {
    eqApplied: false, levelingApplied: false, phase: 'ready', preferences: null,
    context: {itemId: identity.itemId, libraryId: 'books', kind: 'audiobook'}, rate: 1,
    timer: null, timerLoading: false, stopped: false, message: null, error: null,
    rewind: {seconds: 10, fromSeconds: 100, toSeconds: 90, messageKey: 'listening.rewound'}, ...extra,
  };
}

test('rewind projection uses existing snapshot and copies only a current public identity', () => {
  const notice = nativeListeningNotice(listening(), identity, identity);
  assert.deepEqual(notice, {identity, key: 'listening.rewound', values: {seconds: 10}});
  assert.notEqual(notice?.identity, identity);
  assert.ok(Object.isFrozen(notice?.identity));
});

test('context alone cannot retain rewind across session, generation or intent changes', () => {
  for (const changed of [{sessionId: 'session-b'}, {generation: 2}, {itemId: 'another-part'}, {intentId: 4}]) {
    assert.equal(nativeListeningNotice(listening(), identity, {...identity, ...changed}), undefined);
  }
  assert.equal(nativeListeningNotice(listening(), null, identity), undefined);
  assert.equal(nativeListeningNotice(listening(), identity, null), undefined);
  assert.equal(nativeListeningNotice(listening({context: null}), identity, identity), undefined);
});

test('stopped, errors and invalid rewinds stay quiet; message strings create no pause notice', () => {
  for (const extra of [{stopped: true}, {error: 'arbitrary engine text'}, {phase: 'disposed' as const}, {phase: 'error' as const},
    {rewind: undefined, message: 'Playback paused. Press play to continue.'}]) {
    assert.equal(nativeListeningNotice(listening(extra), identity, identity), undefined);
  }
  for (const seconds of [0, -1, Infinity, NaN, 11]) {
    assert.equal(nativeListeningNotice(listening({rewind: {seconds, fromSeconds: 100, toSeconds: 90, messageKey: 'listening.rewound'}}), identity, identity), undefined);
  }
});

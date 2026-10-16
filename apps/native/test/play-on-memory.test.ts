/** Play on: what this device remembers of a title it sent to another device, to control it again later. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SENT_PLAYBACK_MAX_AGE_MS, readSentPlayback} from '../src/app/play-on-memory.ts';

const now = Date.parse('2026-10-13T12:00:00Z');
const record = (o: Record<string, unknown> = {}) => ({viewer: 'me\nsrv', handoffId: 'hnd_1', device: 'Living room', title: 'Arrival', at: now - 60_000, ...o});

test('a remembered destination is this viewer’s and recent', () => {
  assert.deepEqual(readSentPlayback(record(), 'me\nsrv', now), record());
  assert.equal(readSentPlayback(record(), 'someone-else\nsrv', now), undefined, 'another profile never picks it up');
  assert.equal(readSentPlayback(record({at: now - SENT_PLAYBACK_MAX_AGE_MS - 1}), 'me\nsrv', now), undefined, 'yesterday’s film is not still playing');
  assert.equal(readSentPlayback(record({at: now + 3_600_000}), 'me\nsrv', now), undefined, 'a time in the future is not believed');
});

test('anything that cannot be read is nothing', () => {
  for (const raw of [null, undefined, 'text', [], {}, record({handoffId: ''}), record({handoffId: '../x'}), record({device: ''}), record({at: 'now'}), record({viewer: 7})]) assert.equal(readSentPlayback(raw, 'me\nsrv', now), undefined);
  assert.deepEqual(readSentPlayback(record({title: 7}), 'me\nsrv', now), {viewer: 'me\nsrv', handoffId: 'hnd_1', device: 'Living room', at: now - 60_000}, 'an unreadable title is left out alone');
});

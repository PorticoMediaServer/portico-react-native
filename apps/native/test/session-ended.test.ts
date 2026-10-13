/** Sessions the server ended: the reason reaches the player at once and reads as web's copy. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {endedCopy} from '../src/player/ended-copy.ts';
import {forwardSessionEnds} from '../src/bridge/playback-paths.ts';

const t = defaultI18n.t;

test('an owner stop reads as web does, with the owner message when there is one', () => {
  const plain = endedCopy({reason: 'terminated'}, t);
  assert.equal(plain.title, 'The server owner stopped this playback.');
  assert.equal(plain.message, undefined);
  assert.equal(plain.short, 'Stopped by the server owner');
  const written = endedCopy({reason: 'terminated', message: 'Maintenance\u0007 tonight'}, t);
  assert.equal(written.message, 'Message from the server owner: “Maintenance tonight”');
  const moved = endedCopy({reason: 'transferred'}, t);
  assert.equal(moved.message, 'Playback continued on another device.');
  assert.equal(moved.short, 'Playback continued on another device.');
});

test('session.updated events for a session reach the playback path with their revision; others are ignored', () => {
  type Event = {resource?: {kind: string; id: string}; revision?: string; data?: unknown};
  const listeners = new Map<string, (event: Event) => void>();
  const events = {on: (type: string, listener: (event: Event) => void) => { listeners.set(type, listener); return () => listeners.delete(type); }};
  const seen: [string, string | undefined, unknown][] = [];
  const off = forwardSessionEnds(events, {sessionUpdated: (id: string, revision?: string, data?: unknown) => { seen.push([id, revision, data]); }});
  listeners.get('session.updated')!({resource: {kind: 'session', id: 'ses_1'}, revision: '7', data: {state: 'ended', reason: 'terminated'}});
  listeners.get('session.updated')!({resource: {kind: 'queue', id: 'q_1'}});
  assert.deepEqual(seen, [['ses_1', '7', {state: 'ended', reason: 'terminated'}]]);
  off();
  assert.equal(listeners.size, 0);
});

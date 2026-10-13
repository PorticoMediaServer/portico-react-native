/** Watch Together: a room that is paused or holding takes a new title paused. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {pauseOnceStarted} from '../src/app/paused-load.ts';

function player(initial: {itemId?: string; phase: string; intent: string}) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  let pauses = 0;
  return {
    get pauses() { return pauses; },
    get listening() { return listeners.size; },
    set(next: Partial<typeof initial>) { snapshot = {...snapshot, ...next}; for (const l of [...listeners]) l(); },
    api: {getSnapshot: () => snapshot, subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, pause: () => { pauses++; snapshot = {...snapshot, intent: 'paused'}; }},
  };
}

test('the pause waits for the title to be the player’s, then is asked once', () => {
  const p = player({phase: 'idle', intent: 'paused'});
  pauseOnceStarted(p.api, 'b');
  assert.equal(p.pauses, 0);
  p.set({itemId: 'b', phase: 'starting', intent: 'playing'});
  assert.equal(p.pauses, 1);
  p.set({phase: 'ready'});
  assert.equal(p.pauses, 1);
  assert.equal(p.listening, 0);
});

test('the title that was playing before does not end the wait', () => {
  const p = player({itemId: 'a', phase: 'ready', intent: 'playing'});
  pauseOnceStarted(p.api, 'b');
  p.set({phase: 'ready'});
  assert.equal(p.pauses, 0, 'the old title is never paused by this');
  assert.equal(p.listening, 1);
  p.set({itemId: 'b', phase: 'starting'});
  assert.equal(p.pauses, 1);
});

test('a title already taken is paused at once, and one already paused is left alone', () => {
  const playing = player({itemId: 'b', phase: 'starting', intent: 'playing'});
  pauseOnceStarted(playing.api, 'b');
  assert.equal(playing.pauses, 1);
  const paused = player({itemId: 'b', phase: 'ready', intent: 'paused'});
  pauseOnceStarted(paused.api, 'b');
  assert.equal(paused.pauses, 0);
  assert.equal(paused.listening, 0);
});

test('another title arriving first, or stopping, ends the wait without a pause', () => {
  const p = player({itemId: 'a', phase: 'ready', intent: 'playing'});
  pauseOnceStarted(p.api, 'b');
  p.set({itemId: 'c', phase: 'starting'});
  p.set({itemId: 'b', phase: 'starting'});
  assert.equal(p.pauses, 0);
  const q = player({phase: 'idle', intent: 'paused'});
  const stop = pauseOnceStarted(q.api, 'b');
  stop();
  q.set({itemId: 'b', phase: 'starting', intent: 'playing'});
  assert.equal(q.pauses, 0);
  assert.equal(q.listening, 0);
});

test('the wait gives up by itself', async () => {
  const p = player({phase: 'idle', intent: 'paused'});
  pauseOnceStarted(p.api, 'b', 10);
  await new Promise(done => setTimeout(done, 30));
  p.set({itemId: 'b', phase: 'starting', intent: 'playing'});
  assert.equal(p.pauses, 0);
  assert.equal(p.listening, 0);
});

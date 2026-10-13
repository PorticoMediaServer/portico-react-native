/** Watch Together: a room that is paused or holding takes a new title paused. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {pauseNextStart} from '../src/app/paused-load.ts';

function player(initial: {itemId?: string; intentId: number; phase: string; intent: string}) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  let pauses = 0;
  /** What the engine would have been told: it reads the state a turn after each change. */
  const told: string[] = [];
  return {
    get pauses() { return pauses; },
    get listening() { return listeners.size; },
    told,
    set(next: Partial<typeof initial>) {
      snapshot = {...snapshot, ...next};
      for (const l of [...listeners]) l();
      // The engine's turn comes after every listener has run.
      if (snapshot.phase !== 'idle' && snapshot.itemId) told.push(`${snapshot.itemId}:${snapshot.intent}`);
    },
    api: {getSnapshot: () => snapshot, subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, pause: () => { pauses++; snapshot = {...snapshot, intent: 'paused'}; }},
  };
}

test('the pause waits for the load to begin, then is asked once, before the engine hears of the title', () => {
  const p = player({intentId: 1, phase: 'idle', intent: 'paused'});
  pauseNextStart(p.api, 'b', 1);
  assert.equal(p.pauses, 0);
  p.set({intentId: 2, itemId: 'b', phase: 'starting', intent: 'playing'});
  assert.equal(p.pauses, 1);
  assert.deepEqual(p.told, ['b:paused'], 'the engine is never told to play it');
  p.set({phase: 'ready'});
  assert.equal(p.pauses, 1);
  assert.equal(p.listening, 0);
});

test('a title that becomes the player’s before the intent changes is paused then, and stays paused', () => {
  // Nothing was playing: the player names the title at once and changes intent only when its session arrives.
  const p = player({intentId: 1, phase: 'idle', intent: 'paused'});
  pauseNextStart(p.api, 'b', 1);
  p.set({itemId: 'b', phase: 'starting', intent: 'playing'});
  assert.equal(p.pauses, 1);
  assert.deepEqual(p.told, ['b:paused']);
});

test('the title that was playing before is never paused by this', () => {
  const p = player({itemId: 'a', intentId: 4, phase: 'ready', intent: 'playing'});
  pauseNextStart(p.api, 'b', 4);
  p.set({phase: 'ready'});
  assert.equal(p.pauses, 0);
  assert.equal(p.listening, 1);
  // Between the two titles the player holds none for a moment.
  p.set({intentId: 5, itemId: undefined, phase: 'idle'});
  assert.equal(p.pauses, 0);
  p.set({itemId: 'b', phase: 'starting'});
  assert.equal(p.pauses, 1);
});

test('the same title loaded again (the group moved to another moment) starts paused too', () => {
  const p = player({itemId: 'b', intentId: 7, phase: 'ready', intent: 'playing'});
  pauseNextStart(p.api, 'b', 7);
  assert.equal(p.pauses, 0, 'what is playing now is left alone until the new load begins');
  p.set({intentId: 8, phase: 'starting', intent: 'playing'});
  assert.equal(p.pauses, 1);
  assert.equal(p.told.at(-1), 'b:paused');
});

test('a load that had already begun when the pause was armed is paused at once; one already paused is left alone', () => {
  const playing = player({itemId: 'b', intentId: 3, phase: 'starting', intent: 'playing'});
  pauseNextStart(playing.api, 'b', 2);
  assert.equal(playing.pauses, 1);
  const paused = player({itemId: 'b', intentId: 3, phase: 'ready', intent: 'paused'});
  pauseNextStart(paused.api, 'b', 2);
  assert.equal(paused.pauses, 0);
  assert.equal(paused.listening, 0);
});

test('the same title loaded again is not paused by the play request that precedes its new intent', () => {
  // The player first says "playing" again on the session it has, then replaces it: only the replacement is paused.
  const p = player({itemId: 'b', intentId: 7, phase: 'ready', intent: 'paused'});
  pauseNextStart(p.api, 'b', 7);
  p.set({intent: 'playing'});
  assert.equal(p.pauses, 0);
  p.set({intentId: 8, itemId: undefined, phase: 'idle', intent: 'paused'});
  p.set({itemId: 'b', phase: 'starting', intent: 'playing'});
  assert.equal(p.pauses, 1);
  assert.equal(p.told.at(-1), 'b:paused');
});

test('another title beginning first, or stopping, ends the wait without a pause', () => {
  const p = player({itemId: 'a', intentId: 1, phase: 'ready', intent: 'playing'});
  pauseNextStart(p.api, 'b', 1);
  p.set({intentId: 2, itemId: 'c', phase: 'starting'});
  p.set({intentId: 3, itemId: 'b', phase: 'starting'});
  assert.equal(p.pauses, 0);
  const q = player({intentId: 1, phase: 'idle', intent: 'paused'});
  const stop = pauseNextStart(q.api, 'b', 1);
  stop();
  q.set({intentId: 2, itemId: 'b', phase: 'starting', intent: 'playing'});
  assert.equal(q.pauses, 0);
  assert.equal(q.listening, 0);
});

test('the wait gives up by itself', async () => {
  const p = player({intentId: 1, phase: 'idle', intent: 'paused'});
  pauseNextStart(p.api, 'b', 1, 10);
  await new Promise(done => setTimeout(done, 30));
  p.set({intentId: 2, itemId: 'b', phase: 'starting', intent: 'playing'});
  assert.equal(p.pauses, 0);
  assert.equal(p.listening, 0);
});

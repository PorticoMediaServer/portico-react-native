/** The proofs that let this installation take back a Cast session it started. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readControllerProofs} from '../src/bridge/cast-controller-storage.ts';

test('what was saved is read back newest last, a repeated television keeping its latest proof', () => {
  assert.deepEqual(readControllerProofs({items: [['a', '1'], ['b', '2'], ['a', '3']]}), [['b', '2'], ['a', '3']]);
});

test('anything that is not a proof this app could have written is left out alone', () => {
  assert.deepEqual(readControllerProofs({items: [['a', '1'], ['', 'x'], ['b'], 'text', ['c', 7], ['d', ''], ['e', 'x'.repeat(257)], ['f', '6']]}), [['a', '1'], ['f', '6']]);
  for (const raw of [null, undefined, 'text', [], {}, {items: 'no'}]) assert.deepEqual(readControllerProofs(raw), []);
});

test('only the most recent televisions are kept', () => {
  const many = Array.from({length: 40}, (_, i) => [`tv${i}`, `p${i}`]);
  const kept = readControllerProofs({items: many});
  assert.equal(kept.length, 16);
  assert.deepEqual(kept[0], ['tv24', 'p24']);
  assert.deepEqual(kept.at(-1), ['tv39', 'p39']);
});

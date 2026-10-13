/** Which cards of a list have just arrived, and so fade in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ARRIVAL_LIMIT, ARRIVAL_WINDOW_MS, Arrivals} from '../src/ui/arrivals.ts';

test('nothing fades the first time a list has something to show', () => {
  const list = new Arrivals();
  list.update([], 0);
  list.update(['a', 'b', 'c'], 10);
  for (const key of ['a', 'b', 'c']) assert.equal(list.arriving(key, 10), false);
});

test('a title a quiet refresh brought fades in; the ones that were there do not', () => {
  const list = new Arrivals();
  list.update(['a', 'b'], 0);
  list.update(['new', 'a', 'b'], 5_000);
  assert.equal(list.arriving('new', 5_010), true);
  assert.equal(list.arriving('a', 5_010), false);
  // The same list drawn again changes nothing.
  list.update(['new', 'a', 'b'], 5_100);
  assert.equal(list.arriving('new', 5_100), true);
});

test('a card first drawn long after it arrived (scrolled to later) does not fade', () => {
  const list = new Arrivals();
  list.update(['a'], 0);
  list.update(['a', 'b'], 1_000);
  assert.equal(list.arriving('b', 1_000 + ARRIVAL_WINDOW_MS), true);
  assert.equal(list.arriving('b', 1_001 + ARRIVAL_WINDOW_MS), false);
});

test('the next page fades in; a wholly different list does not', () => {
  const list = new Arrivals();
  list.update(['a', 'b'], 0);
  list.update(['a', 'b', 'c', 'd'], 100);
  assert.equal(list.arriving('c', 110), true);
  assert.equal(list.arriving('d', 110), true);
  const many = Array.from({length: ARRIVAL_LIMIT + 1}, (_, i) => `n${i}`);
  list.update(many, 200);
  assert.equal(list.arriving('n0', 210), false, 'another sort or another library is not “new cards”');
});

test('a title that left and came back much later is new again', () => {
  const list = new Arrivals();
  list.update(['a', 'b'], 0);
  list.update(['a'], 100);
  list.update(['a', 'b'], 60_000);
  assert.equal(list.arriving('b', 60_010), true);
});

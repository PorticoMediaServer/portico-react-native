/** Which cards of a list have just arrived, and so fade in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ARRIVAL_LIMIT, ARRIVAL_WINDOW_MS, Arrivals, WindowArrivals} from '../src/ui/arrivals.ts';

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
  const other = Array.from({length: ARRIVAL_LIMIT + 1}, (_, i) => `n${i}`);
  list.update(other, 200);
  assert.equal(list.arriving('n0', 210), false, 'another sort or another library is not “new cards”');
});

test('a scan bringing many titles to the same list fades each one drawn in the short while', () => {
  const list = new Arrivals();
  const old = Array.from({length: 40}, (_, i) => `o${i}`);
  list.update(old, 0);
  const many = Array.from({length: 200}, (_, i) => `n${i}`);
  list.update([...many, ...old], 100);
  assert.equal(list.arriving('n0', 110), true);
  assert.equal(list.arriving('n199', 110), true);
  assert.equal(list.arriving('o0', 110), false);
});

test('a windowed grid fades a card a re-read put where another was, not one scrolled to or one that only moved', () => {
  const grid = new WindowArrivals();
  // First drawing, and pages read while scrolling: nothing fades.
  assert.equal(grid.drawn(0, 'a', 0), false);
  assert.equal(grid.drawn(1, 'b', 0), false);
  assert.equal(grid.drawn(50, 'z', 10), false);
  // A title arrives at the top: it fades; the ones pushed down were seen already.
  assert.equal(grid.drawn(0, 'new', 1_000), true);
  assert.equal(grid.drawn(1, 'a', 1_000), false);
  assert.equal(grid.drawn(2, 'b', 1_000), false);
  // Drawn again in the short while, it still fades; after it, not.
  assert.equal(grid.drawn(0, 'new', 1_100), true);
  assert.equal(grid.drawn(0, 'new', 1_001 + ARRIVAL_WINDOW_MS), false);
  // Another library: start again.
  grid.reset();
  assert.equal(grid.drawn(0, 'x', 5_000), false);
});

test('a windowed grid that sees a wholly different list fades no more than a handful', () => {
  const grid = new WindowArrivals();
  for (let i = 0; i < 100; i++) grid.drawn(i, `o${i}`, 0);
  let faded = 0;
  for (let i = 0; i < 100; i++) if (grid.drawn(i, `n${i}`, 100)) faded++;
  assert.equal(faded, ARRIVAL_LIMIT);
});

test('a title that left and came back much later is new again', () => {
  const list = new Arrivals();
  list.update(['a', 'b'], 0);
  list.update(['a'], 100);
  list.update(['a', 'b'], 60_000);
  assert.equal(list.arriving('b', 60_010), true);
});

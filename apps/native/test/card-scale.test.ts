import test from 'node:test';
import assert from 'node:assert/strict';
import {cardScaleFor} from '../src/ui/card-scale.ts';

test('the three sizes Settings offers', () => {
  assert.equal(cardScaleFor(85), 0.82);
  assert.equal(cardScaleFor(100), 1);
  assert.equal(cardScaleFor(125), 1.25);
});

test('a value only an API client could have stored reads as the nearest size', () => {
  assert.equal(cardScaleFor(89), 0.82);
  assert.equal(cardScaleFor(90), 1);
  assert.equal(cardScaleFor(115), 1);
  assert.equal(cardScaleFor(116), 1.25);
});

test('anything unreadable is the standard size', () => {
  for (const value of [undefined, null, 'large', NaN, Infinity]) assert.equal(cardScaleFor(value), 1);
});

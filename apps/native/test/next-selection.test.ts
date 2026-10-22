import {test} from 'node:test';
import assert from 'node:assert/strict';
import {holdFraction, selectionCircleGeometry, selectionIntent} from '../src-next/kit/selection/selection-geometry.ts';

test('phone and TV circle geometry follows their own selection frames', () => {
  assert.deepEqual(selectionCircleGeometry(false), {diameter: 24, border: 2, check: 16});
  assert.equal(selectionCircleGeometry(true).diameter, 44);
  assert.equal(selectionCircleGeometry(false, 26).diameter, 26);
});
test('semantic intent distinguishes entering, toggling and extending a range', () => {
  assert.deepEqual(selectionIntent(false, false), {intent: 'enter'});
  assert.deepEqual(selectionIntent(false, true), {intent: 'toggle'});
  assert.deepEqual(selectionIntent(true, false), {intent: 'toggle'});
  assert.deepEqual(selectionIntent(false, true, true), {intent: 'range', shiftKey: true});
});
test('hold feedback never fabricates progress when measurement is absent', () => {
  assert.equal(holdFraction(null), null);
  assert.equal(holdFraction(NaN), null);
  assert.equal(holdFraction(.53), .53);
  assert.equal(holdFraction(-1), 0);
  assert.equal(holdFraction(2), 1);
});

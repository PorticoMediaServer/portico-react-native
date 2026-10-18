import test from 'node:test';
import assert from 'node:assert/strict';
import {lineRoom, withLineRoom} from '../src/ui/line-room.ts';

test('a tight display role gets room for its descenders', () => {
  // Handheld title, 26/31: Manrope needs 35.5, so Android trims about 2.25 off each edge.
  assert.equal(lineRoom({fontSize: 26, lineHeight: 31}, 1), 3);
  // Ten-foot display, 62/68.
  assert.equal(lineRoom({fontSize: 62, lineHeight: 68}, 1), 9);
});

test('body text and other roles that fit the font are left alone', () => {
  assert.equal(lineRoom({fontSize: 15, lineHeight: 21}, 1), 0);
  assert.equal(lineRoom({fontSize: 13, lineHeight: 18}, 1), 0);
  assert.equal(lineRoom({fontSize: 11, lineHeight: 14}, 1), 0);
});

test('larger system text needs more room', () => {
  assert.equal(lineRoom({fontSize: 26, lineHeight: 31}, 2), 5);
  assert.equal(lineRoom({fontSize: 17, lineHeight: 22}, 2), 2);
});

test('a style without a numeric size or line height gets none', () => {
  assert.equal(lineRoom({fontSize: 26}, 1), 0);
  assert.equal(lineRoom({}, 1), 0);
});

test('the room is padding inside and margin outside, so layout height is unchanged', () => {
  assert.deepEqual(withLineRoom({fontSize: 26, lineHeight: 31}, 3), {fontSize: 26, lineHeight: 31, paddingTop: 3, paddingBottom: 3, marginTop: -3, marginBottom: -3});
  assert.deepEqual(withLineRoom({paddingVertical: 4, marginTop: 8, margin: 2}, 3), {paddingVertical: 4, marginTop: 5, margin: 2, paddingTop: 7, paddingBottom: 7, marginBottom: -1});
});

test("a caller's non-numeric spacing is kept exactly as given", () => {
  const style = {marginTop: 'auto' as const, fontSize: 26, lineHeight: 31};
  assert.equal(withLineRoom(style, 3), style);
});

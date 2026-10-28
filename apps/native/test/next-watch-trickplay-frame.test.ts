import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeTrickplayFrame} from '../src-next/screens/watch/trickplay-frame.ts';

for (const tileWidth of [240, 320]) for (const box of [{width: 256, height: 144}, {width: 480, height: 270}]) {
  test(`trickplay ${tileWidth} source clips a complete frame in ${box.width} display pixels`, () => {
    const source = {url: '/trickplay.jpg', intervalMs: 10000, tileWidth, tileHeight: tileWidth * 9 / 16, columns: 5, rows: 4};
    const frame = nativeTrickplayFrame(source, 70, box)!;
    assert.deepEqual(frame, {width: box.width * 5, height: box.height * 4, left: -box.width * 2, top: -box.height});
    // The chosen source tile's two corners become exactly the clipping box's corners.
    const xScale = frame.width / (source.columns * source.tileWidth), yScale = frame.height / (source.rows * source.tileHeight);
    assert.deepEqual([2 * source.tileWidth * xScale + frame.left, source.tileHeight * yScale + frame.top], [0, 0]);
    assert.deepEqual([3 * source.tileWidth * xScale + frame.left, 2 * source.tileHeight * yScale + frame.top], [box.width, box.height]);
  });
}

test('trickplay keeps missing or invalid sheets dark and clamps time before the first tile', () => {
  const box = {width: 256, height: 144}, source = {url: '/trickplay.jpg', intervalMs: 10000, tileWidth: 320, tileHeight: 180, columns: 5, rows: 4};
  assert.equal(nativeTrickplayFrame(undefined, 1, box), undefined);
  assert.equal(nativeTrickplayFrame({...source, tileWidth: 0}, 1, box), undefined);
  assert.equal(nativeTrickplayFrame({...source, rows: Infinity}, 1, box), undefined);
  assert.equal(nativeTrickplayFrame(source, NaN, box), undefined);
  assert.deepEqual(nativeTrickplayFrame(source, -10, box), {width: 1280, height: 576, left: -0, top: -0});
});

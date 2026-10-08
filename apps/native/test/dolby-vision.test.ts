import test from 'node:test';
import assert from 'node:assert/strict';
import {dolbyVisionWarningNeeded} from '../src/player/dolby-vision.ts';

test('flags the new pre-play decision reason', () => {
  assert.equal(dolbyVisionWarningNeeded({decision: {video: {action: 'transcode', reasons: ['dolby_vision_colors_approximate']}}}), true);
  assert.equal(dolbyVisionWarningNeeded({decision: {video: {action: 'copy', reasons: []}}}), false);
});

test('older servers without the reason read as no warning', () => {
  assert.equal(dolbyVisionWarningNeeded({}), false);
  assert.equal(dolbyVisionWarningNeeded(null), false);
  assert.equal(dolbyVisionWarningNeeded({plan: {versionId: 'v1', mode: 'stream', streams: [{id: 'v0', action: 'transcode', reasons: ['dolby_vision_colors_approximate']}]}}), true);
});

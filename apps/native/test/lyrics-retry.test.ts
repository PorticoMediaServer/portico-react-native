import test from 'node:test';
import assert from 'node:assert/strict';
import {retryable} from '../src/player/lyrics-retry.ts';

test('lyrics offer Try again except when the library keeps to its own metadata', () => {
  assert.equal(retryable({code: 'local_metadata_only'}), false);
  assert.equal(retryable({code: 'unavailable'}), true);
  assert.equal(retryable(new TypeError('network')), true);
});

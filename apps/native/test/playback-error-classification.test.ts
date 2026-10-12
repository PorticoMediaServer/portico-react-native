import test from 'node:test';
import assert from 'node:assert/strict';

test('both platform HTTP facts share retryable and permanent delivery policy', async () => {
  const {classifyPlaybackFailure} = await import('../src/player/playback-failure.ts');
  for (const httpStatus of [403, 404, 410, 408, 429, 500, 503]) {
    const expectedNetwork = httpStatus >= 500 || httpStatus === 408 || httpStatus === 429;
    for (const networkError of [true, false]) {
      const result = classifyPlaybackFailure({httpStatus, networkError, engineCode: 'decode_error', hasPlayed: false});
      assert.equal(result.network, expectedNetwork, String(httpStatus));
      assert.equal(result.engine, null, 'HTTP never teaches a decoder failure');
    }
  }
});

test('startup engine failures retain fallback while healthy and delivery failures do not learn', async () => {
  const {classifyPlaybackFailure} = await import('../src/player/playback-failure.ts');
  assert.equal(classifyPlaybackFailure({hasPlayed: false}).engine, 'source_not_supported');
  assert.equal(classifyPlaybackFailure({hasPlayed: true}).engine, null);
  for (const hasPlayed of [false, true]) {
    assert.equal(classifyPlaybackFailure({hasPlayed, networkError: true, engineCode: 'decode_error'}).engine, null);
    assert.equal(classifyPlaybackFailure({hasPlayed, deliveryError: true, engineCode: 'decode_error'}).engine, null);
    assert.equal(classifyPlaybackFailure({hasPlayed, engineCode: 'decode_error'}).engine, 'decode_error');
    assert.equal(classifyPlaybackFailure({hasPlayed, engineCode: 'source_not_supported'}).engine, 'source_not_supported');
  }
  assert.equal(classifyPlaybackFailure({engineCode: 'engine_error'}).engine, null);
});

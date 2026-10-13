/**
 * The player tells media that can never be played apart from playback that stopped and may work
 * on another try, and offers "Try again" only for the second.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {cannotPlayReason} from '../src/player/cannot-play.ts';
import {failureFor, noteEngineFact, resetFailureFacts} from '../src/player/failure-facts.ts';

const ready = {routeReady: true, sameFailures: 0};

test('a server refusal that cannot change is not offered again', () => {
  assert.equal(cannotPlayReason({...ready, error: 'not_found'}), 'gone');
  assert.equal(cannotPlayReason({...ready, error: 'forbidden'}), 'denied');
  assert.equal(cannotPlayReason({...ready, error: 'unsupported_tuple'}), 'unsupported');
  assert.equal(cannotPlayReason({...ready, error: 'transcoding_disabled'}), 'conversionOff');
  assert.equal(cannotPlayReason({...ready, error: 'unknown_source_facts'}), 'unreadable');
  assert.equal(cannotPlayReason({...ready, error: 'This title can’t be played on this device.'}), 'unsupported');
  assert.equal(cannotPlayReason({...ready, error: 'This item isn’t available.'}), 'gone');
});

test('trouble that passes is still offered again', () => {
  for (const error of ['source_unavailable', 'owner_server_cap', 'timeout', 'lease_expired', 'internal_error', 'stream_limit_reached', 'The server could not be reached. Your playback position is retained.', '', undefined]) {
    assert.equal(cannotPlayReason({...ready, error}), null, String(error));
  }
  assert.equal(cannotPlayReason({...ready, fact: {networkError: true}}), null);
  assert.equal(cannotPlayReason({...ready, fact: {httpStatus: 503, networkError: true}}), null);
});

test('a refused file is tried once more before it is called missing', () => {
  // The first refusal may be a stream that had expired; a fresh start mends that.
  assert.equal(cannotPlayReason({routeReady: true, sameFailures: 1, fact: {httpStatus: 404}}), null);
  assert.equal(cannotPlayReason({routeReady: true, sameFailures: 2, fact: {httpStatus: 404}}), 'fileMissing');
  assert.equal(cannotPlayReason({routeReady: true, sameFailures: 2, fact: {httpStatus: 403}}), 'fileMissing');
  assert.equal(cannotPlayReason({routeReady: true, sameFailures: 2, fact: {deliveryError: true}}), 'fileMissing');
  assert.equal(cannotPlayReason({routeReady: true, sameFailures: 5, fact: {httpStatus: 429}}), null);
});

test('an engine that gave up is final only when the server could be asked for another way', () => {
  assert.equal(cannotPlayReason({routeReady: true, sameFailures: 0, fact: {engine: true}}), 'unsupported');
  assert.equal(cannotPlayReason({routeReady: false, sameFailures: 0, fact: {engine: true}}), null);
});

test('the engine\'s facts are kept per attempt and refusals are counted per title', () => {
  resetFailureFacts();
  noteEngineFact({type: 'error', intentId: 1, httpStatus: 404, hasPlayed: false}, 'film');
  assert.deepEqual(failureFor(1, 'film'), {fact: {httpStatus: 404}, sameFailures: 1});
  // The engine repeating itself within one attempt is one refusal.
  noteEngineFact({type: 'error', intentId: 1, httpStatus: 404, hasPlayed: false}, 'film');
  assert.equal(failureFor(1, 'film').sameFailures, 1);
  // A fact for another attempt says nothing about this one.
  assert.equal(failureFor(2, 'film').fact, undefined);
  noteEngineFact({type: 'error', intentId: 2, httpStatus: 404, hasPlayed: false}, 'film');
  assert.equal(failureFor(2, 'film').sameFailures, 2);
  assert.equal(cannotPlayReason({routeReady: true, ...failureFor(2, 'film')}), 'fileMissing');
  // Another title starts its own count.
  noteEngineFact({type: 'error', intentId: 3, httpStatus: 410, hasPlayed: false}, 'other');
  assert.equal(failureFor(3, 'other').sameFailures, 1);
  assert.equal(failureFor(3, 'film').sameFailures, 0);
});

test('playback that moves again clears the count, and a network failure never adds to it', () => {
  resetFailureFacts();
  noteEngineFact({type: 'error', intentId: 1, httpStatus: 403, hasPlayed: true}, 'film');
  noteEngineFact({type: 'progress', intentId: 2, position: 12}, 'film');
  assert.equal(failureFor(2, 'film').sameFailures, 0);
  noteEngineFact({type: 'error', intentId: 3, networkError: true, hasPlayed: true}, 'film');
  assert.deepEqual(failureFor(3, 'film'), {fact: {networkError: true}, sameFailures: 0});
  noteEngineFact({type: 'error', intentId: 4, httpStatus: 503}, 'film');
  assert.equal(failureFor(4, 'film').sameFailures, 0);
});

test('a decoder refusal is recorded as the engine\'s, and a start that fails for an uncertain cause is not', () => {
  resetFailureFacts();
  noteEngineFact({type: 'error', intentId: 1, engineCode: 'decode_error', hasPlayed: true}, 'film');
  assert.deepEqual(failureFor(1, 'film').fact, {engine: true});
  noteEngineFact({type: 'error', intentId: 2, hasPlayed: false, uncertain: true}, 'film');
  assert.deepEqual(failureFor(2, 'film').fact, {});
});

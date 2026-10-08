import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../../../packages/client-core/src/index.ts';
import {challengeNotProven} from '../../../packages/client-core/src/portico-servers.ts';
import {unreadableServerResponse} from '../../../packages/client-core/src/server-messages.ts';
import {classifyPorticoFailure} from '../src/app/portico-failure.ts';

const kind = (e: unknown, stage: 'route' | 'signIn', category?: string) => classifyPorticoFailure(e, stage, 'E2E Server', category).kind;

test('each failure names what failed', () => {
  assert.equal(kind(new ApiError(403, 'access_refused', 'x'), 'signIn'), 'noAccess');
  assert.equal(kind(new ApiError(403, 'permission_denied', 'x'), 'route'), 'noAccess', 'Portico refuses the routes of a server that removed the account');
  assert.equal(kind(new ApiError(401, 'clock_skew', 'x'), 'signIn'), 'clockSkew');
  assert.equal(kind(new Error(challengeNotProven), 'signIn'), 'identity');
  assert.equal(kind(new ApiError(0, 'offline', 'x'), 'route', 'offline'), 'unreachable');
  assert.equal(kind(new ApiError(0, 'timeout', 'x'), 'signIn', 'timeout'), 'unreachable');
});

test('the e2e generic error: an app without the challenge nonce on a newer server is a version mismatch', () => {
  // POST /v1/direct/portico-challenge {} → 400 {"error":{"code":"invalid_request",...}}
  const f = classifyPorticoFailure(new ApiError(400, 'invalid_request', 'The request could not be completed.'), 'signIn', 'E2E Server', 'invalid-input');
  assert.deepEqual(f, {kind: 'incompatible', server: 'E2E Server', code: 'invalid_request', status: 400});
  assert.equal(kind(new Error(unreadableServerResponse), 'signIn'), 'incompatible', 'an older server without the challenge proof');
  assert.equal(kind(new ApiError(404, 'not_found', 'x'), 'signIn'), 'incompatible');
});

test('a fault in this app is not reported as an unreachable server', () => {
  // Seen on the e2e: Hermes has no WebCrypto, and the missing crypto read as "Can't reach".
  assert.equal(kind(new TypeError("Cannot read property 'getRandomValues' of undefined"), 'signIn', 'unreachable'), 'other');
  assert.equal(kind(new TypeError('Network request failed'), 'route', 'unreachable'), 'unreachable');
});

test('anything else is "other", carrying its code for the message', () => {
  const f = classifyPorticoFailure(new ApiError(500, 'internal', 'x'), 'signIn', 'S');
  assert.equal(f.kind, 'other');
  assert.equal(f.code, 'internal');
  assert.equal(kind(new ApiError(400, 'invalid_request', 'x'), 'route'), 'other', 'a malformed route answer is not a version mismatch');
});

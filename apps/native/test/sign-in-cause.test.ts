import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../../../packages/client-core/src/index.ts';
import {challengeNotProven} from '../../../packages/client-core/src/portico-servers.ts';
import {signInCause, signInMessage} from '../src/app/errors.ts';

const server = 'E2E Server';
const cause = (e: unknown, category?: string) => signInCause(e, category, server);

test('every way a server sign-in ends has its own words (INT gate b)', () => {
  const said = {
    noAccess: cause(new ApiError(403, 'access_refused', 'x')),
    clockSkew: cause(new ApiError(401, 'clock_skew', 'x')),
    identity: cause(new Error(challengeNotProven)),
    devicePending: cause(new ApiError(403, 'device_approval_pending', 'x')),
    deviceDenied: cause(new ApiError(403, 'device_denied', 'x')),
    unreachable: cause(new ApiError(0, 'offline', 'x'), 'offline'),
    incompatible: cause(new ApiError(400, 'invalid_request', 'x')),
  };
  for (const [kind, text] of Object.entries(said)) assert.ok(text && text.length > 10, kind);
  assert.equal(new Set(Object.values(said)).size, Object.keys(said).length, 'no two causes share a message');
  assert.ok(said.noAccess!.includes(server));
  assert.ok(!/browser/i.test(said.devicePending!), 'an iPhone or TV is not "this browser"');
  for (const text of Object.values(said)) assert.ok(!/weren.t accepted/i.test(text!), 'never the generic "details weren\'t accepted"');
});

test('a sign-in the server moved to its own membership is re-admitted silently: nothing is said', () => {
  assert.equal(cause(new ApiError(401, 'session_migrated', 'x')), '');
  assert.equal(signInMessage(new ApiError(401, 'session_migrated', 'x')), '');
});

test('signInMessage uses the specific cause before any generic answer', () => {
  assert.equal(signInMessage(new ApiError(401, 'clock_skew', 'x')), signInCause(new ApiError(401, 'clock_skew', 'x')));
  assert.equal(signInMessage(new ApiError(403, 'access_refused', 'x')), signInCause(new ApiError(403, 'access_refused', 'x')));
});

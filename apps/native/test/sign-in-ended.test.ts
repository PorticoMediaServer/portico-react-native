/** Justin (23 Sep): an ended sign-in goes back to sign-in; an unreachable server keeps the shell. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeEnding, savedStateAfter, stepAfterEnding} from '../src/app/sign-in-ended.ts';
import {SessionRefreshError, ACCESS_REFUSED, REFRESH_OUTSIDE_HOURS} from '../../../packages/client-core/src/server-connections.ts';
import {RouteError} from '../../../packages/client-core/src/route-identity.ts';
import {ApiError} from '../../../packages/client-core/src/index.ts';

test('the same endings as web: a refused renewal, or access refused', () => {
  assert.equal(resumeEnding(new SessionRefreshError('refresh_refused', 'ended', true), ACCESS_REFUSED), 'ended');
  assert.equal(resumeEnding(new RouteError(ACCESS_REFUSED, 'no access'), ACCESS_REFUSED), 'noAccess');
});

test('another server answering at the address ends nothing: the sign-in is kept and the shell says so', () => {
  assert.equal(resumeEnding(new Error('offline'), ACCESS_REFUSED), undefined);
  assert.equal(resumeEnding(new RouteError('identity_mismatch', 'another server'), ACCESS_REFUSED), undefined);
  assert.equal(savedStateAfter(new Error('offline'), true, REFRESH_OUTSIDE_HOURS), 'replaced');
  assert.equal(savedStateAfter(new Error('offline'), false, REFRESH_OUTSIDE_HOURS), 'offline');
});

test('an account outside its allowed hours stays signed in, and the shell says why', () => {
  const error = new SessionRefreshError(REFRESH_OUTSIDE_HOURS, 'not now', false, 403);
  assert.equal(resumeEnding(error, ACCESS_REFUSED), undefined, 'nothing is ended');
  assert.equal(savedStateAfter(error, false, REFRESH_OUTSIDE_HOURS), 'outsideHours');
  assert.equal(savedStateAfter(error, true, REFRESH_OUTSIDE_HOURS), 'outsideHours');
});

test('everything else keeps the saved sign-in and the shell', () => {
  for (const error of [
    new TypeError('network'),
    new RouteError('route_unavailable', 'unavailable'),
    new SessionRefreshError('refresh_unavailable_now', 'later', false, 400),
    new ApiError(503, 'unavailable', 'down', true),
    new ApiError(429, 'rate_limited', 'wait', true),
    new ApiError(404, 'not_found', 'gone', false),
  ]) assert.equal(resumeEnding(error, ACCESS_REFUSED), undefined, String((error as {code?: string}).code ?? error.name));
});

test('sign-in opens where the sign-in can be renewed', () => {
  assert.equal(stepAfterEnding('local', false, false), 'direct');
  assert.equal(stepAfterEnding('local', true, true), 'direct');
  assert.equal(stepAfterEnding('hosted', true, false), 'landing', 'a signed-in Portico Account goes to the shell landing, never a chooser screen');
  assert.equal(stepAfterEnding('hosted', false, false), 'hosted');
  assert.equal(stepAfterEnding('hosted', false, true), 'welcome');
});

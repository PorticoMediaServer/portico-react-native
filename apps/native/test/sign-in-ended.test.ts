/** Justin (23 Sep): an ended sign-in goes back to sign-in; an unreachable server keeps the shell. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeEnding, stepAfterEnding} from '../src/app/sign-in-ended.ts';
import {SessionRefreshError, ACCESS_REFUSED} from '../../../packages/client-core/src/server-connections.ts';
import {RouteError} from '../../../packages/client-core/src/route-identity.ts';
import {ApiError} from '../../../packages/client-core/src/index.ts';

test('the same endings as web: a refused renewal, access refused, or another server at the address', () => {
  assert.equal(resumeEnding(new SessionRefreshError('refresh_refused', 'ended', true), false, ACCESS_REFUSED), 'ended');
  assert.equal(resumeEnding(new RouteError(ACCESS_REFUSED, 'no access'), false, ACCESS_REFUSED), 'noAccess');
  assert.equal(resumeEnding(new Error('offline'), true, ACCESS_REFUSED), 'reset');
});

test('everything else keeps the saved sign-in and the shell', () => {
  for (const error of [
    new TypeError('network'),
    new RouteError('route_unavailable', 'unavailable'),
    new SessionRefreshError('refresh_unavailable_now', 'later', false, 400),
    new ApiError(503, 'unavailable', 'down', true),
    new ApiError(429, 'rate_limited', 'wait', true),
    new ApiError(404, 'not_found', 'gone', false),
  ]) assert.equal(resumeEnding(error, false, ACCESS_REFUSED), undefined, String((error as {code?: string}).code ?? error.name));
});

test('sign-in opens where the sign-in can be renewed', () => {
  assert.equal(stepAfterEnding('local', false, false), 'direct');
  assert.equal(stepAfterEnding('local', true, true), 'direct');
  assert.equal(stepAfterEnding('hosted', true, false), 'landing', 'a signed-in Portico Account goes to the shell landing, never a chooser screen');
  assert.equal(stepAfterEnding('hosted', false, false), 'hosted');
  assert.equal(stepAfterEnding('hosted', false, true), 'welcome');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../../../packages/client-core/src/index.ts';
import {isAccessRefused} from '../../../packages/client-core/src/portico-servers.ts';
import {routeRefusal} from '../src/app/portico-refusal.ts';

test('Portico refusing a server’s routes is the server’s access_refused', () => {
  assert.ok(isAccessRefused(routeRefusal(new ApiError(403, 'permission_denied', 'This operation is not permitted.'))));
  const offline = new ApiError(503, 'unavailable', 'Try again.');
  assert.equal(routeRefusal(offline), offline);
  const plain = new Error('x');
  assert.equal(routeRefusal(plain), plain);
});

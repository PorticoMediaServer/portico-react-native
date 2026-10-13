/** A television signing in with a code says when it is the owner's approval of the device that is awaited. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../../../packages/client-core/src/index.ts';
import {deviceApprovalWatch} from '../src/bridge/device-approval.ts';

const refuse = (status: number, code: string) => async () => { throw new ApiError(status, code, code, false); };

test('"waiting for the owner" and "turned away" are told apart from a code still waiting', async () => {
  const approval = deviceApprovalWatch();
  let changes = 0;
  approval.subscribe(() => { changes++; });
  await assert.rejects(approval.watch(refuse(400, 'authorization_pending')));
  assert.equal(approval.getSnapshot(), undefined);
  await assert.rejects(approval.watch(refuse(403, 'device_approval_pending')), (e: unknown) => e instanceof ApiError && e.code === 'device_approval_pending', 'the answer is passed on, so the code keeps being asked for');
  assert.equal(approval.getSnapshot(), 'pending');
  await assert.rejects(approval.watch(refuse(403, 'device_approval_pending')));
  assert.equal(changes, 1, 'the same answer again is not news');
  await assert.rejects(approval.watch(refuse(403, 'device_denied')));
  assert.equal(approval.getSnapshot(), 'denied');
});

test('the owner approving clears it, and losing the connection does not', async () => {
  const approval = deviceApprovalWatch();
  await assert.rejects(approval.watch(refuse(403, 'device_approval_pending')));
  await assert.rejects(approval.watch(async () => { throw new TypeError('Network request failed'); }));
  assert.equal(approval.getSnapshot(), 'pending', 'an unanswered poll says nothing about the owner');
  assert.equal(await approval.watch(async () => 'session'), 'session');
  assert.equal(approval.getSnapshot(), undefined);
  await assert.rejects(approval.watch(refuse(403, 'device_approval_pending')));
  await assert.rejects(approval.watch(refuse(400, 'expired_token')));
  assert.equal(approval.getSnapshot(), undefined, 'a new code starts clean');
});

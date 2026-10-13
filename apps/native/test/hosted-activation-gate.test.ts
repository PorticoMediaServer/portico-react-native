/**
 * Television activation obeys the app's one gate for the Portico Account service: when anything
 * has learned the service is down, timed polls wait with it; what a person asks for still goes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../../../packages/client-core/src/index.ts';
import {HostedGate} from '../../../packages/client-core/src/hosted-gate.ts';
import {EXPLICIT_MS, activationGate} from '../src/bridge/hosted-activation-gate.ts';

function setup() {
  let now = 1_000_000;
  const clock = {now: () => now, random: () => 0};
  const shared = new HostedGate(clock);
  const sent: string[] = [];
  const ok = (name: string) => async () => { sent.push(name); return name; };
  const failing = (name: string, error: unknown) => async () => { sent.push(name); throw error; };
  return {shared, sent, ok, failing, gate: activationGate(shared, clock.now), advance: (ms: number) => { now += ms; }};
}
const refusedLocally = (e: unknown) => e instanceof ApiError && e.code === 'account_service_recovering';

test('another feature learning of a two-minute outage keeps the television from polling at 30, 60 and 90 seconds', async () => {
  const {shared, sent, ok, gate, advance} = setup();
  // Something else in the app (renewing the account sign-in, say) is told to come back in 120 seconds.
  shared.observe(new ApiError(503, 'unavailable', 'down', true, 120));
  for (const at of [30, 60, 90]) {
    advance(30_000);
    await assert.rejects(gate.run('poll', ok('poll@' + at)), (e: unknown) => refusedLocally(e) && (e as ApiError).retryAfterSeconds === 120 - at);
  }
  assert.deepEqual(sent, [], 'nothing was sent while the gate was closed');
  advance(30_000);
  assert.equal(await gate.run('poll', ok('poll@120')), 'poll@120');
  assert.deepEqual(sent, ['poll@120']);
});

test('the refusal says how long is left, so the next attempt is not scheduled sooner than the gate allows', async () => {
  const {shared, ok, gate, advance} = setup();
  shared.observe(new ApiError(429, 'rate_limited', 'slow', true, 600));
  advance(1_000);
  await assert.rejects(gate.run('poll', ok('poll')), (e: unknown) => refusedLocally(e) && (e as ApiError).retryAfterSeconds === 599, 'a ten-minute wait is not shortened to thirty seconds');
});

test('what a person asks for goes through a closed gate, and a timed retry of the same thing does not', async () => {
  const {shared, sent, ok, gate, advance} = setup();
  shared.observe(new ApiError(503, 'unavailable', 'down', true, 120));
  gate.userActed();
  assert.equal(await gate.run('create', ok('create by hand')), 'create by hand');
  // It answered: the gate is open again for everyone.
  assert.equal(shared.blockedFor(), 0);
  shared.observe(new ApiError(503, 'unavailable', 'down', true, 120));
  advance(EXPLICIT_MS + 1);
  await assert.rejects(gate.run('create', ok('create by timer')), refusedLocally);
  await assert.rejects(gate.run('cancel', ok('tidy up')), refusedLocally);
  gate.userActed();
  assert.equal(await gate.run('cancel', ok('cancel by hand')), 'cancel by hand');
  // A poll is never a person, even just after one acted.
  shared.observe(new ApiError(503, 'unavailable', 'down', true, 120));
  gate.userActed();
  await assert.rejects(gate.run('poll', ok('poll')), refusedLocally);
  assert.deepEqual(sent, ['create by hand', 'cancel by hand']);
});

test('"still waiting" and "slow down" are answers: they do not end sign-in and never close the gate', async () => {
  const {shared, failing, gate} = setup();
  for (const [status, code] of [[400, 'authorization_pending'], [429, 'slow_down'], [400, 'slow_down'], [400, 'access_denied'], [400, 'expired_token']] as const) {
    await assert.rejects(gate.run('poll', failing('poll', new ApiError(status, code, code, false, code === 'slow_down' ? 10 : undefined))), (e: unknown) => e instanceof ApiError && e.code === code);
    assert.equal(shared.blockedFor(), 0, code + ' left the gate open');
    assert.equal(shared.getSnapshot().failures, 0);
  }
});

test('the account service failing under activation closes the gate for the whole app', async () => {
  const {shared, sent, ok, failing, gate} = setup();
  await assert.rejects(gate.run('poll', failing('poll', new ApiError(503, 'unavailable', 'down', true, 90))));
  assert.ok(shared.blockedFor() >= 90_000, 'the wait the service asked for is never undercut');
  await assert.rejects(gate.run('poll', ok('second poll')), refusedLocally);
  await assert.rejects(gate.run('poll', failing('x', new TypeError('Network request failed'))), refusedLocally);
  assert.deepEqual(sent, ['poll']);
});

test('no answer at all counts as the service being unreachable', async () => {
  const {shared, failing, gate} = setup();
  await assert.rejects(gate.run('create', failing('create', new TypeError('Network request failed'))));
  assert.ok(shared.blockedFor() > 0);
});

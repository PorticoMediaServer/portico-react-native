import test from 'node:test';
import assert from 'node:assert/strict';
import {HOME_READ_TIMEOUT_MS, HomeReads, HomeRetry, homeRetryDelay} from '../src/app/home-requests.ts';

const never = () => new Promise<never>(() => {});

test('a hung Home transport is cancelled and reported as a retryable timeout', async t => {
  t.mock.timers.enable({apis: ['setTimeout', 'Date']});
  const reads = new HomeReads();
  let signal!: AbortSignal;
  const request = reads.read('home', s => { signal = s; return never(); });
  const failure = assert.rejects(request, {code: 'timeout'});
  t.mock.timers.tick(HOME_READ_TIMEOUT_MS);
  await failure;
  assert.equal(signal.aborted, true);
  assert.equal(reads.size, 0);
});

test('replacing Home aborts obsolete work without an old completion losing the new request', async () => {
  const reads = new HomeReads();
  let oldSignal!: AbortSignal;
  const old = reads.read('home', s => { oldSignal = s; return never(); });
  const obsolete = assert.rejects(old, {name: 'AbortError'});
  let resolve!: (value: string) => void;
  const current = reads.read('home', () => new Promise<string>(done => { resolve = done; }));
  const row = reads.read('row-a', never);
  const rowCancelled = assert.rejects(row, {name: 'AbortError'});
  await obsolete;
  assert.equal(oldSignal.aborted, true);
  assert.equal(reads.has('home'), true);
  assert.equal(reads.has('row-a'), true);
  const joined = reads.settled('home');
  assert.ok(joined);
  resolve('new Home');
  assert.equal(await current, 'new Home');
  await joined;
  assert.equal(reads.settled('home'), undefined);
  assert.equal(reads.has('home'), false);
  reads.cancel();
  await rowCancelled;
});

test('unmount/background cancellation stops all row reads, even with an uncooperative fetch', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const reads = new HomeReads();
  const signals: AbortSignal[] = [];
  const failures = ['row-a', 'row-b'].map(key => assert.rejects(reads.read(key, signal => {
    signals.push(signal); return never();
  }), {name: 'AbortError'}));
  reads.cancel();
  await Promise.all(failures);
  assert.equal(reads.size, 0);
  assert.ok(signals.every(signal => signal.aborted));
  t.mock.timers.tick(HOME_READ_TIMEOUT_MS * 2);
});

test('foreground resume respects remaining server retry time and runs just once', t => {
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 0});
  const retry = new HomeRetry(true);
  let attempts = 0;
  retry.schedule(homeRetryDelay(0, {retryAfterSeconds: 30}, () => 0), () => attempts++);
  t.mock.timers.tick(5000);
  retry.setActive(false);
  t.mock.timers.tick(10000);
  assert.equal(attempts, 0);
  retry.setActive(true);
  t.mock.timers.tick(15000);
  assert.equal(attempts, 0);
  t.mock.timers.tick(1);
  assert.equal(attempts, 1);
  retry.setActive(true);
  t.mock.timers.tick(60000);
  assert.equal(attempts, 1);
});

test('a background client never retries and a cancelled retry cannot revive on resume', t => {
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 0});
  const retry = new HomeRetry(false);
  let attempts = 0;
  retry.schedule(1000, () => attempts++);
  t.mock.timers.tick(60000);
  assert.equal(attempts, 0);
  retry.setActive(true);
  t.mock.timers.tick(0);
  assert.equal(attempts, 1);
  retry.schedule(1000, () => attempts++);
  retry.setActive(false);
  retry.cancel();
  retry.setActive(true);
  t.mock.timers.tick(60000);
  assert.equal(attempts, 1);
});

test('retry jitter spreads clients without violating Retry-After, and sustained outages back off', () => {
  const delays = [0, .25, .5, .75, 1].map(value => homeRetryDelay(0, {retryAfterSeconds: 120}, () => value));
  assert.ok(delays.every(delay => delay > 120000));
  assert.equal(new Set(delays).size, delays.length);
  assert.ok(homeRetryDelay(5, undefined, () => 0) > homeRetryDelay(3, undefined, () => 0));
  assert.ok(homeRetryDelay(10000, undefined, () => 1) < 75000);
  assert.ok(Number.isFinite(homeRetryDelay(0, {retryAfterSeconds: Infinity})));
});

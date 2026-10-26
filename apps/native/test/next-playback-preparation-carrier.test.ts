import test from 'node:test';
import assert from 'node:assert/strict';
import {NativePlayback} from '../src-next/platform/playback/native-playback';
import type {StartPreparation, Timers} from '../../../packages/client-core/src/playback-v1/sessions';
import {PlaybackApiError, type V1Http, type V1Request, type V1Response} from '../../../packages/client-core/src/playback-v1/http';
import {ContractError} from '../../../packages/client-core/src/playback-v1/types';

// Native bridge seam only: synthetic preparation carriers never create, install or
// load a Session, and they are not producer enablement. Every wait is driven by the
// controlled Timers seam below; nothing here sleeps or reads a wall clock.
const microtaskTimers: Timers = {now: () => 0, setTimer: callback => {queueMicrotask(callback); return 1;}, clearTimer() {}};

type Queued = {callback: () => void; wait: number; id: number};
type Controlled = Readonly<{timers: Timers; queued: Queued[]; cleared: unknown[]}>;

/** Timers seam: waits are recorded and fired only by the test. */
function controlled(): Controlled {
  const queued: Queued[] = [], cleared: unknown[] = [];
  return {queued, cleared, timers: {
    now: () => 0,
    setTimer(callback, wait) {queued.push({callback, wait, id: queued.length + 1}); return queued.length;},
    clearTimer(timer) {cleared.push(timer);},
  }};
}

/** Let the carrier's own awaits settle without a clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** Fire one queued wait, as the host timer would. */
async function fireOne(harness: Controlled): Promise<void> {
  const next = harness.queued.shift();
  assert.ok(next, 'a bounded wait was queued');
  next.callback();
  await settle();
}

/** Capture a start outcome without leaving a rejected promise unobserved while the test pumps. */
function outcome<T>(pending: Promise<T>): Promise<unknown> {
  return pending.then(() => {throw new Error('the start was expected to fail');}, error => error);
}

function refusal(code: string): {status: number; headers: Record<string, string>; body: unknown} {
  return {status: 409, headers: {}, body: {error: {code, message: 'Original operation expired.'}}};
}

test('queue host forwards original sixth-context preparation notice before any Session exists', async () => {
  const requests: V1Request[] = [], notices: StartPreparation[] = [];
  const http: V1Http = {async send(request) {
    requests.push(request);
    return requests.length === 1 ? {status: 202, headers: {}, body: {retryAfterMs: 1}}
      : refusal('request_expired');
  }};
  const path = new NativePlayback({http, timers: microtaskTimers});
  const life = new AbortController(); let captures = 0;
  try {
    await assert.rejects(path.transport.start({itemId: 'item'}, {state: 'playing'}, 'original', 10, life.signal,
      {isCurrent: () => !life.signal.aborted, onPreparing: (_wait, notice) => {notices.push(notice);}, capturePreparing: () => {captures++; return undefined;}}));
    assert.equal(requests.length, 2); assert.equal(requests[0]!.body, requests[1]!.body);
    assert.equal(requests[0]!.signal, life.signal); assert.equal(requests[1]!.signal, life.signal);
    assert.deepEqual(notices, [{messageId: 'player.preparing.slowStart', retryAfterMs: 250}], 'the canonical notice retains the pacing floor');
    assert.equal(captures, 0, 'retry-only has no resource receipt');
    assert.equal(path.controller.getSnapshot().session, undefined);
  } finally {path.dispose();}
});

test('original sixth-context retirement prevents the first native start dispatch', async () => {
  let sends = 0, notices = 0;
  const path = new NativePlayback({http: {async send() {sends++; throw new Error('must not send');}}, timers: microtaskTimers});
  try {
    await assert.rejects(path.transport.start({itemId: 'item'}, {}, 'original', 10, undefined,
      {isCurrent: () => false, onPreparing: () => {notices++;}}));
    assert.equal(sends, 0); assert.equal(notices, 0); assert.equal(path.controller.getSnapshot().session, undefined);
  } finally {path.dispose();}
});

test('repeated valid retry-only preparations keep one frozen request and the real pacing floors', async () => {
  const harness = controlled();
  const requests: V1Request[] = [], waits: number[] = [], notices: StartPreparation[] = [];
  const argCounts: number[] = [], sessionsDuringNotice: unknown[] = [];
  let captures = 0;
  const wireWaits = [1, 400, 2_500];
  const http: V1Http = {async send(request) {requests.push(request);
    if (requests.length <= wireWaits.length) return {status: 202, headers: {}, body: {retryAfterMs: wireWaits[requests.length - 1]}};
    return refusal('request_expired');}};
  const path = new NativePlayback({http, timers: harness.timers});
  const life = new AbortController();
  try {
    const pending = outcome(path.transport.start({itemId: 'item'}, {state: 'playing'}, 'original', 10, life.signal, {
      isCurrent: () => !life.signal.aborted,
      onPreparing: (...args: [number, StartPreparation]) => {
        argCounts.push(args.length); waits.push(args[0]); notices.push(args[1]);
        sessionsDuringNotice.push(path.controller.getSnapshot().session);
      },
      capturePreparing: () => {captures++; return undefined;},
    }));
    // Drive each declared wait in turn; the carrier decides every request itself.
    for (let step = 0; step < wireWaits.length; step++) {await settle(); await fireOne(harness);}
    const error = await pending;
    assert.ok(error instanceof PlaybackApiError, 'the terminal refusal is the caller-visible failure');
    assert.equal(error.code, 'request_expired');
    assert.equal(error.status, 409);
    assert.equal(requests.length, wireWaits.length + 1, 'one original request plus one replay per valid 202, then the terminal refusal');
    const first = requests[0]!;
    assert.deepEqual(Object.keys(first.body as Record<string, unknown>).sort(), ['itemId', 'state'], 'the minimal body is the frozen original');
    assert.ok(Object.isFrozen(first.body), 'the body is frozen once');
    assert.ok(Object.isFrozen(first.headers), 'the headers are frozen once');
    for (const request of requests) {
      assert.equal(request.body, first.body, 'every replay sends the identical frozen body');
      assert.equal(request.headers, first.headers, 'every replay sends the identical frozen key header');
      assert.equal(request.headers?.['Idempotency-Key'], 'original');
      assert.equal(request.signal, life.signal, 'every replay keeps the original lifetime signal');
    }
    assert.deepEqual(waits, [250, 400, 2_500], 'each canonical notice uses max(250, declared wait)');
    assert.deepEqual(notices, waits.map(wait => ({messageId: 'player.preparing.slowStart', retryAfterMs: wait})));
    assert.ok(notices.every(notice => Object.isFrozen(notice)));
    assert.deepEqual(argCounts, [2, 2, 2], 'the preparing callback receives only the wait and its notice');
    assert.deepEqual(harness.queued.map(entry => entry.wait), [], 'no wait survives the terminal refusal');
    assert.deepEqual(sessionsDuringNotice, [undefined, undefined, undefined], 'a retry-only preparation installs nothing');
    assert.equal(captures, 0, 'a minimal retry-only preparation never captures a resource');
    assert.equal(path.controller.getSnapshot().session, undefined);
  } finally {path.dispose();}
});

test('abort during the captured wait stops the carrier and a queued timer callback does nothing', async () => {
  const harness = controlled();
  const requests: V1Request[] = [], notices: StartPreparation[] = [];
  const http: V1Http = {async send(request) {requests.push(request); return {status: 202, headers: {}, body: {retryAfterMs: 5_000}};}};
  const path = new NativePlayback({http, timers: harness.timers});
  const life = new AbortController();
  try {
    const pending = outcome(path.transport.start({itemId: 'item'}, {}, 'original', 10, life.signal, {
      isCurrent: () => !life.signal.aborted,
      onPreparing: (_wait, notice) => {notices.push(notice);},
    }));
    await settle();
    assert.equal(requests.length, 1);
    assert.deepEqual(harness.queued.map(entry => entry.wait), [5_000], 'the carrier is inside the captured wait');
    life.abort();
    assert.equal((await pending as Error).name, 'AbortError');
    assert.equal(notices.length, 1, 'no notice follows the cancellation');
    assert.deepEqual(harness.cleared, [1], 'the queued timer is cleared through the Timers seam');
    // The host may still deliver an already-queued callback after cancellation.
    harness.queued.shift()?.callback();
    await settle();
    assert.equal(requests.length, 1, 'a late timer callback sends no further start');
    assert.equal(notices.length, 1, 'a late timer callback emits no later notice');
    assert.equal(path.controller.getSnapshot().session, undefined);
  } finally {path.dispose();}
});

test('original-currentness retirement during the captured wait stops before the next start', async () => {
  const harness = controlled();
  const requests: V1Request[] = [], notices: StartPreparation[] = [];
  let current = true;
  const http: V1Http = {async send(request) {requests.push(request); return {status: 202, headers: {}, body: {retryAfterMs: 900}};}};
  const path = new NativePlayback({http, timers: harness.timers});
  try {
    const pending = outcome(path.transport.start({itemId: 'item'}, {}, 'original', 10, undefined, {
      isCurrent: () => current,
      onPreparing: (_wait, notice) => {notices.push(notice);},
    }));
    await settle();
    assert.equal(requests.length, 1);
    current = false;                       // the original context retires while waiting
    await fireOne(harness);
    assert.equal((await pending as Error).name, 'AbortError');
    assert.equal(requests.length, 1, 'retirement during the wait issues no further start');
    assert.equal(notices.length, 1, 'retirement emits no later notice');
    assert.equal(path.controller.getSnapshot().session, undefined);
  } finally {path.dispose();}
});

test('invalid retry-only bodies are rejected without a notice, resource or retry', async () => {
  const invalid: unknown[] = [
    {retryAfterMs: 250, unexpected: true},
    {retryAfterMs: 0},
    {retryAfterMs: 1.5},
    {retryAfterMs: 10_001},
    {retryAfterMs: '250'},
  ];
  for (const body of invalid) {
    const requests: V1Request[] = [], notices: StartPreparation[] = [];
    let captures = 0;
    const path = new NativePlayback({http: {async send(request) {
      requests.push(request);
      // A body the strict parser must reject: fail cleanly instead of polling.
      if (requests.length > 1) throw new Error('an invalid 202 was retried');
      return {status: 202, headers: {}, body};
    }}, timers: microtaskTimers});
    try {
      await assert.rejects(path.transport.start({itemId: 'item'}, {}, 'original', 10, undefined,
        {onPreparing: (_wait, notice) => {notices.push(notice);}, capturePreparing: () => {captures++; return undefined;}}),
        (error: unknown) => error instanceof ContractError && /Unreadable playback response/.test((error as Error).message));
      assert.equal(requests.length, 1, 'an invalid 202 is never polled again');
      assert.equal(notices.length, 0, 'an invalid 202 never emits a preparing notice');
      assert.equal(captures, 0, 'an invalid 202 never captures a resource');
      assert.equal(path.controller.getSnapshot().session, undefined);
    } finally {path.dispose();}
  }
});

test('terminal and capacity responses are forwarded as their own failures without preparation state', async () => {
  // Each case is a complete V1Response, so V1Http.send keeps its real result type.
  const cases: {response: V1Response; code: string}[] = [
    {code: 'request_expired', response: {status: 409, headers: {}, body: {error: {code: 'request_expired', retry: 'never', message: 'Original operation expired.'}}}},
    {code: 'conversion_capacity', response: {status: 503, headers: {}, body: {error: {code: 'conversion_capacity', retry: 'same_request', message: 'The server is at its conversion limit.'}}}},
    // A held-stream refusal is not preparation either: it must not emit a notice or a Session.
    {code: 'stream_limit_reached', response: {status: 429, headers: {}, body: {error: {code: 'stream_limit_reached', retry: 'never', message: 'The account is already playing on its allowed screens.'}}}},
  ];
  for (const {response, code} of cases) {
    const requests: V1Request[] = [], notices: StartPreparation[] = [];
    let captures = 0;
    const path = new NativePlayback({http: {async send(request) {requests.push(request); return response;}}, timers: microtaskTimers});
    try {
      await assert.rejects(path.transport.start({itemId: 'item'}, {}, 'original', 10, undefined,
        {onPreparing: (_wait, notice) => {notices.push(notice);}, capturePreparing: () => {captures++; return undefined;}}),
        (error: unknown) => error instanceof PlaybackApiError && error.status === response.status && error.code === code);
      assert.equal(requests.length, 1, 'a terminal reply is not retried');
      assert.equal(notices.length, 0);
      assert.equal(captures, 0);
      assert.equal(path.controller.getSnapshot().session, undefined);
    } finally {path.dispose();}
  }
});

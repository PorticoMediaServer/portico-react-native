import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useState, useSyncExternalStore} from 'react';
import {act, createHookHost} from './hook-driver.ts';
import {createPlatformPostureStore, type PlatformPostureTransport} from '../src-next/platform/platformPostureStore.ts';

const feature = {
  bounds: {left: 590, top: 0, right: 610, bottom: 900},
  state: 'half-opened', orientation: 'vertical', isSeparating: true, occlusion: 'full',
};
const report = (revision: number, folds: unknown[] = [feature]) => ({revision, status: 'available', window: {width: 1200, height: 900}, folds});

function driver() {
  let listener: ((value: unknown) => void) | undefined;
  let subscriptions = 0, removals = 0;
  const requests: Array<{resolve: (value: unknown) => void; reject: (reason?: unknown) => void}> = [];
  const transport: PlatformPostureTransport = {
    subscribe: next => {
      subscriptions++;
      listener = next;
      return () => { removals++; if (listener === next) listener = undefined; };
    },
    getSnapshot: () => new Promise((resolve, reject) => requests.push({resolve, reject})),
  };
  return {store: createPlatformPostureStore(transport), requests,
    emit: (value: unknown) => listener?.(value), savedListener: () => listener,
    counts: () => ({subscriptions, removals}),
  };
}

test('unsupported hosts retain one unavailable snapshot and never synthesize flat', () => {
  const store = createPlatformPostureStore(null), before = store.getSnapshot();
  const remove = store.subscribe(() => assert.fail('Unsupported host changed'));
  assert.deepEqual(before, {status: 'unavailable', window: null, folds: []});
  assert.strictEqual(store.getSnapshot(), before);
  remove(); remove();
});

test('stable frozen snapshots only notify when public content changes', () => {
  const d = driver();
  let notifications = 0;
  const stop = d.store.subscribe(() => notifications++);
  d.emit(report(1));
  const before = d.store.getSnapshot();
  assert.ok(Object.isFrozen(before));
  assert.ok(Object.isFrozen(before.window));
  assert.ok(Object.isFrozen(before.folds));
  assert.ok(Object.isFrozen(before.folds[0]));
  assert.ok(Object.isFrozen(before.folds[0].bounds));
  d.emit(report(2));
  assert.strictEqual(d.store.getSnapshot(), before);
  assert.equal(notifications, 1);
  stop();
});

test('event subscription precedes the initial read and newer event wins a stale promise', async () => {
  const d = driver(), stop = d.store.subscribe(() => {});
  assert.equal(d.counts().subscriptions, 1);
  d.emit(report(10));
  const newer = d.store.getSnapshot();
  d.requests[0].resolve(report(9, []));
  await Promise.resolve();
  assert.strictEqual(d.store.getSnapshot(), newer);
  d.emit(report(8, []));
  assert.strictEqual(d.store.getSnapshot(), newer);
  stop();
});

test('one transport serves multiple subscribers; every unsubscribe is independent and idempotent', () => {
  const d = driver();
  let changes = 0;
  const listener = () => changes++;
  const a = d.store.subscribe(listener), b = d.store.subscribe(listener);
  assert.deepEqual(d.counts(), {subscriptions: 1, removals: 0});
  d.emit(report(1));
  assert.equal(changes, 2);
  a(); a();
  assert.equal(d.counts().removals, 0);
  d.emit(report(2, []));
  assert.equal(changes, 3);
  b(); b();
  assert.deepEqual(d.counts(), {subscriptions: 1, removals: 1});
});

test('late callbacks and promises from an unsubscribed observation cannot overwrite reattachment', async () => {
  const d = driver(), first = d.store.subscribe(() => {});
  const oldCallback = d.savedListener();
  first();
  const second = d.store.subscribe(() => {});
  d.emit(report(3));
  const current = d.store.getSnapshot();
  oldCallback?.(report(100, []));
  d.requests[0].resolve(report(101, []));
  await Promise.resolve();
  assert.strictEqual(d.store.getSnapshot(), current);
  second();
  assert.deepEqual(d.counts(), {subscriptions: 2, removals: 2});
});

test('real empty feature report clears fold; pending/activity loss cannot leave stale hinge', () => {
  const d = driver(), stop = d.store.subscribe(() => {});
  d.emit(report(1));
  d.emit(report(2, []));
  assert.deepEqual(d.store.getSnapshot(), {status: 'available', window: {width: 1200, height: 900}, folds: []});
  d.emit(report(3));
  d.emit({revision: 4, status: 'pending', window: {width: 600, height: 900}, folds: []});
  assert.equal(d.store.getSnapshot().folds.length, 0);
  d.emit({revision: 5, status: 'unavailable', window: null, folds: []});
  assert.deepEqual(d.store.getSnapshot(), {status: 'unavailable', window: null, folds: []});
  stop();
});

test('flat horizontal zero-width/height folds preserve native separation and occlusion values', () => {
  const d = driver(), stop = d.store.subscribe(() => {});
  const flat = {...feature, bounds: {left: 0, top: 400, right: 1200, bottom: 400}, state: 'flat', orientation: 'horizontal', occlusion: 'none', isSeparating: false};
  d.emit(report(1, [flat]));
  assert.deepEqual(d.store.getSnapshot().folds, [flat]);
  stop();
});

test('invalid bridge data cannot invent a posture or poison native ordering', () => {
  const d = driver(), stop = d.store.subscribe(() => {});
  const before = d.store.getSnapshot();
  for (const invalid of [null, {...report(100), revision: NaN}, {...report(100), status: 'closed'}, {...report(100), window: null},
    {...report(100), window: {width: Infinity, height: 900}}, report(100, [{...feature, state: 'folded'}]),
    report(100, [{...feature, bounds: {left: 10, top: 0, right: 0, bottom: 900}}]),
    {...report(100), status: 'pending'}, {...report(100), status: 'unavailable'}, report(100, [{...feature, isSeparating: 1}])]) {
    d.emit(invalid);
    assert.strictEqual(d.store.getSnapshot(), before);
  }
  d.emit(report(1));
  assert.equal(d.store.getSnapshot().status, 'available');
  stop();
});

test('failed initial read is unavailable but cannot overwrite a delivered event', async () => {
  const a = driver(), stopA = a.store.subscribe(() => {});
  a.requests[0].reject(new Error('No Activity'));
  await Promise.resolve();
  assert.equal(a.store.getSnapshot().status, 'unavailable');
  stopA();
  const b = driver(), stopB = b.store.subscribe(() => {});
  b.emit(report(1));
  b.requests[0].reject(new Error('Obsolete read'));
  await Promise.resolve();
  assert.equal(b.store.getSnapshot().status, 'available');
  stopB();
});

test('initial getter failures release the native event subscription', () => {
  let removed = 0;
  const store = createPlatformPostureStore({subscribe: () => () => { removed++; }, getSnapshot: () => { throw new Error('Bridge unavailable'); }});
  const stop = store.subscribe(() => {});
  assert.equal(store.getSnapshot().status, 'unavailable');
  assert.equal(removed, 1);
  stop();
  assert.equal(removed, 1);
});

test('posture events rerender subscribers while preserving shell/session/page identity', async () => {
  const d = driver();
  let mounts = 0;
  let rendered: {session: object; page: object; posture: unknown} | undefined;
  const host = createHookHost(() => {
    const [session] = useState(() => { mounts++; return {engine: 'native', position: 321}; });
    const [page] = useState(() => ({route: 'home', scroll: 450}));
    const posture = useSyncExternalStore(d.store.subscribe, d.store.getSnapshot, d.store.getSnapshot);
    rendered = {session, page, posture};
  });
  host.mount();
  const first = rendered!;
  try {
    await act(() => d.emit(report(1)));
    const folded = rendered!;
    assert.notStrictEqual(folded.posture, first.posture);
    assert.strictEqual(folded.session, first.session);
    assert.strictEqual(folded.page, first.page);
    await act(() => d.emit(report(2, [])));
    assert.strictEqual(rendered!.session, first.session);
    assert.strictEqual(rendered!.page, first.page);
    assert.equal(mounts, 1);
  } finally { host.unmount(); }
  assert.equal(d.counts().removals, 1);
});

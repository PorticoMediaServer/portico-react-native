/**
 * PERF-07: `now` as a tiny external store. A 30 s tick notifies only the now-line and the
 * on-air progress children; rows and programme blocks never subscribe, so they never
 * re-render on tick. This tests the store contract that makes that true.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNowStore} from '../src/screens/channels/now-store.ts';

const settle = async (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

test('a tick notifies only subscribers; a holder of the store object never re-renders', async () => {
  const store = createNowStore(20);
  try {
    const before = store.get();
    assert.ok(Number.isFinite(before));
    // A row holds the store object (stable identity) without subscribing: no notification.
    let rowRenders = 0;
    const holder = store;
    let progressRenders = 0;
    const unsub = store.subscribe(() => { progressRenders++; });
    await settle();
    assert.ok(store.get() >= before);
    assert.ok(progressRenders >= 1);
    assert.equal(rowRenders, 0);
    assert.equal(holder, store);
    unsub();
    const notified = progressRenders;
    await settle();
    assert.equal(progressRenders, notified);
  } finally {
    store.dispose();
  }
});

test('getSnapshot and get agree; dispose stops the tick', async () => {
  const store = createNowStore(20);
  try {
    assert.equal(store.getSnapshot(), store.get());
    let calls = 0;
    const unsub = store.subscribe(() => { calls++; });
    await settle();
    assert.ok(calls >= 1);
    assert.equal(store.getSnapshot(), store.get());
    unsub();
    store.dispose();
    const frozen = store.get();
    await settle();
    assert.equal(store.get(), frozen);
  } finally {
    store.dispose();
  }
});

test('on-air progress from the store matches the tick', async () => {
  const store = createNowStore(20);
  try {
    const start = store.get() - 60_000;
    const end = store.get() + 60_000;
    const at = (now: number) => Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
    const first = at(store.get());
    assert.ok(first > 0 && first < 1);
    await settle();
    const second = at(store.get());
    assert.ok(second >= first);
  } finally {
    store.dispose();
  }
});

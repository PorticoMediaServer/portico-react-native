/** MU1: the connection-status store fails the page once, after a settle delay (web parity). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionStatusStore, SETTLE_MS, type ConnectionStatus} from '../src/app/connection-status.ts';

function fakeTimer() {
  let nextId = 0;
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    delays,
    pendingCount: () => pending.size,
    fire: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    setTimer: (callback: () => void, ms: number): unknown => {
      const id = ++nextId;
      pending.set(id, callback);
      delays.push(ms);
      return id;
    },
    clearTimer: (id: unknown): void => {
      pending.delete(id as number);
    },
  };
}

function mounted() {
  const timer = fakeTimer();
  const store = new ConnectionStatusStore({setTimer: timer.setTimer, clearTimer: timer.clearTimer});
  const seen: ConnectionStatus[] = [];
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
  return {timer, store, seen, unsubscribe};
}

test('the default settle delay matches the web page-fails-once delay', () => {
  assert.equal(SETTLE_MS, 2500);
  const {timer, store, unsubscribe} = mounted();
  store.update({routePhase: 'offline'});
  assert.deepEqual(timer.delays, [2500]);
  unsubscribe();
  store.dispose();
});

test('a blip shorter than the settle delay never shows', () => {
  const {timer, store, seen, unsubscribe} = mounted();
  store.update({routePhase: 'offline'});
  assert.deepEqual(store.getSnapshot(), {shown: false, reason: null, generation: 0});
  store.update({routePhase: 'ready'});
  assert.deepEqual(store.getSnapshot(), {shown: false, reason: null, generation: 0});
  timer.fire();
  assert.deepEqual(store.getSnapshot(), {shown: false, reason: null, generation: 0});
  // No notification for either change: the snapshot never changed.
  assert.equal(seen.length, 0);
  unsubscribe();
  store.dispose();
});

test('a lost route shows once after the delay and bumps the generation', () => {
  const {timer, store, seen, unsubscribe} = mounted();
  store.update({routePhase: 'offline'});
  timer.fire();
  assert.deepEqual(store.getSnapshot(), {shown: true, reason: 'lost', generation: 1});
  assert.equal(seen.length, 1);
  // Still down under another phase: still shown, the generation doesn't bump again.
  store.update({routePhase: 'probing'});
  assert.deepEqual(store.getSnapshot(), {shown: true, reason: 'lost', generation: 1});
  assert.equal(seen.length, 1);
  timer.fire();
  assert.deepEqual(store.getSnapshot(), {shown: true, reason: 'lost', generation: 1});
  assert.equal(seen.length, 1);
  unsubscribe();
  store.dispose();
});

test('recovery clears the status and keeps the generation; a second loss bumps it again', () => {
  const {timer, store, seen, unsubscribe} = mounted();
  store.update({routePhase: 'offline'});
  timer.fire();
  store.update({routePhase: 'ready'});
  assert.deepEqual(store.getSnapshot(), {shown: false, reason: null, generation: 1});
  assert.equal(seen.length, 2);
  store.update({routePhase: 'offline'});
  timer.fire();
  assert.deepEqual(store.getSnapshot(), {shown: true, reason: 'lost', generation: 2});
  unsubscribe();
  store.dispose();
});

test('the saved server at launch: checking then unreachable', () => {
  const {timer, store, seen, unsubscribe} = mounted();
  store.update({saved: 'checking'});
  timer.fire();
  assert.deepEqual(store.getSnapshot(), {shown: true, reason: 'checking', generation: 1});
  // The remembered server still can't be reached: the reason updates, the generation doesn't.
  store.update({saved: 'offline'});
  assert.deepEqual(store.getSnapshot(), {shown: true, reason: 'unreachable', generation: 1});
  assert.equal(seen.length, 2);
  // The saved sign-in confirms and the route is ready: hidden, generation kept.
  store.update({});
  assert.deepEqual(store.getSnapshot(), {shown: false, reason: null, generation: 1});
  unsubscribe();
  store.dispose();
});

test('a reason change before the timer fires does not re-arm it and shows the latest reason', () => {
  const {timer, store, seen, unsubscribe} = mounted();
  store.update({saved: 'checking'});
  store.update({saved: 'offline'});
  assert.equal(timer.pendingCount(), 1);
  assert.deepEqual(store.getSnapshot(), {shown: false, reason: null, generation: 0});
  assert.equal(seen.length, 0);
  timer.fire();
  assert.deepEqual(store.getSnapshot(), {shown: true, reason: 'unreachable', generation: 1});
  unsubscribe();
  store.dispose();
});

test('saved wins over the route', () => {
  const {timer, store, unsubscribe} = mounted();
  store.update({saved: 'offline', routePhase: 'offline'});
  timer.fire();
  assert.deepEqual(store.getSnapshot(), {shown: true, reason: 'unreachable', generation: 1});
  // The saved state clears while the route is still down: the route reads as lost, same showing.
  store.update({routePhase: 'offline'});
  assert.deepEqual(store.getSnapshot(), {shown: true, reason: 'lost', generation: 1});
  unsubscribe();
  store.dispose();
});

test('identity_mismatch reads as lost, never anything sign-in related', () => {
  const {timer, store, unsubscribe} = mounted();
  store.update({routePhase: 'identity_mismatch'});
  timer.fire();
  assert.deepEqual(store.getSnapshot(), {shown: true, reason: 'lost', generation: 1});
  unsubscribe();
  store.dispose();
});

test('snapshot identity is stable between changes', () => {
  const {store, unsubscribe} = mounted();
  const first = store.getSnapshot();
  store.update({routePhase: 'ready'});
  assert.equal(store.getSnapshot(), first);
  store.update({});
  assert.equal(store.getSnapshot(), first);
  unsubscribe();
  store.dispose();
});

test('dispose clears a pending timer so a late fire never shows', () => {
  const {timer, store, seen, unsubscribe} = mounted();
  store.update({routePhase: 'offline'});
  store.dispose();
  timer.fire();
  assert.deepEqual(store.getSnapshot(), {shown: false, reason: null, generation: 0});
  assert.equal(seen.length, 0);
  unsubscribe();
});

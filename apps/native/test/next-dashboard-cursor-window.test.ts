import test from 'node:test';
import assert from 'node:assert/strict';
import {DashboardCursorWindow, type DashboardCursorPage} from '../src-next/screens/settings-live/dashboard-cursor-window';

test('cursor window retains the focused chunk until focus moves and refuses a repeated offered cursor', async () => {
  const calls: string[] = [];
  const window = new DashboardCursorWindow(async cursor => {
    calls.push(cursor);
    const next = cursor === '' ? 'a' : cursor === 'a' ? 'b' : cursor === 'b' ? 'c' : 'c';
    return {items: [{id: cursor || 'initial'}], nextCursor: next, metadata: {total: 999}};
  }, row => row.id, () => true, () => {});
  await window.refresh(); window.focus('initial');
  await window.next(window.snapshot()); await window.next(window.snapshot());
  await window.next(window.snapshot());
  assert.deepEqual(window.snapshot().items.map(row => row.id), ['initial', 'a', 'b']);
  // A repeated cursor is refused instead of evicting the focused row or looping.
  assert.equal(window.snapshot().refreshRequired, true);
  assert.deepEqual(calls, ['', 'a', 'b', 'c']); window.dispose();
});

test('retired cursor reads cannot publish into a refreshed query', async () => {
  let finish!: (page: DashboardCursorPage<{id: string}, number>) => void, call = 0;
  const window = new DashboardCursorWindow<{id: string}, number>(async () => {
    call++; return call === 1 ? new Promise(resolve => {finish = resolve;}) : {items: [{id: 'fresh'}], metadata: 2};
  }, row => row.id, () => true, () => {});
  const stale = window.refresh(); await window.refresh();
  finish({items: [{id: 'stale'}], metadata: 1}); await stale;
  assert.deepEqual(window.snapshot().items.map(row => row.id), ['fresh']);
  window.dispose();
});

test('eviction waits for the real focused row to leave its chunk', async () => {
  const window = new DashboardCursorWindow(async cursor => ({items: [{id: cursor || 'first'}], nextCursor: cursor === '' ? 'a' : cursor === 'a' ? 'b' : cursor === 'b' ? 'c' : 'd', metadata: 1}), row => row.id, () => true, () => {});
  await window.refresh(); window.focus('first');
  await window.next(window.snapshot()); await window.next(window.snapshot()); await window.next(window.snapshot());
  assert.deepEqual(window.snapshot().items.map(row => row.id), ['first', 'a', 'b']); assert.equal(window.snapshot().pending, true);
  window.focus(undefined);
  assert.deepEqual(window.snapshot().items.map(row => row.id), ['a', 'b', 'c']); assert.equal(window.snapshot().pending, false);
  window.dispose();
});

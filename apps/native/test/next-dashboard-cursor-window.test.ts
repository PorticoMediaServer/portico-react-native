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
    call++;
    if (call === 2) return new Promise(resolve => {finish = resolve;});
    return {items: [{id: call === 1 ? 'old' : 'fresh'}], nextCursor: call === 1 ? 'next' : '', metadata: call};
  }, row => row.id, () => true, () => {});
  await window.refresh(); const stale = window.next(window.snapshot()); await window.refresh();
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

test('previous and forward follow retained producer bookmarks without inventing cursors', async () => {
  const calls: string[] = [];
  const next: Record<string, string> = {'': 'a', a: 'b', b: 'c', c: 'd', d: ''};
  const window = new DashboardCursorWindow(async cursor => {calls.push(cursor); return {items: [{id: cursor || 'first'}], nextCursor: next[cursor], metadata: 1};}, row => row.id, () => true, () => {});
  await window.refresh(); await window.next(window.snapshot()); await window.next(window.snapshot()); await window.next(window.snapshot());
  assert.deepEqual(window.snapshot().items.map(row => row.id), ['a', 'b', 'c']);
  await window.previous(window.snapshot());
  assert.deepEqual(window.snapshot().items.map(row => row.id), ['first', 'a', 'b']);
  await window.next(window.snapshot());
  assert.deepEqual(window.snapshot().items.map(row => row.id), ['a', 'b', 'c']);
  assert.deepEqual(calls, ['', 'a', 'b', 'c', '', 'c']); window.dispose();
});

test('refresh preserves the focused old row until its original focus lease blurs', async () => {
  let read = 0;
  const window = new DashboardCursorWindow(async () => ({items: [{id: ++read === 1 ? 'old' : 'fresh'}], nextCursor: '', metadata: read}), row => row.id, () => true, () => {});
  await window.refresh(); const lease = window.focus('old')!;
  await window.refresh(); assert.deepEqual(window.snapshot().items.map(row => row.id), ['old']);
  assert.equal(window.snapshot().pending, true);
  window.blur('old', lease); assert.deepEqual(window.snapshot().items.map(row => row.id), ['fresh']);
  assert.equal(window.snapshot().pending, false); window.dispose();
});

test('a cycle longer than bookmark history eventually requires refresh without extra requests', async () => {
  const calls: string[] = [];
  const window = new DashboardCursorWindow(async cursor => {
    calls.push(cursor); const n = cursor ? Number(cursor.slice(1)) : -1;
    const successor = n < 0 ? 0 : (n + 1) % 70;
    return {items: [{id: cursor || 'first'}], nextCursor: `c${successor}`, metadata: 1};
  }, row => row.id, () => true, () => {});
  await window.refresh();
  for (let i = 0; i < 400 && !window.snapshot().refreshRequired; i++) await window.next(window.snapshot());
  assert.equal(window.snapshot().refreshRequired, true); assert.ok(calls.length > 70 && calls.length < 400);
  assert.ok(window.snapshot().chunks.length <= 3); assert.ok(window.snapshot().bookmarks.length <= 64); window.dispose();
});

test('a long acyclic producer chain remains reachable beyond bookmark capacity', async () => {
  let calls = 0;
  const window = new DashboardCursorWindow(async cursor => {
    calls++; const n = cursor ? Number(cursor.slice(1)) : 0;
    return {items: [{id: `row${n}`}], nextCursor: n < 150 ? `c${n + 1}` : '', metadata: 1};
  }, row => row.id, () => true, () => {});
  await window.refresh(); for (let i = 0; i < 150; i++) await window.next(window.snapshot());
  assert.equal(window.snapshot().refreshRequired, false); assert.equal(window.snapshot().items.at(-1)?.id, 'row150');
  assert.ok(window.snapshot().chunks.length <= 3); assert.ok(window.snapshot().bookmarks.length <= 64); assert.equal(calls, 151); window.dispose();
});

test('conflicting retained job revisions require explicit refresh', async () => {
  const window = new DashboardCursorWindow(async cursor => ({items: [{id: 'job', revision: cursor ? 2 : 1}], nextCursor: cursor ? '' : 'next', metadata: undefined}), row => row.id, () => true, () => {}, (a, b) => a.revision === b.revision);
  await window.refresh(); await window.next(window.snapshot());
  assert.equal(window.snapshot().refreshRequired, true); assert.equal(window.snapshot().items[0].revision, 1); window.dispose();
});

test('an old action lease cannot release a successor lease for the same row', async () => {
  const window = new DashboardCursorWindow(async cursor => ({items: [{id: cursor || 'first'}], nextCursor: cursor === '' ? 'a' : cursor === 'a' ? 'b' : cursor === 'b' ? 'c' : 'd', metadata: 1}), row => row.id, () => true, () => {});
  await window.refresh(); const old = window.pin('first'); const successor = window.pin('first'); window.unpin(old);
  await window.next(window.snapshot()); await window.next(window.snapshot()); await window.next(window.snapshot());
  assert.deepEqual(window.snapshot().items.map(row => row.id), ['first', 'a', 'b']); assert.equal(window.snapshot().pending, true);
  window.unpin(old); assert.equal(window.snapshot().pending, true);
  window.unpin(successor); assert.deepEqual(window.snapshot().items.map(row => row.id), ['a', 'b', 'c']); window.dispose();
});

test('refresh re-reads only the visible bounded cursor window and preserves its focused row', async () => {
  const calls: string[] = []; let revision = 'old';
  const window = new DashboardCursorWindow(async cursor => {calls.push(cursor); return {items: [{id: cursor || 'first', revision}], nextCursor: cursor === '' ? 'a' : cursor === 'a' ? 'b' : '', metadata: revision};}, row => row.id, () => true, () => {});
  await window.refresh(); await window.next(window.snapshot()); window.focus('a', window.snapshot().generation);
  revision = 'new'; await window.refresh();
  assert.deepEqual(calls, ['', 'a', '', 'a']);
  assert.deepEqual(window.snapshot().items.map(row => `${row.id}:${row.revision}`), ['first:new', 'a:new']);
  assert.equal(window.snapshot().nextCursor, 'b'); assert.equal(window.snapshot().pending, false); window.dispose();
});

test('an old blur receipt cannot release a newer focus lease for the same row', async () => {
  const window = new DashboardCursorWindow(async cursor => ({items: [{id: cursor || 'first'}], nextCursor: cursor === '' ? 'a' : cursor === 'a' ? 'b' : cursor === 'b' ? 'c' : 'd', metadata: 1}), row => row.id, () => true, () => {});
  await window.refresh(); const old = window.focus('first')!, current = window.focus('first')!;
  window.blur('first', old); await window.next(window.snapshot()); await window.next(window.snapshot()); await window.next(window.snapshot());
  assert.equal(window.snapshot().pending, true); assert.equal(window.snapshot().items[0]?.id, 'first');
  window.blur('first', current); assert.equal(window.snapshot().pending, false); assert.equal(window.snapshot().items[0]?.id, 'a'); window.dispose();
});

test('an aged-out previous bookmark returns to the real first page', async () => {
  const calls: string[] = [];
  const window = new DashboardCursorWindow(async cursor => {
    calls.push(cursor); const n = cursor ? Number(cursor.slice(1)) : 0;
    return {items: [{id: `r${n}`}], nextCursor: `c${n + 1}`, metadata: 1};
  }, row => row.id, () => true, () => {});
  await window.refresh(); for (let i = 0; i < 70; i++) await window.next(window.snapshot());
  for (let i = 0; i < 64 && window.snapshot().chunks[0]?.cursor !== ''; i++) await window.previous(window.snapshot());
  assert.equal(window.snapshot().chunks[0]?.cursor, ''); assert.equal(window.snapshot().items[0]?.id, 'r0');
  const length = calls.length; await window.next(window.snapshot()); assert.equal(calls[length], 'c1'); window.dispose();
});

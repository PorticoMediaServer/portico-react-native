import assert from 'node:assert/strict';
import test from 'node:test';
import {createFocusRegistry, focusTestID, type FocusAddress} from '../src-next/kit/focus/registry.ts';
import {reconcileRowSlots, indexRowSlots, visibleRowSlots, rowNeedsPage, type RowPage} from '../src-next/kit/layout/row-state.ts';

function fixture() {
  const registry = createFocusRegistry(), requests: string[] = [];
  const add = (regionId: string, childId: string) => registry.attach({regionId, childId}, {requestTVFocus: () => requests.push(`${regionId}/${childId}`)});
  const configure = (id: string, order: readonly string[]) => registry.configure({id, order, entry: order[0], neighbors: {next: 'below', previous: 'above'}, screenStart: {regionId: 'spotlight', childId: 'play'}});
  configure('row', ['a', 'b', 'c']); configure('below', ['x', 'y']); configure('above', ['z']); configure('spotlight', ['play', 'list', 'details']);
  for (const [r, ids] of [['row', ['a', 'b', 'c']], ['below', ['x', 'y']], ['above', ['z']], ['spotlight', ['play', 'list', 'details']]] as const) for (const id of ids) add(r, id);
  return {registry, requests, add, configure};
}
test('authority-fenced semantic IDs are deterministic and distinguish delimiters', () => {
  assert.equal(focusTestID('server/viewer/home/row', 'source/entity'), 'portico.focus.server%2Fviewer%2Fhome%2Frow.source%2Fentity');
  assert.notEqual(focusTestID('a/b', 'c'), focusTestID('a', 'b/c'));
  assert.notEqual(focusTestID('a.b', 'c'), focusTestID('a', 'b.c'));
  assert.notEqual(focusTestID('a%2Eb', 'c'), focusTestID('a.b', 'c'));
});
test('explicit Back-to-start does not erase spotlight or independent row memories', () => {
  const {registry, requests} = fixture();
  registry.didFocus({regionId: 'spotlight', childId: 'list'});
  registry.didFocus({regionId: 'row', childId: 'c'});
  registry.didFocus({regionId: 'below', childId: 'y'});
  registry.focus({regionId: 'spotlight', childId: 'play'});
  registry.focusRegion('row'); registry.focusRegion('below'); registry.focusRegion('spotlight');
  assert.deepEqual(requests, ['spotlight/play', 'row/c', 'below/y', 'spotlight/list']);
});
test('capture/restore returns to the exact opener without changing memory or sending navigation', () => {
  const {registry, requests} = fixture();
  registry.didFocus({regionId: 'row', childId: 'b'}); const opener = registry.capture();
  registry.didFocus({regionId: 'below', childId: 'x'});
  assert.equal(registry.restore(opener), true); assert.deepEqual(requests, ['row/b']);
});
test('a removed opener falls next, then previous at end, with no stale node request', () => {
  const {registry, requests} = fixture();
  registry.didFocus({regionId: 'row', childId: 'b'}); const opener = registry.capture();
  registry.didFocus({regionId: 'below', childId: 'x'});
  registry.attach({regionId: 'row', childId: 'b'}, null);
  assert.equal(registry.restore(opener), true); assert.equal(requests.at(-1), 'row/c');
  registry.attach({regionId: 'row', childId: 'c'}, null);
  assert.equal(registry.restore(opener), true); assert.equal(requests.at(-1), 'row/a');
});
test('empty row restores neighboring region memory, then above, then screen start', () => {
  const {registry, requests} = fixture();
  registry.didFocus({regionId: 'below', childId: 'y'});
  registry.didFocus({regionId: 'row', childId: 'b'}); const opener = registry.capture();
  registry.didFocus({regionId: 'spotlight', childId: 'details'});
  for (const childId of ['a', 'b', 'c']) registry.attach({regionId: 'row', childId}, null);
  registry.restore(opener); assert.equal(requests.at(-1), 'below/y');
  for (const childId of ['x', 'y']) registry.attach({regionId: 'below', childId}, null);
  registry.restore(opener); assert.equal(requests.at(-1), 'above/z');
  registry.attach({regionId: 'above', childId: 'z'}, null);
  registry.restore(opener); assert.equal(requests.at(-1), 'spotlight/play');
});
test('selected rail entry overrides its previous memory without acting on focused items', () => {
  const {registry, requests} = fixture();
  registry.configure({id: 'row', entry: 'a', entryPolicy: 'entry', order: ['a', 'b', 'c']});
  registry.didFocus({regionId: 'row', childId: 'c'}); registry.focusRegion('row');
  assert.deepEqual(requests, ['row/a']);
});
test('nested retained openers preserve row ownership until each idempotent release', () => {
  const {registry} = fixture(), address: FocusAddress = {regionId: 'row', childId: 'b'};
  registry.didFocus(address); const a = registry.retain(address), b = registry.retain(address);
  registry.didFocus({regionId: 'below', childId: 'x'});
  assert.equal(registry.isRegionActive('row'), true);
  a(); a(); assert.equal(registry.isRegionActive('row'), true);
  b(); assert.equal(registry.isRegionActive('row'), false);
});
test('late attach/metadata/configuration never request focus in an offscreen region', async () => {
  const {registry, requests, add} = fixture();
  registry.didFocus({regionId: 'below', childId: 'x'});
  add('row', 'late'); registry.configure({id: 'row', order: ['late', 'a']});
  registry.attach({regionId: 'row', childId: 'a'}, null);
  await Promise.resolve(); assert.deepEqual(requests, []);
});
test('removal recovery waits for commit and cannot steal focus after another child acquired it', async () => {
  const {registry, requests, add} = fixture();
  registry.didFocus({regionId: 'row', childId: 'b'});
  registry.attach({regionId: 'row', childId: 'b'}, null); add('row', 'b');
  await Promise.resolve(); assert.deepEqual(requests, [], 'same identity reattached during commit');
  registry.attach({regionId: 'row', childId: 'b'}, null);
  registry.didFocus({regionId: 'below', childId: 'x'});
  await Promise.resolve(); assert.deepEqual(requests, [], 'new native focus cancels removal recovery');
});
test('removing the genuinely focused host requests the next fallback once after commit', async () => {
  const {registry, requests} = fixture();
  registry.didFocus({regionId: 'row', childId: 'b'});
  registry.attach({regionId: 'row', childId: 'b'}, null);
  assert.deepEqual(requests, []); await Promise.resolve(); assert.deepEqual(requests, ['row/c']);
});
test('child-to-child native blur/focus never briefly releases effective row ownership', async () => {
  const {registry} = fixture();
  registry.didFocus({regionId: 'row', childId: 'a'});
  registry.didBlur({regionId: 'row', childId: 'a'});
  registry.didFocus({regionId: 'row', childId: 'b'});
  await Promise.resolve(); assert.equal(registry.isRegionActive('row'), true);
  registry.didBlur({regionId: 'row', childId: 'b'});
  await Promise.resolve(); assert.equal(registry.isRegionActive('row'), false);
});

type Item = {id: string; title?: string};
const key = (item: Item) => item.id;
const entries = (ids: string[]) => ids.map(id => ({id}));
const page = (id: string, overrides = {}): RowPage<Item> => ({hasMore: true, loading: true, waitingId: id, waitingItem: {id: `model-${id}`}, requestNext() {}, ...overrides});
test('focused row defers reranking, preserves positions under removals and appends without resetting', () => {
  let slots = reconcileRowSlots([], entries(['a', 'b', 'c']), key, false);
  slots = reconcileRowSlots(slots, entries(['c', 'b', 'a', 'd']), key, true);
  assert.deepEqual(slots.map(s => [s.id, s.position]), [['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
  slots = reconcileRowSlots(slots, entries(['d', 'c', 'b']), key, true);
  assert.deepEqual(slots.map(s => [s.id, s.position]), [['b', 1], ['c', 2], ['d', 3]], 'removal before focused card keeps its drawn slot');
  slots = reconcileRowSlots(slots, entries(['d', 'c', 'b']), key, false);
  assert.deepEqual(slots.map(s => [s.id, s.position]), [['d', 0], ['c', 1], ['b', 2]]);
});
test('one stable cursor waiting slot fills at the same identity and position while held', () => {
  let slots = reconcileRowSlots([], entries(['a', 'b']), key, false, page('cursor-one'));
  assert.equal(slots.filter(s => s.waiting).length, 1); const waiting = slots[2]!;
  slots = reconcileRowSlots(slots, entries(['a', 'b']), key, true, page('cursor-one'));
  assert.deepEqual(slots[2], waiting);
  slots = reconcileRowSlots(slots, entries(['a', 'b', 'c', 'd']), key, true, page('cursor-two'));
  assert.deepEqual(slots.slice(2).map(s => [s.id, s.focusId, s.position, s.waiting]), [['c', 'cursor-one', 2, false], ['d', 'd', 3, false], ['cursor-two', 'cursor-two', 4, true]]);
  const rerender = reconcileRowSlots(slots, entries(['a', 'b', 'c', 'd']), key, true, page('cursor-two'));
  assert.deepEqual(rerender, slots, 'ordinary render cannot remount or advance the cursor anchor');
});
test('true exhaustion/failure removes waiting target; short rows never invent a next page', () => {
  const slots = reconcileRowSlots([], entries(['a', 'b']), key, false, page('cursor'));
  assert.equal(reconcileRowSlots(slots, entries(['a', 'b']), key, true, page('cursor', {hasMore: false})).some(s => s.waiting), false);
  assert.equal(reconcileRowSlots(slots, entries(['a', 'b']), key, true, page('cursor', {failed: true})).some(s => s.waiting), false);
  assert.equal(reconcileRowSlots([], entries(['a']), key, false).length, 1);
  assert.throws(() => reconcileRowSlots([], entries(['a', 'a']), key, true), /unique/);
});
test('next-page admission starts about ten cards before loaded end and never loops on loading/error/end', () => {
  assert.equal(rowNeedsPage(9, 20, {hasMore: true, loading: false}), false);
  assert.equal(rowNeedsPage(10, 20, {hasMore: true, loading: false}), true);
  for (const p of [{hasMore: false, loading: false}, {hasMore: true, loading: true}, {hasMore: true, loading: false, failed: true}]) assert.equal(rowNeedsPage(20, 20, p), false);
  assert.equal(rowNeedsPage(0, 0, {hasMore: true, loading: false}), false);
});

test('50,000-card focus traversal reads a bounded window plus remembered host', () => {
  const items = Array.from({length: 50_000}, (_, n) => ({id: `source-${n}`}));
  const index = indexRowSlots(reconcileRowSlots([], items, key, false));
  const visible = visibleRowSlots(index, 100, 105, 'source-100', 'source-49999');
  assert.equal(visible.length, 11); assert.ok(visible.some(slot => slot.id === 'source-49999'));
  assert.ok(visible.every(slot => slot.id === 'source-49999' || slot.position >= 98 && slot.position <= 107));
});

test('semantic focus IDs remain independent from raw selection/data keys through cursor fills', () => {
  const identity = (item: Item) => JSON.stringify(['movie', 'actual-library', item.id]);
  let slots = reconcileRowSlots([], entries(['a', 'b']), key, false, page('cursor'), identity);
  assert.equal(slots[0]!.id, 'a'); assert.equal(slots[0]!.focusId, identity({id: 'a'}));
  slots = reconcileRowSlots(slots, entries(['a', 'b', 'c']), key, true, undefined, identity);
  assert.equal(slots[2]!.id, 'c'); assert.equal(slots[2]!.focusId, 'cursor');
  assert.equal(slots[2]!.sourceFocusId, identity({id: 'c'}));
});

test('nested sheet returns through a removed menu to its original page opener', () => {
  const {registry, requests} = fixture();
  registry.didFocus({regionId: 'row', childId: 'b'}); const page = registry.capture();
  registry.configure({id: 'menu', order: ['resume', 'file']});
  registry.registerReturn('menu', page);
  registry.attach({regionId: 'menu', childId: 'file'}, {requestTVFocus: () => requests.push('menu/file')});
  registry.didFocus({regionId: 'menu', childId: 'file'}); const menu = registry.capture();
  registry.didFocus({regionId: 'below', childId: 'x'});
  registry.attach({regionId: 'menu', childId: 'file'}, null);
  registry.attach({regionId: 'row', childId: 'b'}, null);
  assert.equal(registry.restore(menu), true); assert.deepEqual(requests, ['row/c']);
});

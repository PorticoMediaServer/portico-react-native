import assert from 'node:assert/strict';
import test from 'node:test';
import type {HomeLayoutView} from '../../../packages/client-core/src/home';
import {NativeHomeCustomizeController} from '../src-next/screens/home/customize-controller';

const layout = (revision = 7): HomeLayoutView => ({revision, rowOrder: ['continue', 'recommended', 'recent'], hiddenRowIds: [], rows: [
  {id: 'continue', title: 'Continue Watching', kind: 'continue', artworkShape: 'landscape', required: true, hideable: false, reorderable: true, hidden: false},
  {id: 'recommended', title: 'Recommended for you', kind: 'recommended', artworkShape: 'poster', required: false, hideable: true, reorderable: true, hidden: false},
  {id: 'recent', title: 'Recently added', kind: 'recent', artworkShape: 'poster', required: false, hideable: true, reorderable: true, hidden: false},
]});
const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};};

test('pick-up cancellation restores exact server row order; required rows move but cannot be hidden', async () => {
  let writes = 0;
  const controller = new NativeHomeCustomizeController({current: () => true, requestId: async () => 'request', home: {
    loadLayout: async () => layout(), saveLayout: async () => {writes++; return layout();}, resetLayout: async () => {writes++;},
  }});
  await controller.load();
  assert.equal(controller.getSnapshot().rows[0].id, 'continue');
  assert.equal(controller.toggle('continue'), false);
  assert.equal(controller.pick('continue'), true);
  assert.equal(controller.move(1), true);
  assert.deepEqual(controller.getSnapshot().rows.map(row => row.id), ['recommended', 'continue', 'recent']);
  assert.equal(controller.cancelPickup(), true);
  assert.deepEqual(controller.getSnapshot().rows.map(row => row.id), layout().rowOrder);
  assert.equal(controller.getSnapshot().dirty, false);
  assert.equal(writes, 0, 'moving/cancelling is a transient draft only');
});

test('Save sends the captured revision and actual IDs once, and a conflict never overwrites or retries', async () => {
  const calls: unknown[] = []; let conflict = true, revision = 7;
  const controller = new NativeHomeCustomizeController({current: () => true, requestId: async () => 'request', home: {
    loadLayout: async () => layout(revision), resetLayout: async () => {},
    saveLayout: async (ids, hidden, request, expected) => {calls.push({ids, hidden, id: request(), expected}); if (conflict) throw {status: 409, code: 'revision_conflict'}; return layout(++revision);},
  }});
  await controller.load(); controller.toggle('recent');
  assert.equal(await controller.save(), false);
  assert.deepEqual(calls, [{ids: ['continue', 'recommended', 'recent'], hidden: ['recent'], id: 'request', expected: 7}]);
  assert.equal(controller.getSnapshot().showConflict, true);
  controller.keepEditing();
  assert.equal(controller.getSnapshot().showConflict, false);
  assert.equal(controller.getSnapshot().conflict, true);
  assert.equal(await controller.save(), false);
  assert.equal(calls.length, 1);
  conflict = false; revision = 8;
  await controller.load();
  assert.equal(controller.getSnapshot().dirty, false);
  assert.equal(controller.getSnapshot().conflict, false);
  controller.toggle('recent');
  assert.equal(await controller.save(), true);
  assert.equal((calls[1] as any).expected, 8);
});

test('retirement before request identity resolves prevents the write, and duplicate Save is refused', async () => {
  let current = true, writes = 0;
  const request = deferred<string>();
  const controller = new NativeHomeCustomizeController({current: () => current, requestId: () => request.promise, home: {
    loadLayout: async () => layout(), saveLayout: async () => {writes++; return layout();}, resetLayout: async () => {writes++;},
  }});
  await controller.load(); controller.toggle('recent');
  const pending = controller.save();
  assert.equal(await controller.save(), false);
  assert.equal(controller.toggle('recommended'), false);
  current = false; request.resolve('request');
  assert.equal(await pending, false);
  assert.equal(writes, 0);
});

test('late layout reads cannot publish over a newer read or a disposed screen', async () => {
  const first = deferred<HomeLayoutView>(), second = deferred<HomeLayoutView>(); let reads = 0;
  const controller = new NativeHomeCustomizeController({current: () => true, requestId: async () => 'request', home: {
    loadLayout: async () => ++reads === 1 ? first.promise : second.promise, saveLayout: async () => layout(), resetLayout: async () => {},
  }});
  const a = controller.load(), b = controller.load();
  second.resolve(layout(9)); await b;
  first.resolve(layout(7)); await a;
  assert.equal(controller.getSnapshot().revision, 9);
  controller.dispose();
  assert.equal(controller.pick('continue'), false);
});

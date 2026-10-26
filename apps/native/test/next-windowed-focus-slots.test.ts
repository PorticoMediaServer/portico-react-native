import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSlotOwnerKey, projectNativeSlots} from '../src-next/kit/focus/windowed-slots.ts';
import {createFocusRegistry} from '../src-next/kit/focus/registry.ts';

// Authored UNRUN for hourly CI; pure identity/controlled host evidence, never native OS survival.
test('same-source arrival adopts the original waiting identity without mutating the committed projection', () => {
  const owner = {}, key = nativeSlotOwnerKey(owner);
  const original = projectNativeSlots(undefined, owner, key, 7, [{index: 40, waiting: true}]);
  const abandoned = projectNativeSlots(original, owner, key, 7, [{index: 40, entityId: 'not-committed', waiting: false}]);
  const filled = projectNativeSlots(original, owner, key, 7, [{index: 40, entityId: 'actual-offered', waiting: false}]);
  assert.equal(original.slots[0]!.entityId, undefined); assert.equal(original.slots[0]!.waiting, true);
  assert.equal(abandoned.slots[0]!.focusId, original.slots[0]!.focusId);
  assert.equal(filled.slots[0]!.key, original.slots[0]!.key);
  assert.equal(filled.slots[0]!.entityId, 'actual-offered');
});
test('a generation or actual collection replacement cannot masquerade as filling an old unknown slot', () => {
  const owner = {}, successor = {}, key = nativeSlotOwnerKey(owner);
  assert.equal(nativeSlotOwnerKey(owner), key); assert.notEqual(nativeSlotOwnerKey(successor), key);
  const original = projectNativeSlots(undefined, owner, key, 3, [{index: 8, waiting: true}]);
  const generation = projectNativeSlots(original, owner, key, 4, [{index: 8, entityId: 'new-generation', waiting: false}]);
  const replacement = projectNativeSlots(undefined, successor, nativeSlotOwnerKey(successor), 3, [{index: 8, waiting: true}]);
  assert.notEqual(generation.slots[0]!.focusId, original.slots[0]!.focusId);
  assert.notEqual(replacement.slots[0]!.focusId, original.slots[0]!.focusId);
});
test('real identity survives a resident reorder; an evicted known entity is not replaced by an unrelated arrival', () => {
  const owner = {}, key = nativeSlotOwnerKey(owner);
  const original = projectNativeSlots(undefined, owner, key, 2, [{index: 9, entityId: 'original', waiting: false}]);
  const reordered = projectNativeSlots(original, owner, key, 3, [{index: 4, entityId: 'original', waiting: false}]);
  assert.equal(reordered.slots[0]!.key, original.slots[0]!.key);
  const evicted = projectNativeSlots(original, owner, key, 2, [{index: 9, waiting: true}]);
  const same = projectNativeSlots(evicted, owner, key, 2, [{index: 9, entityId: 'original', waiting: false}]);
  const other = projectNativeSlots(evicted, owner, key, 2, [{index: 9, entityId: 'different', waiting: false}]);
  assert.equal(same.slots[0]!.key, original.slots[0]!.key); assert.notEqual(other.slots[0]!.key, original.slots[0]!.key);
});
test('state retains only offered mounted/pinned slots, independent of sparse source indices', () => {
  const owner = {}, key = nativeSlotOwnerKey(owner);
  const original = projectNativeSlots(undefined, owner, key, 0, [{index: 0, waiting: true}, {index: 4_999_999, waiting: true}]);
  const next = projectNativeSlots(original, owner, key, 0, [{index: 4_999_999, entityId: 'actual-tail', waiting: false}]);
  assert.equal(next.slots.length, 1); assert.equal(next.slots[0]!.index, 4_999_999);
});
test('an entity alias is atomically attached to the original native leaf and stale teardown cannot remove its successor', () => {
  const registry = createFocusRegistry(), owner = {}, successor = {}, host = {requestTVFocus() {}};
  registry.configure({id: 'grid', grid: {columns: 4, count: 12}});
  registry.attach({regionId: 'grid', childId: 'native-original'}, host, owner, {index: 8, pending: true, generation: 'actual-source'});
  registry.didFocus({regionId: 'grid', childId: 'native-original'});
  registry.attach({regionId: 'grid', childId: 'native-original'}, host, owner, {index: 8, pending: false, generation: 'actual-source'}, 'actual-entity');
  assert.deepEqual(registry.entityAddress('grid', 'actual-entity'), {regionId: 'grid', childId: 'native-original'});
  assert.equal(registry.capture()?.childId, 'native-original');
  registry.attach({regionId: 'grid', childId: 'native-original'}, null, owner);
  registry.attach({regionId: 'grid', childId: 'native-original'}, host, successor, {index: 8}, 'successor-entity');
  registry.attach({regionId: 'grid', childId: 'native-original'}, null, owner);
  assert.equal(registry.entityAddress('grid', 'actual-entity'), undefined);
  assert.equal(registry.entityAddress('grid', 'successor-entity')?.childId, 'native-original');
});
test('pending index replacement requires the same actual source, otherwise ordinary neighbor/entry fallback applies', () => {
  const registry = createFocusRegistry(), calls: string[] = [];
  registry.configure({id: 'grid', entry: 'neighbor', order: ['neighbor', 'new-item'], grid: {columns: 4, count: 8}});
  registry.attach({regionId: 'grid', childId: 'neighbor'}, {requestTVFocus() {calls.push('neighbor');}}, {}, {index: 0, generation: 'source-B'});
  registry.attach({regionId: 'grid', childId: 'new-item'}, {requestTVFocus() {calls.push('new-item');}}, {}, {index: 4, generation: 'source-B'});
  assert.equal(registry.restore({regionId: 'grid', childId: 'retired-pending', order: ['retired-pending'], cell: {index: 4, pending: true, generation: 'source-A'}}), true);
  assert.deepEqual(calls, ['neighbor']);
});

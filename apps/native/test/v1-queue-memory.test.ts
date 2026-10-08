/** Relaunch on Playback v1: the saved queue is reopened without playing; a 404 forgets it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {V1QueueMemory, restoreV1Queue, v1QueueKey, type QueueMemoryStore} from '../src/bridge/v1-queue-memory.ts';

const viewer = {serverId: 'srv_1', authority: 'local', accountId: 'acc', profileId: 'pro'};
function memoryStore() {
  const values = new Map<string, unknown>();
  let writes = 0;
  const store: QueueMemoryStore = {
    async change(key, update) {
      const before = values.get(key) ?? null;
      const out = update(before);
      if (JSON.stringify(out.record ?? null) !== JSON.stringify(before)) { writes++; values.set(key, out.record ?? null); }
      return out.value;
    },
  };
  return {store, values, writes: () => writes};
}

test('a started v1 queue is saved once per viewer and reopened at launch without playing', async () => {
  const {store, values, writes} = memoryStore();
  const memory = new V1QueueMemory(store, viewer);
  await memory.save('q_abc');
  await memory.save('q_abc');
  assert.equal(writes(), 1, 'an unchanged id is not written again');
  assert.equal(values.get(v1QueueKey(viewer)), 'q_abc');
  const opened: string[] = [];
  assert.equal(await restoreV1Queue(new V1QueueMemory(store, viewer), async id => { opened.push(id); }), 'opened');
  assert.deepEqual(opened, ['q_abc']);
  // Another profile on the same device has its own queue.
  assert.equal(await restoreV1Queue(new V1QueueMemory(store, {...viewer, profileId: 'other'}), async () => { throw new Error('must not open'); }), 'none');
});

test('a queue the server no longer has is forgotten quietly; other failures keep it', async () => {
  const {store, values} = memoryStore();
  await new V1QueueMemory(store, viewer).save('q_gone');
  assert.equal(await restoreV1Queue(new V1QueueMemory(store, viewer), async () => { throw Object.assign(new Error('offline'), {status: undefined}); }), 'kept');
  assert.equal(values.get(v1QueueKey(viewer)), 'q_gone');
  assert.equal(await restoreV1Queue(new V1QueueMemory(store, viewer), async () => { throw Object.assign(new Error('not_found'), {status: 404}); }), 'forgotten');
  assert.equal(values.get(v1QueueKey(viewer)), null);
  assert.equal(await restoreV1Queue(new V1QueueMemory(store, viewer), async () => { throw new Error('must not open'); }), 'none');
});

test('a /v2 play clears the saved v1 queue; a damaged value reads as none', async () => {
  const {store, values} = memoryStore();
  const memory = new V1QueueMemory(store, viewer);
  await memory.save('q_1');
  await memory.clear();
  assert.equal(values.get(v1QueueKey(viewer)), null);
  values.set(v1QueueKey(viewer), {not: 'an id'});
  assert.equal(await new V1QueueMemory(store, viewer).read(), undefined);
});

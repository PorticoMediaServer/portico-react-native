import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime';
import {NativeDashboardController, type NativeDashboardReaders} from '../src-next/screens/settings-live/dashboard-controller';

const authority = {serverId: 'server', accountId: 'account', profileId: 'primary', epoch: 'one', viewerFence: 'fence'};
const totals = {streams: 21, paused: 0, converting: 0, bandwidthKbps: 0, people: 21, atHome: 21, away: 0};
const page = (prefix: string, count: number, cursor?: string) => ({items: Array.from({length: count}, (_, i) => ({id: `${prefix}${i}`})) as never[], nextCursor: cursor, totals, revision: 'rev-1', scope: {serverId: 'server', viewerFence: 'fence'}});

test('TV Dashboard continuation coalesces, keeps prior rows on error and retries its offered cursor', async () => {
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
  let finish!: (value: ReturnType<typeof page>) => void, fail!: (error: Error) => void;
  const sessionCalls: (string | undefined)[] = [], jobCalls: string[] = [];
  const readers: NativeDashboardReaders = {
    sessions: {list: async cursor => {sessionCalls.push(cursor); return cursor === undefined ? page('first', 10, 'offered') : new Promise((resolve, reject) => {finish = resolve; fail = reject;});}},
    console: {measurement: async name => ({name, observedAt: 1, freshUntil: 30001, facts: {}}), alerts: async () => [], jobs: async cursor => {jobCalls.push(cursor ?? ''); return {items: [], nextCursor: ''};}, dispose() {}},
  };
  const controller = new NativeDashboardController(lifetime, () => 'administrator', readers);
  await controller.refresh();
  const original = controller.getSnapshot().sessionWindow!;
  const pending = controller.nextSessions(original); const duplicate = controller.nextSessions(original); assert.deepEqual(sessionCalls, [undefined, 'offered']);
  fail(new Error('offline')); await Promise.all([pending, duplicate]);
  assert.deepEqual(controller.getSnapshot().sessions.map(item => item.id), Array.from({length: 10}, (_, i) => `first${i}`));
  const retry = controller.retrySessions(controller.getSnapshot().sessionWindow!); finish(page('last', 1)); await retry;
  assert.equal(controller.getSnapshot().sessions.at(-1)?.id, 'last0');
  assert.deepEqual(sessionCalls, [undefined, 'offered', 'offered']); assert.deepEqual(jobCalls, []);
  controller.dispose(); lifetime.dispose();
});

test('Dashboard refresh retires a pending continuation without publishing stale sessions', async () => {
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
  let finish!: (value: ReturnType<typeof page>) => void, reads = 0;
  const readers: NativeDashboardReaders = {
    sessions: {list: async cursor => {reads++; return cursor ? new Promise(resolve => {finish = resolve;}) : page(reads === 1 ? 'old' : 'fresh', 10, 'next');}},
    console: {measurement: async name => ({name, observedAt: 1, freshUntil: 30001, facts: {}}), alerts: async () => [], jobs: async () => ({items: [], nextCursor: ''}), dispose() {}},
  };
  const controller = new NativeDashboardController(lifetime, () => 'administrator', readers);
  await controller.refresh(); const stale = controller.nextSessions(controller.getSnapshot().sessionWindow!); await controller.refresh();
  finish(page('stale', 1)); await stale;
  assert.equal(controller.getSnapshot().sessions.some(item => item.id.startsWith('stale')), false);
  assert.equal(controller.getSnapshot().sessions[0]?.id, 'fresh0');
  controller.dispose(); lifetime.dispose();
});

test('owner jobs use their own offered cursor and retirement denies later reads', async () => {
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
  let role: 'owner' | 'administrator' = 'owner';
  const jobs: string[] = [];
  const readers: NativeDashboardReaders = {
    sessions: {list: async () => page('session', 1)},
    console: {measurement: async name => ({name, observedAt: 1, freshUntil: 30001, facts: {}}), alerts: async () => [], jobs: async cursor => {
      jobs.push(cursor ?? ''); return {items: [{id: cursor ? 'second' : 'first'}] as never[], nextCursor: cursor ? '' : 'jobs-next'};
    }, dispose() {}},
  };
  const controller = new NativeDashboardController(lifetime, () => role, readers);
  await controller.refresh(); await controller.nextJobs(controller.getSnapshot().jobWindow!);
  assert.deepEqual(jobs, ['', 'jobs-next']); assert.deepEqual(controller.getSnapshot().jobs.map(job => job.id), ['first', 'second']);
  role = 'administrator'; await controller.refresh(); assert.deepEqual(controller.getSnapshot().jobs, []);
  await controller.nextJobs(controller.getSnapshot().jobWindow!); assert.deepEqual(jobs, ['', 'jobs-next']);
  controller.dispose(); lifetime.dispose();
});

test('Dashboard reaches 21 sessions in producer order and retains the server totals', async () => {
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
  const calls: (string | undefined)[] = [];
  const readers: NativeDashboardReaders = {
    sessions: {list: async cursor => {calls.push(cursor); return cursor === undefined ? page('a', 10, 'p2') : cursor === 'p2' ? page('b', 10, 'p3') : page('c', 1);}},
    console: {measurement: async name => ({name, observedAt: 1, freshUntil: 30001, facts: {}}), alerts: async () => [], jobs: async () => ({items: [], nextCursor: ''}), dispose() {}},
  };
  const controller = new NativeDashboardController(lifetime, () => 'administrator', readers);
  await controller.refresh(); await controller.nextSessions(controller.getSnapshot().sessionWindow!); await controller.nextSessions(controller.getSnapshot().sessionWindow!);
  assert.deepEqual(controller.getSnapshot().sessions.map(row => row.id), [...Array.from({length: 10}, (_, i) => `a${i}`), ...Array.from({length: 10}, (_, i) => `b${i}`), 'c0']);
  assert.equal(controller.getSnapshot().totals?.streams, 21);
  await controller.nextSessions(controller.getSnapshot().sessionWindow!); assert.deepEqual(calls, [undefined, 'p2', 'p3']);
  controller.dispose(); lifetime.dispose();
});

test('a changed session page revision refuses the continuation and preserves prior rows', async () => {
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
  const readers: NativeDashboardReaders = {
    sessions: {list: async cursor => cursor ? {...page('changed', 1), revision: 'rev-2'} : page('original', 10, 'next')},
    console: {measurement: async name => ({name, observedAt: 1, freshUntil: 30001, facts: {}}), alerts: async () => [], jobs: async () => ({items: [], nextCursor: ''}), dispose() {}},
  };
  const controller = new NativeDashboardController(lifetime, () => 'administrator', readers);
  await controller.refresh(); await controller.nextSessions(controller.getSnapshot().sessionWindow!);
  assert.equal(controller.getSnapshot().sessionWindow?.refreshRequired, true);
  assert.equal(controller.getSnapshot().sessions[0]?.id, 'original0');
  controller.dispose(); lifetime.dispose();
});

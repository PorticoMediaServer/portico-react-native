import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime';
import {NativeDashboardController, type NativeDashboardReaders} from '../src-next/screens/settings-live/dashboard-controller';

const authority = {serverId: 'server', accountId: 'account', profileId: 'primary', epoch: 'one', viewerFence: 'fence'};
const totals = {streams: 21, paused: 0, converting: 0, bandwidthKbps: 0, people: 21, atHome: 21, away: 0};
const page = (prefix: string, count: number, cursor?: string) => ({items: Array.from({length: count}, (_, i) => ({id: `${prefix}${i}`})) as never[], nextCursor: cursor, totals, scope: {serverId: 'server', viewerFence: 'fence'}});
type Paging = {nextSessions(): Promise<void>; nextJobs(): Promise<void>};

test('TV Dashboard continuation coalesces, keeps prior rows on error and retries its offered cursor', async () => {
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
  let finish!: (value: ReturnType<typeof page>) => void, fail!: (error: Error) => void;
  const sessionCalls: (string | undefined)[] = [], jobCalls: string[] = [];
  const readers: NativeDashboardReaders = {
    sessions: {list: async cursor => {sessionCalls.push(cursor); return cursor === undefined ? page('first', 10, 'offered') : new Promise((resolve, reject) => {finish = resolve; fail = reject;});}},
    console: {measurement: async name => ({name, observedAt: 1, freshUntil: 30001, facts: {}}), alerts: async () => [], jobs: async cursor => {jobCalls.push(cursor ?? ''); return {items: [], nextCursor: ''};}, dispose() {}},
  };
  const controller = new NativeDashboardController(lifetime, () => 'administrator', readers);
  const paging = controller as unknown as NativeDashboardController & Paging;
  await controller.refresh();
  const pending = paging.nextSessions(); await paging.nextSessions(); assert.deepEqual(sessionCalls, [undefined, 'offered']);
  fail(new Error('offline')); await pending;
  assert.deepEqual(controller.getSnapshot().sessions.map(item => item.id), Array.from({length: 10}, (_, i) => `first${i}`));
  const retry = paging.nextSessions(); finish(page('last', 1)); await retry;
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
  const paging = controller as unknown as NativeDashboardController & Paging;
  await controller.refresh(); const stale = paging.nextSessions(); await controller.refresh();
  finish(page('stale', 1)); await stale;
  assert.equal(controller.getSnapshot().sessions.some(item => item.id.startsWith('stale')), false);
  assert.equal(controller.getSnapshot().sessions[0]?.id, 'fresh0');
  controller.dispose(); lifetime.dispose();
});

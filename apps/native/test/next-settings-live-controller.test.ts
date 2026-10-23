import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime';
import {NativeSettingsController, type NativeSettingsReader} from '../src-next/screens/settings-live/settings-controller';
import {NativeDashboardController, type NativeDashboardAdmission, type NativeDashboardReaders} from '../src-next/screens/settings-live/dashboard-controller';
import type {PreferenceSnapshot} from '../../../packages/client-core/src/preferences';
import type {ShellAuthority} from '../src-next/shell/model';

function authority() {
  let value: ShellAuthority = {serverId: 'server', accountId: 'account', profileId: 'main', epoch: 'session1', viewerFence: 'home-fence'};
  let valid = true;
  const listeners = new Set<() => void>();
  return {authority: () => value, current: () => valid, subscribeAuthority: (fn: () => void) => {listeners.add(fn); return () => {listeners.delete(fn);};},
    replace: (next: Partial<ShellAuthority>) => {value = {...value, ...next}; for (const fn of [...listeners]) fn();},
    revoke: () => {valid = false; for (const fn of [...listeners]) fn();}};
}
const preferences = (revision = 1, value = true): PreferenceSnapshot => ({deviceClass: 'television', registryRevision: 'r1',
  registry: {revision: 'r1', fields: [{key: 'playback.autoplayNext', type: 'boolean', default: true, scopes: ['profile-server'], group: 'playback', labelKey: 'autoplay'}]},
  documents: [{scope: 'profile-server', revision, activeRevision: revision, digest: 'a'.repeat(64), values: {'playback.autoplayNext': value}}, {scope: 'profile-device-class', revision: 1, activeRevision: 1, digest: 'b'.repeat(64), values: {}}],
  effective: {'playback.autoplayNext': value}, effectiveSource: {'playback.autoplayNext': 'profile-server'}, clampedFields: []});

test('replaced shell authority aborts in-flight work and refuses a late successful response', async () => {
  const owner = authority(), lifetime = new NativeScreenLifetime(owner);
  let complete!: (value: string) => void;
  let transportSignal: AbortSignal | undefined;
  const read = lifetime.request(signal => {transportSignal = signal; return new Promise<string>(resolve => {complete = resolve;});});
  owner.replace({epoch: 'session2'});
  assert.equal(transportSignal?.aborted, true);
  complete('private result');
  await assert.rejects(read, {name: 'AbortError'});
  await assert.rejects(lifetime.request(async () => 'new request'), {name: 'AbortError'});
  lifetime.dispose();
});

test('each viewport abort belongs to that read, without retiring another current screen', async () => {
  const lifetime = new NativeScreenLifetime(authority()), caller = new AbortController();
  let finish!: () => void;
  const request = lifetime.request(() => new Promise<void>(resolve => {finish = resolve;}), caller.signal);
  caller.abort(); finish();
  await assert.rejects(request, {name: 'AbortError'});
  assert.equal(await lifetime.request(async () => 'still current'), 'still current');
  lifetime.dispose();
});

test('settings commits only the response, with the actual document revision and canonical scope', async () => {
  const lifetime = new NativeScreenLifetime(authority());
  let complete!: (value: PreferenceSnapshot) => void;
  const calls: unknown[][] = [];
  const reader: NativeSettingsReader = {preferences: async () => preferences(), applyPreferences: (...args) => {calls.push(args); return new Promise(resolve => {complete = resolve;});}, dispose() {}};
  const controller = new NativeSettingsController(lifetime, reader, preferences(7));
  const pending = controller.apply('profile-server', {'playback.autoplayNext': false});
  assert.equal(controller.getSnapshot().preferences.effective['playback.autoplayNext'], true);
  assert.equal(controller.getSnapshot().saved, 0);
  assert.equal(await controller.apply('profile-server', {'playback.autoplayNext': true}), false);
  assert.deepEqual(calls, [['profile-server', 'television', 7, {'playback.autoplayNext': false}]]);
  complete(preferences(8, false));
  assert.equal(await pending, true);
  assert.equal(controller.getSnapshot().preferences.effective['playback.autoplayNext'], false);
  assert.equal(controller.getSnapshot().saved, 1);
  controller.accept(preferences(6, true));
  assert.equal(controller.getSnapshot().preferences.documents[0].revision, 8);
  controller.dispose(); lifetime.dispose();
});

test('settings never publishes a save or old private data after revocation', async () => {
  const owner = authority(), lifetime = new NativeScreenLifetime(owner);
  let complete!: (value: PreferenceSnapshot) => void;
  const controller = new NativeSettingsController(lifetime, {preferences: async () => preferences(), applyPreferences: () => new Promise(resolve => {complete = resolve;}), dispose() {}}, preferences());
  const pending = controller.apply('profile-server', {'playback.autoplayNext': false});
  owner.revoke(); complete(preferences(2, false));
  assert.equal(await pending, false);
  assert.equal(controller.getSnapshot().saved, 0);
  controller.dispose(); lifetime.dispose();
});

function dashboardReaders() {
  const calls: string[] = [];
  const readers: NativeDashboardReaders = {
    sessions: {list: async (_cursor, limit) => {calls.push(`sessions:${limit}`); return {items: [], nextCursor: undefined, total: 0, totals: {streams: 0, paused: 0, converting: 0, bandwidthKbps: 0, people: 0, atHome: 0, away: 0}, scope: {serverId: 'server', viewerFence: 'sessions-fence'}};}},
    console: {measurement: async name => {calls.push(name); return {name, observedAt: 1, freshUntil: 30001, facts: {}};}, alerts: async () => {calls.push('alerts'); return [];}, jobs: async () => {calls.push('jobs'); return {items: [], nextCursor: ''};}, dispose() {}},
  };
  return {calls, readers};
}
test('administrator Dashboard reads exactly the first sessions page and no owner endpoint', async () => {
  const lifetime = new NativeScreenLifetime(authority()), {calls, readers} = dashboardReaders();
  const controller = new NativeDashboardController(lifetime, () => 'administrator', readers);
  await controller.refresh();
  assert.deepEqual(calls, ['sessions:10']);
  assert.equal(controller.getSnapshot().admission, 'administrator');
  assert.equal(controller.getSnapshot().error, undefined);
  controller.dispose(); lifetime.dispose();
});

test('denied or non-main-profile Dashboard performs no reads', async () => {
  const lifetime = new NativeScreenLifetime(authority()), {calls, readers} = dashboardReaders();
  const controller = new NativeDashboardController(lifetime, () => 'denied', readers);
  await controller.refresh(); assert.deepEqual(calls, []);
  assert.deepEqual(controller.getSnapshot().sessions, []);
  controller.dispose(); lifetime.dispose();
});

test('Dashboard removes owner-only facts before a demoted viewer read finishes', async () => {
  const lifetime = new NativeScreenLifetime(authority()), {calls, readers} = dashboardReaders();
  let admission: NativeDashboardAdmission = 'owner';
  const controller = new NativeDashboardController(lifetime, () => admission, readers);
  await controller.refresh();
  assert.equal(controller.getSnapshot().health?.name, 'health');
  let finish!: (page: Awaited<ReturnType<NativeDashboardReaders['sessions']['list']>>) => void;
  readers.sessions.list = () => new Promise(resolve => {finish = resolve;});
  admission = 'administrator';
  const pending = controller.refresh();
  assert.equal(controller.getSnapshot().admission, 'administrator');
  assert.equal(controller.getSnapshot().health, undefined);
  assert.equal(controller.getSnapshot().storage, undefined);
  assert.deepEqual(controller.getSnapshot().alerts, []);
  assert.deepEqual(controller.getSnapshot().jobs, []);
  finish({items: [], nextCursor: undefined, totals: {streams: 0, paused: 0, converting: 0, bandwidthKbps: 0, people: 0, atHome: 0, away: 0}, scope: {serverId: 'server', viewerFence: 'sessions-fence'}});
  await pending;
  assert.deepEqual(calls, ['sessions:10', 'health', 'storage', 'alerts', 'jobs']);
  controller.dispose(); lifetime.dispose();
});

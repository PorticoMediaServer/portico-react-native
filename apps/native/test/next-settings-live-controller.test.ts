import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime';
import {NativeSettingsController, type NativeSettingsReader} from '../src-next/screens/settings-live/settings-controller';
import {NativeDashboardController, type NativeDashboardAdmission, type NativeDashboardReaders} from '../src-next/screens/settings-live/dashboard-controller';
import {NativeTogetherController, type NativeTogetherService} from '../src-next/screens/settings-live/together-controller';
import {NativeRecordingsController, type NativeRecordingService} from '../src-next/screens/settings-live/recordings-controller';
import {NativeLiveController} from '../src-next/screens/settings-live/live-controller';
import {nativeGuideClock} from '../src-next/screens/settings-live/guide-presentation';
import {nativeDashboardIdentity} from '../src-next/screens/settings-live/dashboard-presentation';
import {defaultI18n} from '../../../packages/i18n/src';
import type {AdminSession} from '../../../packages/client-core/src/playback-v1/types';
import {legacyChannel, legacyChannelRow} from '../../../packages/client-core/src/guide/legacy-source';
import type {ChannelApi, GuideChannel} from '../../../packages/client-core/src/channel-guide';
import type {DVRPage, Recording, RecordingStorage} from '../../../packages/client-core/src/dvr';
import type {GroupSessionSnapshot} from '../../../packages/client-core/src/group-session';
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

function guideChannel(): GuideChannel {
  return {id: 'channel', sourceId: 'source', provenance: 'live-source', generation: 'generation', name: 'Guide test channel', number: '201', group: '', programmes: [], tuneAvailable: true, recordAvailable: true, tuneUnavailableReason: '', recordUnavailableReason: '', favorite: false, hidden: false, preferenceRevision: 7};
}

test('guide favorite waits for receipt and retries the exact operation key and selected revision', async () => {
  const owner = authority(), lifetime = new NativeScreenLifetime(owner), sent: unknown[] = [];
  let finish!: (value: unknown) => void, generated = 0;
  const api: ChannelApi = {request: <T>(_path: string, method?: string, body?: unknown) => {
    if (method === 'POST') {sent.push(body); if (sent.length === 1) return Promise.reject(new Error('unknown transport outcome')); return new Promise<T>(resolve => {finish = value => resolve(value as T);});}
    return Promise.resolve({protocolVersion: '1.0', serverId: 'server', viewerFence: 'guide-domain-fence', revision: 'directory1', sources: []} as T);
  }};
  const controller = new NativeLiveController(lifetime, api, 'America/Halifax'), channel = legacyChannelRow(guideChannel());
  const requestId = async () => {generated++; return 'ab'.repeat(24);};
  assert.equal(await controller.channelPreference(channel, {favorite: true, hidden: false}, requestId), undefined);
  assert.equal(channel.favorite, false);
  assert.ok(controller.getSnapshot().mutationError);
  const pending = controller.channelPreference(channel, {favorite: true, hidden: false}, requestId);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(controller.getSnapshot().mutating, true);
  assert.equal(await controller.channelPreference(channel, {favorite: true, hidden: false}, requestId), undefined);
  assert.equal(generated, 1);
  assert.deepEqual(sent, [
    {requestId: 'ab'.repeat(24), sourceId: 'source', channelId: 'channel', expectedRevision: 7, favorite: true, hidden: false},
    {requestId: 'ab'.repeat(24), sourceId: 'source', channelId: 'channel', expectedRevision: 7, favorite: true, hidden: false},
  ]);
  assert.equal(channel.favorite, false);
  finish({protocolVersion: '1.0', serverId: 'server', revision: 8});
  const committed = await pending;
  assert.equal(committed?.favorite, true);
  assert.equal(committed && legacyChannel(committed)?.preferenceRevision, 8);
  assert.equal(controller.getSnapshot().mutationError, undefined);
  controller.dispose(); lifetime.dispose();
});

test('guide refuses a late favorite receipt after profile authority changes', async () => {
  const owner = authority(), lifetime = new NativeScreenLifetime(owner);
  let finish!: (value: unknown) => void;
  const api: ChannelApi = {request: <T>() => new Promise<T>(resolve => {finish = value => resolve(value as T);})};
  const controller = new NativeLiveController(lifetime, api, 'America/Halifax'), channel = legacyChannelRow(guideChannel());
  const pending = controller.channelPreference(channel, {favorite: true, hidden: false}, async () => 'cd'.repeat(24));
  await Promise.resolve(); await Promise.resolve();
  owner.replace({profileId: 'other', viewerFence: 'other-home-fence'});
  finish({protocolVersion: '1.0', serverId: 'server', revision: 8});
  assert.equal(await pending, undefined);
  assert.equal(channel.favorite, false);
  controller.dispose(); lifetime.dispose();
});

test('a failed native operation-key generation sends no mutation and can be retried', async () => {
  const lifetime = new NativeScreenLifetime(authority());
  let requests = 0;
  const api: ChannelApi = {request: async <T>() => {requests++; return {protocolVersion: '1.0', serverId: 'server', revision: 8} as T;}};
  const controller = new NativeLiveController(lifetime, api, 'America/Halifax'), channel = legacyChannelRow(guideChannel());
  assert.equal(await controller.channelPreference(channel, {favorite: true, hidden: false}, async () => {throw new Error('native random unavailable');}), undefined);
  assert.equal(requests, 0);
  const result = await controller.channelPreference(channel, {favorite: true, hidden: false}, async () => 'ef'.repeat(24));
  assert.equal(result?.favorite, true);
  controller.dispose(); lifetime.dispose();
});

test('guide clocks use actual device zone and omit TV day periods without changing the hour cycle', () => {
  const at = Date.parse('2026-10-21T19:05:00Z');
  assert.equal(nativeGuideClock('en-US', 'America/Halifax', true)(at), '4:05');
  assert.equal(nativeGuideClock('en-US', 'America/Halifax', true, false)(at), '4:05 PM');
  assert.equal(nativeGuideClock('en-GB', 'America/Halifax', false)(at), '16:05');
  assert.equal(nativeGuideClock('en-US', 'not/a-zone', true)(at), undefined);
  assert.equal(nativeGuideClock('en-US', 'America/Halifax', true)(NaN), undefined);
});

test('Dashboard uses actual show identity and numbering without shortening stored titles', () => {
  const session: AdminSession = {id: 'session', user: 'person', profile: 'profile', device: 'device', title: 'Episode: Special Edition', kind: 'vod', state: 'playing', positionMs: 1000, decision: {}, location: 'local', item: {id: 'episode', kind: 'episode', title: 'Episode: Special Edition', showId: 'show', showTitle: 'Show: Special Edition', seasonNumber: 1, episodeNumber: 3, episodeNumbering: 'seasonal', art: []}};
  const text = {t: defaultI18n.t, locale: 'en-US'};
  assert.deepEqual(nativeDashboardIdentity(session, text), {title: 'Show: Special Edition', secondary: ['S1 E3', 'Episode: Special Edition']});
  assert.deepEqual(nativeDashboardIdentity({...session, item: {...session.item!, episodeNumbering: 'unrecognized'}}, text), {title: 'Show: Special Edition', secondary: ['Episode: Special Edition']});
  assert.deepEqual(nativeDashboardIdentity({...session, item: {...session.item!, kind: 'movie', title: 'Film: Special Edition', year: 2001}}, text), {title: 'Film: Special Edition', secondary: ['2001']});
  assert.deepEqual(nativeDashboardIdentity({...session, item: undefined}, text), {title: 'Episode: Special Edition', secondary: []});
});
function recordingService() {
  let accessChanged = () => {}, disposed = 0;
  const page: DVRPage = {recordings: [], rules: [], nextCursor: '', revision: 1, captureAvailable: true, captureUnavailableReason: '', deletionAvailable: true, usage: {bytes: 0, pendingDeleteBytes: 0, recordings: 0}};
  const storage: RecordingStorage = {policy: {revision: 1, retentionDays: 30, episodeLimit: 0, floorBytes: 1, capBytes: 0}, measurement: {freeBytes: 500, usedBytes: 100, reservedBytes: 10, writeHealthy: true, measuredAt: ''}, pendingDeleteBytes: 0, forecastBytes: 10, forecastHours: 50, forecastDescription: '', captureAvailable: true, warning: ''};
  const unavailable = async (): Promise<never> => {throw new Error('Unexpected fixture mutation');};
  const service: NativeRecordingService = {
    list: async () => page, groups: async () => ({groups: [], nextCursor: '', revision: 1}),
    summary: async () => ({upcoming: 51, recorded: 201, rules: 3, conflicts: 2, groups: 80, unwatched: 60}), storage: async () => storage,
    detail: unavailable, deletePreview: unavailable, schedule: unavailable, update: unavailable, cancel: unavailable, keep: unavailable, delete: unavailable, saveRule: unavailable, deleteRule: unavailable,
    onAccessChanged: fn => {accessChanged = fn;}, dispose: () => {disposed++;},
  };
  return {service, page, storage, revoke: () => accessChanged(), disposed: () => disposed};
}

test('recordings coalesces chip changes to one active page read and the last pending view', async () => {
  const fixture = recordingService(), lifetime = new NativeScreenLifetime(authority()), calls: string[] = [];
  let finish!: (page: DVRPage) => void;
  fixture.service.list = async view => {calls.push(view); if (view === 'upcoming') return new Promise(resolve => {finish = resolve;}); return {...fixture.page, revision: 2};};
  const controller = new NativeRecordingsController(lifetime, fixture.service);
  const pending = controller.load({view: 'upcoming'});
  void controller.load({view: 'rules'}); void controller.load({view: 'history'});
  assert.deepEqual(calls, ['upcoming']);
  finish(fixture.page); await pending;
  assert.deepEqual(calls, ['upcoming', 'history']);
  assert.equal(controller.getSnapshot().query.view, 'history');
  assert.equal(controller.getSnapshot().page?.revision, 2);
  controller.dispose(); controller.dispose(); lifetime.dispose();
  assert.equal(fixture.disposed(), 1);
});

test('recordings aggregate facts stay server counts, independent of the bounded page', async () => {
  const fixture = recordingService(), lifetime = new NativeScreenLifetime(authority()), controller = new NativeRecordingsController(lifetime, fixture.service);
  await controller.load({view: 'upcoming'}); await controller.loadFacts();
  assert.equal(controller.getSnapshot().page?.recordings.length, 0);
  assert.equal(controller.getSnapshot().summary?.upcoming, 51);
  assert.equal(controller.getSnapshot().summary?.recorded, 201);
  assert.equal(controller.getSnapshot().storage, fixture.storage);
  controller.dispose(); lifetime.dispose();
});

test('DVR access revocation clears private aggregates and refuses late page publication', async () => {
  const fixture = recordingService(), lifetime = new NativeScreenLifetime(authority()), controller = new NativeRecordingsController(lifetime, fixture.service);
  await controller.loadFacts();
  let finish!: (page: DVRPage) => void;
  fixture.service.list = () => new Promise(resolve => {finish = resolve;});
  const pending = controller.load(); fixture.revoke(); finish(fixture.page); await pending;
  assert.equal(controller.getSnapshot().accessDenied, true);
  assert.equal(controller.getSnapshot().summary, undefined);
  assert.equal(controller.getSnapshot().storage, undefined);
  assert.equal(controller.getSnapshot().page, undefined);
  assert.equal(controller.getSnapshot().loading, false);
  controller.dispose(); lifetime.dispose();
});

test('DVR mutations preserve the selected revision and publish only after the real receipt', async () => {
  const fixture = recordingService(), owner = authority(), lifetime = new NativeScreenLifetime(owner), controller = new NativeRecordingsController(lifetime, fixture.service);
  const recording: Recording = {id: 'recording', revision: 7, occurrence: {sourceId: 'source', channelId: 'channel', generation: 'generation', programmeId: 'programme'}, programme: {id: 'programme', channelId: 'channel', title: 'A real unit-test record', start: '2026-10-21T12:00:00Z', end: '2026-10-21T13:00:00Z', lineage: 'provider-id', seriesId: '', episodeId: '', newEvidence: 'unknown', description: ''}, ruleId: '', options: {beforeSeconds: 0, afterSeconds: 0, priority: 0, retentionDays: 0, episodeLimit: 0}, start: '2026-10-21T12:00:00Z', end: '2026-10-21T13:00:00Z', state: 'completed', reason: '', keep: false, itemId: '', libraryId: '', coverageStart: '', coverageEnd: '', bytes: 10, conflicts: []};
  fixture.page.recordings = [recording];
  await controller.load();
  let finish!: (value: Recording) => void, sent: Recording | undefined;
  fixture.service.keep = value => {sent = value; return new Promise(resolve => {finish = resolve;});};
  const pending = controller.keep(recording);
  assert.equal(await controller.keep(recording), undefined);
  assert.equal(controller.getSnapshot().busy, true);
  assert.equal(controller.getSnapshot().page?.recordings[0]?.keep, false);
  assert.equal(sent?.revision, 7);
  const receipt = {...recording, revision: 8, keep: true}; fixture.page.recordings = [receipt]; finish(receipt);
  assert.equal((await pending)?.value.revision, 8);
  assert.equal(controller.getSnapshot().busy, false);
  controller.dispose(); lifetime.dispose();
});

test('late DVR mutation receipt cannot report success after the viewer changes', async () => {
  const fixture = recordingService(), owner = authority(), lifetime = new NativeScreenLifetime(owner), controller = new NativeRecordingsController(lifetime, fixture.service);
  let finish!: (value: boolean) => void;
  const pending = controller.act(() => new Promise<boolean>(resolve => {finish = resolve;}));
  owner.replace({profileId: 'other', viewerFence: 'new-home-fence'}); finish(true);
  assert.equal(await pending, undefined);
  assert.equal(controller.getSnapshot().summary, undefined);
  controller.dispose(); lifetime.dispose();
});
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

function togetherService() {
  const state: GroupSessionSnapshot = {directory: [], directoryPhase: 'idle', phase: 'idle', busy: false, clockOffsetMs: 0};
  const calls: string[] = [], listeners = new Set<() => void>();
  const service: NativeTogetherService & {dispose: () => void} = {
    getSnapshot: () => state, subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};},
    serverNow: () => 1, refreshDirectory: async () => {calls.push('directory');}, refreshQueue: async () => {calls.push('queue');},
    open: async () => true, create: async () => true, join: async () => true, dismiss() {calls.push('dismiss');},
    transport: async () => true, invite: async () => true, makeHost: async () => true, queueRemove: async () => true,
    leave: async () => {}, end: async () => true, dispose() {calls.push('borrowed-dispose');},
  };
  return {calls, service, listeners};
}

test('Together teardown releases its subscription without disposing or calling the borrowed app service', async () => {
  const lifetime = new NativeScreenLifetime(authority()), {service, calls, listeners} = togetherService();
  const controller = new NativeTogetherController(lifetime, service);
  assert.equal(listeners.size, 1);
  controller.dispose(); controller.dispose();
  assert.equal(listeners.size, 0);
  await assert.rejects(controller.refresh(), {name: 'AbortError'});
  await assert.rejects(controller.invite(), {name: 'AbortError'});
  assert.deepEqual(calls, []);
  lifetime.dispose();
});

test('Together refuses a late join acknowledgement after the selected viewer changes', async () => {
  const owner = authority(), lifetime = new NativeScreenLifetime(owner), {service} = togetherService();
  let finish!: (joined: boolean) => void;
  service.join = () => new Promise(resolve => {finish = resolve;});
  const controller = new NativeTogetherController(lifetime, service);
  const pending = controller.join('ABCD2345', 'viewer');
  owner.replace({profileId: 'other'}); finish(true);
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(controller.getSnapshot().phase, 'idle');
  controller.dispose(); lifetime.dispose();
});

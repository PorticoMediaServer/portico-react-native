import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime';
import {NativeLiveOwnerController} from '../src-next/screens/settings-live/live-owner-controller';
import {parseChannelMapPage, parseLiveSources, parseSourceDocument, parseTunerDiscovery, millisOf, secondsOf, listOf} from '../src-next/screens/settings-live/live-owner-model';
import {parseAdminRules, parseDVRDocument, parseTunerView} from '../src-next/screens/settings-live/recording-owner-model';
import type {ShellAuthority} from '../src-next/shell/model';

function authority() {
  let value: ShellAuthority = {serverId: 'server', accountId: 'account', profileId: 'main', epoch: 'session1', viewerFence: 'home-fence'};
  let valid = true;
  const listeners = new Set<() => void>();
  return {authority: () => value, current: () => valid, subscribeAuthority: (fn: () => void) => {listeners.add(fn); return () => {listeners.delete(fn);};}, revoke: () => {valid = false; for (const fn of [...listeners]) fn();}};
}

const source = {diagnostics: {skippedChannels: 2, skippedProgrammes: 340, adjustedProgrammes: 5, examples: ['live.import.no-title']}, deliveryValidation: 'ok', capacityKnown: true, planningEstimate: 2, id: 's1', name: 'Synthetic Live TV', revision: 4, state: 'ready', tunerCount: 2, tunerCountMode: 'discovered', generation: 'g1', publishedAt: '2026-10-24T15:50:00Z', channels: 14, programmes: 193};
const settings = {
  enabledGroups: ['News'], enabledChannels: [], kind: 'playlist', streamBufferMs: null, retryWindowMs: 30000, userAgent: '',
  filters: {categories: {mode: 'include', values: ['News']}, countries: {mode: 'exclude', values: []}, keywords: {mode: 'include', values: ['HD']}},
  logoImport: {enabled: true, overwriteExisting: false}, channelNumbering: {mode: 'sequential', startAt: 100, step: 1}, guideSourceId: '', importLimits: null,
};
const defaults = {importLimits: {bytes: 1 << 28, channels: 100000, programmes: 10000000}, streamBufferMs: 8000, retryWindowMs: 60000, userAgent: 'Portico/1.0', guideDays: 7, logoImport: true, discoveryEnabled: true};

test('live source list reads the server envelope and the fields the screen shows', () => {
  const value = parseLiveSources({protocolVersion: '1.0', serverId: 'server', sources: [source], refresh: [{sourceId: 's1', state: 'refreshing', errorCode: '', nextRefresh: '', failures: 0}]}, 'server');
  assert.equal(value.sources[0]!.name, 'Synthetic Live TV');
  assert.equal(value.sources[0]!.programmes, 193);
  assert.equal(value.sources[0]!.diagnostics.skippedProgrammes, 340);
  assert.equal(value.refresh[0]!.state, 'refreshing');
  assert.throws(() => parseLiveSources({protocolVersion: '1.0', serverId: 'other', sources: [], refresh: []}, 'server'), /invalid_response/);
  assert.throws(() => parseLiveSources({protocolVersion: '1.0', serverId: 'server', sources: [{...source, revision: -1}], refresh: []}, 'server'), /invalid_response/);
});

test('one source document keeps null overrides distinct from zero and refuses unreadable settings', () => {
  const value = parseSourceDocument({protocolVersion: '1.0', serverId: 'server', result: {sourceId: 's1', sourceName: 'Synthetic Live TV', revision: 4, digest: 'abc', settings, effective: defaults, availableKinds: ['playlist', 'xmltv-guide'], tunerCount: 2}}, 'server');
  assert.equal(value.settings.streamBufferMs, null);
  assert.equal(value.settings.retryWindowMs, 30000);
  assert.equal(value.effective.streamBufferMs, 8000);
  assert.deepEqual(value.settings.filters.keywords.values, ['HD']);
  assert.throws(() => parseSourceDocument({protocolVersion: '1.0', serverId: 'server', result: {sourceId: 's1', sourceName: 'x', revision: 4, settings: {...settings, filters: {}}, effective: defaults, availableKinds: [], tunerCount: 0}}, 'server'), /invalid_response/);
});

test('channel map pages and tuner discovery read only named fields', () => {
  const map = parseChannelMapPage({protocolVersion: '1.0', serverId: 'server', result: {sourceId: 's1', generation: 'g1', nextCursor: 'c2', items: [{channelId: 'c1', name: 'Northwind News', sourceNumber: '101', number: '12', group: 'News', guideChannelId: '', hidden: true, position: 3, overridden: true}]}}, 'server');
  assert.equal(map.items[0]!.number, '12');
  assert.equal(map.items[0]!.hidden, true);
  const discovery = parseTunerDiscovery({protocolVersion: '1.0', serverId: 'server', result: {devices: [{deviceId: 'd', model: 'Prime', friendlyName: '', address: '192.168.1.50', baseUrl: 'http://192.168.1.50', tunerCount: 3, configured: false}], searchedFor: '', discoveryEnabled: true}}, 'server');
  assert.equal(discovery.devices[0]!.tunerCount, 3);
});

test('recording documents read the server vocabulary and keep signed priorities', () => {
  const dvr = parseDVRDocument({protocolVersion: '1.0', serverId: 'server', result: {revision: 9, settings: {prePaddingMs: 60000, postPaddingMs: 180000, keepPolicy: {mode: 'keep-count', keepCount: 10, keepDays: 0, keepUntilWatched: false}, conversion: {mode: 'none', ladderId: '', deleteOriginal: false}, folderTemplate: '', movieFolderTemplate: '', recordingProfile: 'original', sidecars: {nfo: false, poster: false, fanart: false, thumbnail: false}, tunerPreference: 'first-available', liveTunerConflict: 'keep-watching'}, enumerations: {keepMode: ['keep-all', 'keep-count', 'keep-days']}}}, 'server');
  assert.equal(dvr.settings.keepPolicy.keepCount, 10);
  assert.deepEqual(dvr.enumerations.keepMode, ['keep-all', 'keep-count', 'keep-days']);
  const rules = parseAdminRules({protocolVersion: '1.0', serverId: 'server', result: {items: [{id: 'r1', revision: 2, owner: {authority: 'local', accountId: 'a', profileId: 'p'}, status: '', kind: 'series', name: 'The Clockmakers', match: 'clock', sourceId: 's1', enabled: true, options: {prePaddingMs: null, postPaddingMs: null, keepPolicy: null, newEpisodesOnly: true, priority: -5, folderTemplate: ''}}]}}, 'server');
  assert.equal(rules[0]!.options.priority, -5);
  assert.equal(rules[0]!.options.prePaddingMs, null);
  const tuners = parseTunerView({protocolVersion: '1.0', serverId: 'server', result: {sources: [{sourceId: 's1', sourceName: 'Synthetic Live TV', tunerCount: 2, inUse: 1, conflicts: 1, active: [{kind: 'live', accountName: 'Demo', profileName: 'Sam', recordingId: '', title: 'Cycling: Mountain Stage', state: 'watching', startsAt: '', endsAt: ''}], upcoming: []}], observedAt: '2026-10-24T16:00:00Z', upcomingWindowHours: 48}}, 'server');
  assert.equal(tuners.sources[0]!.conflicts, 1);
  assert.equal(tuners.sources[0]!.active[0]!.profileName, 'Sam');
});

test('seconds, milliseconds and comma lists round-trip without inventing a default', () => {
  assert.equal(secondsOf(null), '');
  assert.equal(secondsOf(8000), '8');
  assert.equal(millisOf(''), null);
  assert.equal(millisOf('8'), 8000);
  assert.deepEqual(listOf(' News, Sports ,, HD '), ['News', 'Sports', 'HD']);
});

test('the owner controller reads the real list and writes only after a server receipt', async () => {
  const owner = authority(), calls: {path: string; method: string; body?: unknown}[] = [];
  let rejection: Error | undefined;
  const lifetime = new NativeScreenLifetime(owner);
  const api = {request: async <T,>(path: string, method = 'GET', body?: unknown) => {
    calls.push({path, method, body});
    if (path === '/v1/admin/live-sources' && method === 'GET') return {protocolVersion: '1.0', serverId: 'server', sources: [source], refresh: []} as T;
    if (path === '/v1/admin/live-sources/s1/enabled') {if (rejection) throw rejection; return {} as T;}
    throw new Error(`unexpected ${method} ${path}`);
  }};
  const controller = new NativeLiveOwnerController(lifetime, api, () => 'op1');
  await controller.load();
  assert.equal(controller.getSnapshot().list?.sources.length, 1);
  rejection = Object.assign(new Error('conflict'), {status: 412});
  await controller.setEnabled('s1', false);
  assert.equal(calls.filter(call => call.method === 'POST').length >= 1, true);
  assert.equal(controller.getSnapshot().error, rejection);
  assert.equal(controller.getSnapshot().list?.sources[0]!.state, 'ready');
  lifetime.dispose(); controller.dispose();
});

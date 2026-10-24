import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpLocalApi, type LocalSession} from '../../../packages/client-core/src';
import {parsePreferenceSnapshot} from '../../../packages/client-core/src/preferences';
import type {NativeShellBootstrapContext} from '../src-next/shell/bootstrap';
import {NativeShellNavigation, nativeDestinationActivation} from '../src-next/shell/routes';
import {nativeDestinationLifetime} from '../src-next/screens/destinations/lifetime';
import {NativeSearchDestination} from '../src-next/screens/search/model';
import {NativeSearchExplore} from '../src-next/screens/search/explore';
import * as navigationPorts from '../src-next/screens/search/navigation';
import {screenModule} from './helpers/screen-harness.mjs';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function preferences(remember: boolean) {
  return parsePreferenceSnapshot({deviceClass: 'television', registryRevision: 'actual-registry', registry: {revision: 'actual-registry', fields: [
    {key: 'search.rememberHistory', type: 'boolean', default: false, group: 'privacy', labelKey: 'preferences.search.rememberHistory', scopes: ['profile-server']},
  ]}, documents: [
    {scope: 'profile-server', revision: 1, activeRevision: 1, digest: 'a'.repeat(64), values: {'search.rememberHistory': remember}},
    {scope: 'profile-device-class', revision: 1, activeRevision: 1, digest: 'b'.repeat(64), values: {}},
  ], effective: {'search.rememberHistory': remember}, effectiveSource: {'search.rememberHistory': 'profile-server'}, clampedFields: []});
}
const art = (id: string) => ({kind: 'item', id, path: `/v1/metadata/item/${id}/art/backdrop?v=${'a'.repeat(64)}&w=1920`});
const history = {serverId: 'server', viewerFence: 'actual-history-fence', maxEntries: 8,
  entries: [{q: 'actual recent search', updatedAt: '2026-10-23T00:00:00Z', uses: 1}]};
async function setup() {
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'home-only'};
  const navigation = new NativeShellNavigation(authority, () => authority), authorityListeners = new Set<() => void>(), preferenceListeners = new Set<() => void>();
  const paths: string[] = [], errors: unknown[] = [], signals: AbortSignal[] = [];
  let current = true, snapshot = preferences(true), historyReply = async (): Promise<unknown> => history;
  const session: LocalSession = {viewer: {...authority, authority: 'local', role: 'member'}, accessToken: '', expiresAt: '2026-10-25T00:00:00Z',
    authorizationHorizon: '2026-10-26T00:00:00Z', sessionFamilyId: 'fixture-family', tokenGeneration: '1'};
  const unavailable = (): never => {throw new Error('unexpected_tv_search_port');};
  const context: NativeShellBootstrapContext = {
    current: () => current, session: () => session, authority: () => authority, navigation,
    api: new HttpLocalApi('https://fixture.invalid', '', async (input, init) => {
      const url = new URL(String(input)); paths.push(url.pathname + url.search);
      if (init?.signal) signals.push(init.signal);
      const data = url.pathname.includes('/history') ? await historyReply()
        : url.searchParams.has('cursor') ? {revision: 'opaque', genres: [{value: 'later', label: 'Later metadata', count: 2, covers: []}]}
        : {revision: 'opaque', genres: [{value: 'no-art', label: 'No art', count: 30, covers: []},
          ...['drama', 'action', 'comedy', 'thriller'].map((value, index) => ({value, label: `Metadata ${value}`, count: 20 - index, covers: [], backdrop: art(value)}))], nextCursor: 'actual-next'};
      return new Response(JSON.stringify(data), {status: 200, headers: {'Content-Type': 'application/json'}});
    }),
    subscribeAuthority: listener => {authorityListeners.add(listener); return () => {authorityListeners.delete(listener);};},
    preferences: () => snapshot, subscribePreferences: listener => {preferenceListeners.add(listener); return () => {preferenceListeners.delete(listener);};},
    get home() {return unavailable();}, get events() {return unavailable();}, get appVersion() {return unavailable();}, get serverName() {return unavailable();},
    get playback() {return unavailable();}, get watch() {return unavailable();}, get account() {return unavailable();}, libraries: () => [],
  };
  const {createNativeTVSearchState} = await screenModule(new URL('../src-next/tv/search/state.ts', import.meta.url), {
    react: {default: {}}, '../../shell/routes': {nativeDestinationActivation}, '../../screens/destinations/lifetime': {nativeDestinationLifetime},
    '../../screens/native-screen-services': {nativeScreenServices: () => ({reportError: (error: unknown) => errors.push(error)})},
    '../../screens/search/model': {NativeSearchDestination}, '../../screens/search/explore': {NativeSearchExplore}, '../../screens/search/navigation': navigationPorts,
  });
  navigation.open({kind: 'shell', destination: {kind: 'search'}}, authority);
  const binding = createNativeTVSearchState(context);
  return {binding, navigation, authority, paths, errors, signals, authorityListeners, preferenceListeners,
    historyReply: (reply: typeof historyReply) => {historyReply = reply;},
    preference: (value: boolean) => {snapshot = preferences(value); for (const listener of [...preferenceListeners]) listener();},
    retire: () => {current = false; for (const listener of [...authorityListeners]) listener();},
  };
}

test('TV Search borrows actual genre navigation and retains one source through Title/Back without any eager I/O', async () => {
  const s = await setup();
  try {
    assert.deepEqual(s.paths, []);
    assert.equal(s.binding.activation.getSnapshot().visible, true);
    assert.equal(s.binding.activation.getSnapshot(), s.binding.activation.getSnapshot(), 'unchanged activation is stable for external-store subscribers');
    await s.binding.explore.load();
    assert.deepEqual(s.binding.explore.getSnapshot().genres.map((genre: {id: string}) => genre.id), ['no-art', 'drama', 'action', 'comedy', 'thriller']);
    s.binding.openGenres(); assert.equal(s.navigation.getSnapshot().route.kind, 'search-genres');
    await s.binding.explore.next(); assert.match(s.paths.at(-1)!, /cursor=actual-next/);
    const genre = s.binding.explore.getSnapshot().genres[1];
    s.binding.explore.openGenre(genre);
    const target = s.navigation.getSnapshot().route;
    assert.equal(target.kind, 'search-genre');
    if (target.kind !== 'search-genre') throw new Error('expected genuine genre route');
    assert.equal(target.value, genre.id); assert.equal(target.label, genre.name);
    const controller = s.binding.genre(target); assert.ok(controller);
    assert.equal(s.binding.genre(target), controller);
    controller.source.remember(0, 23.5);
    s.navigation.open({kind: 'title', entry: {id: 'film', kind: 'movie', libraryId: 'movies', title: 'Actual title'}}, s.authority);
    assert.equal(s.binding.genre(target), controller); assert.equal(controller.activation.getSnapshot().visible, false);
    s.navigation.back(s.authority);
    assert.equal(s.binding.genre(target), controller); assert.equal(controller.source.getMemory().offset, 23.5);
    assert.equal(controller.activation.getSnapshot().intent, 'restore');
    s.navigation.back(s.authority);
    assert.equal(s.binding.genre(target), undefined); assert.equal(controller.source.getMemory().offset, 0);
    assert.deepEqual(s.errors, []);
  } finally {s.binding.dispose(); s.navigation.dispose();}
  assert.equal(s.authorityListeners.size, 0); assert.equal(s.preferenceListeners.size, 0);
});

test('TV Search privacy changes clear history immediately and retirement fences retained objects and pending responses', async () => {
  const s = await setup();
  try {
    await s.binding.destination.refreshHistory(); assert.equal(s.binding.destination.getSnapshot().recent.length, 1);
    s.preference(false); assert.deepEqual(s.binding.destination.getSnapshot().recent, []);
    let finish!: (value: unknown) => void;
    s.historyReply(() => new Promise(resolve => {finish = resolve;}));
    s.preference(true); await tick();
    const signal = s.signals.at(-1); assert.ok(signal);
    s.preference(false); assert.equal(signal.aborted, true);
    finish(history); await tick();
    assert.deepEqual(s.binding.destination.getSnapshot().recent, []);
    let changes = 0;
    s.binding.activation.subscribe(() => {changes++;});
    s.retire(); assert.equal(changes, 1); assert.equal(s.binding.activation.getSnapshot().visible, false);
    const count = s.paths.length;
    assert.equal(s.binding.openGenres(), false);
    await s.binding.explore.load(); await s.binding.destination.refreshHistory();
    assert.equal(s.paths.length, count, 'retired held references cannot issue requests under the next viewer');
    assert.deepEqual(s.errors, []);
    assert.equal(s.authorityListeners.size, 0); assert.equal(s.preferenceListeners.size, 0);
  } finally {s.binding.dispose(); s.navigation.dispose();}
});

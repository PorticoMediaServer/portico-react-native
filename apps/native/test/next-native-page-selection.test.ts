import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {SelectionModel, BrowseSelectionModel} from '../../../packages/client-core/src/selection-model/model.ts';
import {selectionKey, browseSelectionKey, selectionCapabilities, selectionFourthAction} from '../../../packages/client-core/src/selection-model/capabilities.ts';
import {nativeDestinationLifetime} from '../src-next/screens/destinations/lifetime.ts';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const nodes = (value: any): any[] => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : [];
const movie = {id: 'same-film', libraryId: 'movies', kind: 'movie', title: 'Stored movie'};
const song = {id: 'song', libraryId: 'music', kind: 'song', title: 'Stored song'};
async function fixture(browse = false, preserveEvicted = true) {
  const host = hooks(), sourceListeners = new Set<() => void>(), routeListeners = new Set<() => void>(), errors: unknown[] = [], reads: any[] = [], played: any[] = [], destinations: any[] = [];
  const viewer = {serverId: 'server', authority: 'local', accountId: 'account', profileId: 'profile'};
  const authority = {...viewer, epoch: 'epoch', viewerFence: 'home-is-not-this-page'};
  let visible = true, revision = 1, gate: Promise<void> | undefined;
  let snapshot: any = {context: {scope: {...viewer, viewId: 'actual-view', ...(browse ? {} : {privacyFence: 'actual-person-fence'})},
    revision: browse ? {pageRevision: 'actual-opaque-browse-revision'} : {catalogRevision: '12', viewerRevision: '7'}},
    groups: [{id: 'known', status: 'success', items: [movie]}, {id: 'credits', status: 'success', items: [movie]}]};
  const context: any = {api: {}, current: () => true, authority: () => authority, session: () => ({viewer}), subscribeAuthority: () => () => {},
    navigation: {getSnapshot: () => ({revision}), subscribe: (listener: () => void) => {routeListeners.add(listener); return () => routeListeners.delete(listener);}},
    playback: {getSnapshot: () => ({}), cataloguePlayback: () => ({}), subscribe: () => () => {}}};
  class Destination {
    constructor(_options: unknown, entries: unknown[]) {destinations.push(entries);}
    subscribe() {return () => {};}
    async load() {}
    snapshot() {return {busy: false};}
    dispose() {}
  }
  const {createNativePageSelection} = await screenModule(new URL('../src-next/screens/search/selection.tsx', import.meta.url), {
    react: host.react, 'react-native': {Text: 'Text', View: 'View'}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0})},
    '../../../../../packages/i18n/src': {defaultI18n: {t: (key: string) => key}},
    '../../../../../packages/client-core/src/selection-model': {SelectionModel, BrowseSelectionModel, selectionKey, browseSelectionKey, selectionFourthAction,
      readCatalogueSelectionItem: async (lifetime: any, entry: any, ports: any) => {reads.push({lifetime, entry, ports}); await gate; return {id: entry.id, libraryId: entry.libraryId, kind: entry.kind, capabilities: selectionCapabilities(entry.kind, ports)};},
      playCatalogueSelection: async (_port: unknown, items: any[], lifetime: any) => {if (lifetime.isCurrent()) played.push(items);}, enqueueCatalogueSelection: async () => {},
      createCataloguePersonalSelection: () => assert.fail('no personal mutation in this fixture')},
    '../../shell/selection-display': {selectedItemsLabel: (summary: any) => String(summary.count)}, '../../kit/selection': {SelectionBar: 'SelectionBar', SelectionPhoneActionBar: 'SelectionPhoneActionBar'},
    '../../kit/theme': {useTheme: () => ({isTV: true, layers: {navigation: 1}})}, '../../kit/overlays': {Dialog: 'Dialog'}, '../../kit/controls': {Button: 'Button'},
    '../../../../../packages/client-core/src/presentation/errors': {presentError: () => ({body: 'Failure'})}, '../../../../../packages/client-core/src/media-selection': {mediaSelectionKey: (entry: any) => entry.id},
    '../destinations/lifetime': {nativeDestinationLifetime}, '../native-screen-services': {nativeScreenServices: () => ({requestId: async () => 'operation', reportError: (error: unknown) => errors.push(error)})},
    './loaded-destinations': {NativeLoadedDestinations: Destination}, '../destinations/DestinationPicker': {NativeDestinationPicker: 'Picker'}, '../destinations/bulk-media': {NativeBulkMedia: class {}}
  });
  const source = {current: () => visible, subscribe: (listener: () => void) => {sourceListeners.add(listener); return () => sourceListeners.delete(listener);}, getSnapshot: () => snapshot};
  const selection = createNativePageSelection(context, source, {aggregates: true, preserveEvicted});
  const bar = () => {const element = selection.render(() => null); return nodes(host.render(() => element.type(element.props))).find(node => node.type === 'SelectionBar');};
  return {selection, bar, reads, played, destinations, errors, source, context, createNativePageSelection,
    snapshot: () => snapshot, update: (value: any) => {snapshot = value; sourceListeners.forEach(fn => fn());},
    cover: () => {visible = false; revision++; routeListeners.forEach(fn => fn()); sourceListeners.forEach(fn => fn());},
    gate: (value: Promise<void> | undefined) => {gate = value;}, close: () => selection.dispose()};
}

test('Person known-for and credit aliases share one explicit pick and one destination entry', async () => {
  const f = await fixture();
  try {
    f.selection.item('known', movie)!.onEnter(); await tick();
    assert.equal(f.selection.item('credits', movie)!.selected, true);
    assert.equal(f.bar().props.count, 1); assert.equal(f.bar().props.onSelectAll, undefined);
    f.bar().props.onAction('collection'); await tick(); assert.deepEqual(f.destinations, [[movie]]);
    f.selection.clear(); f.selection.item('credits', movie)!.onEnter(); await tick();
    assert.equal(f.selection.item('known', movie)!.selected, true);
    f.selection.item('known', movie)!.onToggle(); await tick(); assert.equal(f.bar(), undefined);
    assert.equal(f.reads.length, 1, 'aliases reuse the same actual grant inside an unchanged producer context');
  } finally {f.close();}
});

test('window eviction retains explicit picks but retires old row callbacks; a new revision retires selection', async () => {
  const f = await fixture();
  try {
    const old = f.selection.item('known', movie)!; old.onEnter(); await tick();
    f.update({...f.snapshot(), groups: [{id: 'known', status: 'success', items: []}, {id: 'credits', status: 'success', items: []}]});
    assert.equal(f.selection.item('known', movie), undefined); old.onToggle(); await tick();
    assert.equal(f.bar().props.count, 1); f.bar().props.onAction('play'); await tick();
    assert.deepEqual(f.played[0].map((item: any) => item.id), [movie.id]);
    const before = f.snapshot(); f.update({...before, context: {...before.context, revision: {catalogRevision: '13', viewerRevision: '7'}}, groups: [{id: 'known', status: 'success', items: [movie]}]});
    old.onEnter(); await tick(); assert.equal(f.bar(), undefined, 'a stale callback cannot borrow a new model for the same resident object');
  } finally {f.close();}
});

test('covered pages abort pending grants and late answers cannot activate selection', async () => {
  const f = await fixture(); let release!: () => void;
  try {
    f.gate(new Promise<void>(resolve => {release = resolve;})); f.selection.item('credits', movie)!.onEnter(); await tick();
    f.cover(); assert.equal(f.reads[0].lifetime.signal.aborted, true); release(); await tick();
    assert.equal(f.bar(), undefined); assert.equal(f.selection.item('credits', movie), undefined); assert.deepEqual(f.played, []);
  } finally {f.close();}
});

test('Browse selects real tracks without an entity privacy fence and aggregate grants stay restricted', async () => {
  const f = await fixture(true);
  try {
    const show = {id: 'show', libraryId: 'tv', kind: 'show', title: 'Show'};
    f.update({...f.snapshot(), groups: [{id: 'songs', status: 'success', offset: 40, items: [song]}, {id: 'credits', status: 'success', items: [show]}]});
    f.selection.item('songs', song)!.onEnter(); await tick(); assert.equal(f.bar().props.count, 1);
    assert.equal('privacyFence' in f.snapshot().context.scope, false); f.selection.clear();
    f.selection.item('credits', show)!.onEnter(); await tick();
    assert.deepEqual(f.reads.at(-1).ports, {play: true, queue: true});
    assert.equal(f.bar().props.actions.some((action: any) => ['collection', 'playlist', 'delete', 'edit', 'watched'].includes(action.id)), false);
  } finally {f.close();}
});

test('music Top and All songs keep separate real Browse contexts and only one active selection', async () => {
  const f = await fixture(true), h = hooks(), listeners = new Set<() => void>(); let current = true;
  const contexts: any[] = [];
  const {createNativeMusicSelection} = await screenModule(new URL('../src-next/screens/destinations/music/selection.tsx', import.meta.url), {
    react: h.react, '../../search/selection': {createNativePageSelection: (context: any, source: any, options: any) => {contexts.push(source.getSnapshot().context); return f.createNativePageSelection(context, source, options);}}
  });
  const state = {songs: [song], allSongs: {songs: [song]}};
  const controller = {getSnapshot: () => state, contains: (entry: any) => current && entry === song,
    subscribe: (listener: () => void) => {listeners.add(listener); return () => listeners.delete(listener);},
    selectionPage: (group: string) => current ? {generation: 9, query: group === 'songs' ? 'actual-playCount-desc-query' : 'actual-title-asc-query', revision: group === 'songs' ? 'top-revision' : 'all-revision', offset: group === 'songs' ? 0 : 40} : undefined};
  const selection = createNativeMusicSelection(f.context, controller, 'actual-route', () => current);
  try {
    assert.deepEqual(contexts.map(value => value.revision), [{pageRevision: 'top-revision'}, {pageRevision: 'all-revision'}]);
    assert.ok(contexts.every(value => !('privacyFence' in value.scope)));
    selection.item('songs', song)!.onEnter(); await tick();
    assert.equal(selection.item('songs', song)!.selected, true); assert.equal(selection.item('all-songs', song)!.selected, false);
    selection.item('all-songs', song)!.onEnter(); await tick();
    assert.equal(selection.item('songs', song)!.selected, false); assert.equal(selection.item('all-songs', song)!.selected, true);
    const old = selection.item('all-songs', song)!; current = false; listeners.forEach(fn => fn()); old.onToggle(); await tick();
    assert.equal(selection.item('all-songs', song), undefined); assert.equal(f.reads.length, 2);
  } finally {selection.dispose(); f.close();}
});


test('sparse Person offsets retain evicted picks without colliding with compact resident positions', async () => {
  const f = await fixture(), later = {...movie, id: 'later-film'};
  try {
    f.update({...f.snapshot(), groups: [{id: 'credits', status: 'success', positions: [160], items: [movie]}]});
    f.selection.item('credits', movie)!.onEnter(); await tick();
    f.update({...f.snapshot(), groups: [{id: 'credits', status: 'success', positions: [240], items: [later]}]});
    f.selection.item('credits', later)!.onEnter(); await tick();
    assert.equal(f.bar().props.count, 2); assert.deepEqual(f.errors, []);
    f.bar().props.onAction('play'); await tick();
    assert.deepEqual(f.played[0].map((item: any) => item.id), [movie.id, later.id]);
  } finally {f.close();}
});

test('evicting an unselected early registration never reuses another live window ID', async () => {
  const f = await fixture(), second = {...movie, id: 'second'}, third = {...movie, id: 'third'};
  try {
    f.update({...f.snapshot(), groups: [{id: 'credits', status: 'success', offset: 0, items: [movie, second]}]});
    f.selection.item('credits', movie)!.onEnter(); await tick();
    f.selection.item('credits', second)!.onEnter(); await tick();
    f.selection.item('credits', movie)!.onToggle(); await tick();
    f.update({...f.snapshot(), groups: [{id: 'credits', status: 'success', offset: 1, items: [second, third]}]});
    f.selection.item('credits', third)!.onEnter(); await tick();
    assert.equal(f.bar().props.count, 2);
    f.selection.item('credits', second)!.onToggle(); await tick();
    assert.equal(f.bar().props.count, 1); assert.equal(f.selection.item('credits', third)!.selected, true);
    assert.deepEqual(f.errors, []);
  } finally {f.close();}
});

test('ordinary Search membership loss still retires explicit picks under the same page token', async () => {
  const f = await fixture(false, false);
  try {
    f.selection.item('known', movie)!.onEnter(); await tick();
    f.update({...f.snapshot(), groups: [{id: 'known', status: 'error', items: []}]});
    assert.equal(f.bar(), undefined); assert.equal(f.selection.item('known', movie), undefined);
  } finally {f.close();}
});

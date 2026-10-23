import {homeActionDiagnostics} from '../src-next/platform/home-action-diagnostics.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as homeSelection from '../../../packages/client-core/src/home-selection/index';
import * as homeCapabilities from '../../../packages/client-core/src/home-selection';
import {HomeService} from '../../../packages/client-core/src/home-service';
import type {ContentEntry} from '../../../packages/client-core/src/library-content';
import {nativeHomeSelectionScope} from '../src-next/shell/selection-scope';
import {NativeShellNavigation, nativeRailDestination, titleRoute} from '../src-next/shell/routes';
import {planHomeWindows} from '../src-next/shell/home-windows';
import {homePlayTarget} from '../src-next/screens/home/model';
import * as readPlatform from '../src-next/screens/read/platform';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

test('actual assembly sends Back to topmost Home menu before player, then TV page, then OS', async () => {
  const h = hooks(), authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'fence'};
  const entry: ContentEntry = {id: 'movie', libraryId: 'movies', kind: 'movie', title: 'Movie', available: true,
    navigation: {view: 'item', entityId: 'movie'}, playback: {itemId: 'movie'}};
  const row = {id: 'continue', viewerFence: 'fence', title: 'Continue', kind: 'continue', artworkShape: 'landscape', entries: [entry, {...entry, id: 'second'}, {...entry, id: 'third'}],
    privacySensitivity: '', policyState: '', priority: 1, required: false, hideable: true, reorderable: true, critical: false, cursorCapable: false,
    total: 3, start: 0, limit: 20, hasMore: false, nextCursor: '', endpoint: '', revision: {catalog: 1, viewer: 1}};
  const raw = {serverId: 'server', viewerFence: 'fence', rows: [row], spotlight: [], layout: {revision: 1, rowOrder: ['continue'], hiddenRowIds: []}, revision: {catalog: 1, viewer: 1}, generatedAt: '2026-10-22T19:00:00Z'};
  // A real HomeService parses and owns the in-memory document; no transport/API call occurs.
  const home = new HomeService({request: async () => JSON.parse(JSON.stringify(raw))});
  await home.load();
  const renderOrder: string[] = [];
  let back: () => boolean = () => false, expanded = false, pageCalls = 0, pageConsumes = true;
  const {createNativeShellBindings} = await screenModule(new URL('../src-next/shell/assembly.tsx', import.meta.url), {
    react: h.react, 'react-native': {BackHandler: {addEventListener: (_: string, fn: () => boolean) => {back = fn; return {remove() {}};}}, NativeModules: {}, Platform: {isTV: true}, View: 'View'},
    '../../../../packages/i18n/src': {defaultI18n: {t: (key: string) => key}},
    '../../../../packages/client-core/src/home-selection/index': homeSelection,
    '../../../../packages/client-core/src/home-selection': homeCapabilities,
    '../../../../packages/client-core/src/presentation/errors': {presentError: () => ({silent: true})},
    '../../../../packages/client-core/src/library-management': {}, '../../../../packages/client-core/src/presentation/home-spotlight': {},
    '../platform/home-action-diagnostics': {homeActionDiagnostics}, '../platform/haptics': {}, '../kit/overlays': {ToastHost: 'Toast'}, '../kit/states': {StateView: 'State'}, '../kit/shell': {OwnerTag: 'Owner'},
    './HomeSelectionBars': {HomeSelectionBars: 'Bars'}, './HomeSelectionOverlays': {HomeSelectionOverlays: 'Overlays'}, './account': {nativeAccountMenu() {}},
    './home-windows': {planHomeWindows},
    './selection-scope': {nativeHomeSelectionScope}, './routes': {nativeRailDestination, titleRoute}, './route-registry': {nativeShellRoutes: {subscribe: () => () => {}, bind: () => ({render: () => {renderOrder.push('active'); return 'active';}, renderWatch: () => null, renderRetained: () => {renderOrder.push('retained'); return 'retained';}, back: () => false, scrollToTop() {}, dispose() {}})}}, '../screens/home/model': {homePlayTarget},
    '../screens/read/platform': readPlatform,
  });
  const navigation = new NativeShellNavigation(authority, () => authority);
  const bindings = createNativeShellBindings({home, session: () => ({viewer: {...authority, authority: 'local', role: 'member'}}), current: () => true,
    authority: () => authority, navigation, libraries: () => [{id: 'movies'}], api: {request() {throw new Error('unexpected request');}}, events: {on: () => () => {}},
    account: {account: {role: 'member'}}, playback: {selectionPlayback: () => ({play() {throw new Error('unused playback');}, enqueue() {throw new Error('unused enqueue');}, playChannel() {throw new Error('unused channel');}}), getSnapshot: () => ({dock: {local: {expanded}}})}});
  bindings.attach({getSnapshot: () => ({authority})});
  const cleanup = bindings.registerTVPageBack(() => {pageCalls++; return pageConsumes;});
  bindings.setHomeWindow(home.getSnapshot().document!.rows[0], 0, 0, 0, true, ['third', 'movie', 'second']);
  bindings.actions.more(home.getSnapshot().document!.rows[0].entries[2], 'continue');
  const controller = bindings.renderSelection().props.children.find((node: any) => node.type === 'Overlays').props.controller;
  assert.ok(controller.getSnapshot().menu, 'the genuine registered member opened the controller menu');
  assert.equal(controller.getSnapshot().menu.member.entry.id, 'third', 'physical first slot is admitted through its genuine source index');
  assert.equal(bindings.homeMenuRow(controller.getSnapshot().menu.windowId), home.getSnapshot().document!.rows[0]);
  raw.rows[0].entries[2] = {...raw.rows[0].entries[2], title: 'Current server title'};
  await home.revalidate();
  const latest = home.getSnapshot().document!.rows[0].entries.find(value => value.id === 'third')!;
  assert.equal(controller.getSnapshot().menu?.member.entry, latest, 'same-authority menu actions use the actual latest source object after refresh');
  assert.equal(controller.getSnapshot().menu?.member.entry.title, 'Current server title');
  expanded = true;
  assert.equal(back(), true);
  assert.equal(controller.getSnapshot().menu, null, 'menu closes before expanded player handles Back');
  assert.equal(pageCalls, 0);
  assert.equal(back(), false, 'expanded player retains its own Back handling');
  expanded = false;
  assert.equal(back(), true); assert.equal(pageCalls, 1);
  pageConsumes = false;
  assert.equal(back(), false, 'Home opening state falls through to OS on second Back');
  const removeRail = bindings.registerTVRailBack(() => true);
  navigation.open({kind: 'shell', destination: {kind: 'saved'}}, authority);
  assert.equal(back(), true, 'rail Back returns to its actual page even away from Home');
  removeRail();
  navigation.open(titleRoute(entry), authority);
  assert.deepEqual(bindings.getState().destination, {kind: 'saved'}, 'a title retains its real origin for Back');
  assert.deepEqual(bindings.getState().railDestination, {kind: 'library', libraryId: 'movies'}, 'rail highlights the authorized title library');
  assert.equal(bindings.getState().contentVisible, false);
  navigation.back(authority);
  assert.deepEqual(bindings.getState().railDestination, {kind: 'saved'});
  assert.equal(bindings.getState().contentVisible, true);
  navigation.open({kind: 'home-customize'}, authority);
  const routes = bindings.renderRoutes();
  assert.deepEqual(renderOrder, ['active', 'retained'], 'current module exists before its retained native views are requested');
  assert.deepEqual(routes.props.children, ['retained', 'active'], 'retained views stay mounted below the active route');
  cleanup(); bindings.dispose(); navigation.dispose(); home.dispose();
});

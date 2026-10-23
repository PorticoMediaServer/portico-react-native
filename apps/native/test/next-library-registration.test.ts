import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {NativeShellNavigation, nativeDestinationActivation} from '../src-next/shell/routes.ts';
import {nativeDestinationLifetime} from '../src-next/screens/destinations/lifetime.ts';
import {NativeLibrarySaveView} from '../src-next/screens/library/save-view.ts';
import {nativeLibraryCanSave} from '../src-next/screens/library/model.ts';
import {defaultI18n} from '../../../packages/i18n/src';
import {browseNameId} from '../../../packages/client-core/src/presentation/browse-toolbar.ts';

test('the handheld Library module self-registers real actions and a captured receipt-backed Save-view sheet', async () => {
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'home-only'};
  const navigation = new NativeShellNavigation(authority, () => authority);
  navigation.open({kind: 'shell', destination: {kind: 'library', libraryId: 'actual'}});
  let kind: string | undefined, create: any, ports: any, disposed = 0;
  const {react} = hooks(), posts: any[] = [], operationId = '12345678-1234-4123-8123-123456789abc';
  const {createNativeHandheldLibraryModule} = await screenModule(new URL('../src-next/screens/library/register.tsx', import.meta.url), {
    react, '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/browse-toolbar': {browseNameId},
    '../../shell/route-registry': {nativeShellRoutes: {registerDestination: (value: string, factory: any) => {kind = value; create = factory;}}},
    '../../shell/routes': {nativeDestinationActivation}, '../destinations/lifetime': {nativeDestinationLifetime},
    '../native-screen-services': {nativeScreenServices: () => ({requestId: async () => operationId})},
    '../destinations/entry-actions': {createNativeEntryActions: () => ({open() {}, play() {}, menu() {}, dispose() {}})},
    './index': {createNativeLibraryRenderer: (_context: unknown, actual: unknown) => {ports = actual; return {render: () => null, dispose: () => {disposed++;}};}},
    './model': {nativeLibraryCanSave}, './save-view': {NativeLibrarySaveView}, './SaveViewSheet': {NativeLibrarySaveViewSheet: 'SaveViewSheet'},
  });
  assert.equal(kind, 'library'); assert.equal(create, createNativeHandheldLibraryModule);
  const context = {current: () => true, navigation, authority: () => authority, session: () => ({viewer: {...authority, authority: 'local'}}),
    api: {request: async (path: string, method?: string, body?: unknown) => {
      if (method === 'POST') {posts.push(body); return {serverId: 'server', viewerFence: 'actual-viewer', receipt: {operationId, revision: 1, resourceId: 'new-view', deleted: false}};}
      return {serverId: 'server', viewerFence: 'actual-viewer', revision: 1, resources: [], nextCursor: ''};
    }}};
  const module = create(context);
  const definition = {libraryId: 'actual', pivot: 'movies', query: {field: 'favorite', operator: 'equals', value: true}, sort: [{field: 'title', direction: 'asc'}], presentation: 'grid'};
  const source = {phase: 'ready', library: {id: 'actual'}, tab: {}, discover: {appended: []}, defaultSort: {field: 'title', direction: 'asc'}};
  let captured = 0;
  const destination = {getSnapshot: () => source, captureSavedView: () => {captured++; return definition;}};
  const actions = ports.actions(destination), draft = {predicates: [definition.query], sort: definition.sort[0]};
  actions.saveView(destination, draft); assert.equal(captured, 1);
  const outlet = module.renderOverlays({}), naming = outlet.props.store.getSnapshot();
  naming.setName('Actual view name'); await naming.save();
  assert.equal(posts.length, 1); assert.deepEqual(posts[0].definition, definition); assert.equal(posts[0].name, 'Actual view name');
  assert.equal(outlet.props.store.getSnapshot(), undefined, 'only a real saved receipt closes the owned naming outlet');
  actions.saveView(destination, draft);
  const retired = outlet.props.store.getSnapshot(); navigation.open({kind: 'shell', destination: {kind: 'home'}});
  assert.equal(outlet.props.store.getSnapshot(), undefined); assert.equal(retired.getSnapshot().open, false);
  module.dispose(); assert.equal(disposed, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {defaultI18n} from '../../../packages/i18n/src';
import {browseNameId} from '../../../packages/client-core/src/presentation/browse-toolbar';
import {nativeDestinationLifetime} from '../src-next/screens/destinations/lifetime';
import {nativeLibraryCanSave} from '../src-next/screens/library/model';
import {NativeLibrarySaveView} from '../src-next/screens/library/save-view';
import {NativeShellNavigation, nativeDestinationActivation} from '../src-next/shell/routes';

test('TV Library requires a real summary of the same captured definition and saves through the existing receipt controller', async () => {
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'home-only'};
  const navigation = new NativeShellNavigation(authority, () => authority);
  navigation.open({kind: 'shell', destination: {kind: 'library', libraryId: 'actual'}}, authority);
  const {react} = hooks(), posts: any[] = [], summaries: unknown[] = [], errors: unknown[] = [];
  let registered = 0, factory: any, ports: any, membership: any, disposed = 0;
  const operationId = '12345678-1234-4123-8123-123456789abc';
  const {registerNativeTVLibrary} = await screenModule(new URL('../src-next/tv/library/module.tsx', import.meta.url), {
    react, '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/browse-toolbar': {browseNameId},
    '../../shell/route-registry': {nativeShellRoutes: {registerDestination: (kind: string, create: any) => {assert.equal(kind, 'library'); registered++; factory = create; return () => {};}}},
    '../../shell/routes': {nativeDestinationActivation}, '../../screens/destinations/lifetime': {nativeDestinationLifetime},
    '../../screens/native-screen-services': {nativeScreenServices: () => ({requestId: async () => operationId, reportError: (error: unknown) => errors.push(error)})},
    '../../screens/destinations/entry-actions': {createNativeEntryActions: (_context: unknown, actual: unknown) => {membership = actual; return {open() {}, play() {}, menu() {}, dispose() {}};}},
    '../../screens/library': {createNativeLibraryRenderer: (_context: unknown, actual: unknown) => {ports = actual; return {render: () => null, dispose: () => {disposed++;}};}},
    '../../screens/library/model': {nativeLibraryCanSave}, '../../screens/library/save-view': {NativeLibrarySaveView},
  });
  assert.equal(registered, 0, 'importing an unbound TV module cannot install a placeholder naming flow');
  const namingUI = () => 'actual caller-owned keyboard';
  registerNativeTVLibrary({summarize: (definition: unknown) => {summaries.push(definition); return 'Actual domain summary';}, renderNaming: namingUI});
  assert.equal(registered, 1);
  const context = {current: () => true, navigation, authority: () => authority, session: () => ({viewer: {...authority, authority: 'local'}}),
    api: {request: async (_path: string, method?: string, body?: unknown) => {
      if (method === 'POST') {posts.push(body); return {serverId: 'server', viewerFence: 'actual-viewer', receipt: {operationId, revision: 1, resourceId: 'view', deleted: false}};}
      return {serverId: 'server', viewerFence: 'actual-viewer', revision: 1, resources: [], nextCursor: ''};
    }}};
  const module = factory(context);
  const definition = {libraryId: 'actual', pivot: 'movies', query: {field: 'favorite', operator: 'equals', value: true}, sort: [{field: 'title', direction: 'asc'}], presentation: 'grid'};
  const entry = {id: 'actual-card', libraryId: 'actual', kind: 'movie', title: 'Actual title'};
  let resident = [entry], capture = definition;
  const source = {phase: 'ready', library: {id: 'actual'}, tab: {}, discover: {appended: []}, collection: {residentItems: () => resident}, defaultSort: {field: 'title', direction: 'asc'}};
  const destination = {getSnapshot: () => source, captureSavedView: () => capture};
  const actions = ports.actions(destination), draft = {predicates: [definition.query], sort: definition.sort[0]};
  try {
    assert.equal(membership.contains(entry), true); resident = []; assert.equal(membership.contains(entry), false);
    actions.saveView(destination, draft);
    const outlet = module.renderOverlays({}), input = outlet.props.store.getSnapshot();
    assert.equal(input.controller.getSnapshot().name, 'Actual domain summary');
    assert.strictEqual(summaries[0], definition); assert.strictEqual(input.definition, definition);
    assert.equal(outlet.props.bindings.renderNaming, namingUI, 'no phone sheet is substituted');
    assert.equal(posts.length, 0, 'opening the keyboard is not a save mutation');
    capture = {...definition, query: {field: 'watched', operator: 'equals', value: true}};
    input.controller.setName('Edited actual name'); await input.controller.save();
    assert.equal(posts.length, 1); assert.deepEqual(posts[0].definition, definition); assert.equal(posts[0].name, 'Edited actual name');
    assert.equal(outlet.props.store.getSnapshot(), undefined, 'only the actual saved receipt closes the keyboard');
    actions.saveView(destination, draft);
    const pending = outlet.props.store.getSnapshot();
    navigation.open({kind: 'shell', destination: {kind: 'home'}}, authority);
    assert.equal(pending.controller.getSnapshot().open, false);
    await pending.controller.save(); assert.equal(posts.length, 1, 'navigation retirement cannot revive the old save');
    assert.equal(membership.current(), false); assert.deepEqual(errors, []);
  } finally {module.dispose(); module.dispose(); navigation.dispose();}
  assert.equal(disposed, 1);
});

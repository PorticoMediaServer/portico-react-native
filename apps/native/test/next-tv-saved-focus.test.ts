import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node?.props ? [node, ...nodes(node.props.children)] : [];
}

test('TV Saved tabs have a mounted content target and return edges for every tab', async () => {
  for (const tab of ['watchlist', 'favorites', 'history', 'playlists', 'collections', 'views']) {
    const host = hooks();
    let visible = true;
    const ids = {savedTabs: 'tabs', savedGrid: 'grid', rail: 'rail'};
    const {TVSavedScreen} = await screenModule(new URL('../src-next/screens/destinations/saved/TVSavedScreen.tsx', import.meta.url), {
      react: host.react,
      'react-native': {ScrollView: 'ScrollView', Text: 'Text', View: 'View'},
      '../../../../../../packages/i18n/src': {defaultI18n: {t: (key: string) => key, number: String}},
      '../../../../../../packages/client-core/src/presentation/kit-model/text': {durationText: String},
      '../../../kit/artwork': {Artwork: 'Artwork'},
      '../../../kit/controls': {Button: 'Button', Chip: 'Chip', Focusable: 'Focusable'},
      '../../../kit/cards': {PosterCard: 'PosterCard', SquareCard: 'SquareCard'},
      '../../../kit/overlays': {Dialog: 'Dialog', Menu: 'Menu'},
      '../../../kit/states': {StateView: 'StateView'},
      '../../../kit/focus': {FocusRegion: 'FocusRegion'},
      '../../../kit/browse/presentation': {browseType: () => ({})},
      '../../../kit/theme': {useTheme: () => ({colors: {}})},
      '../focus': {nativeDestinationFocusIds: () => ids},
      '../../saved/SavedTVTabs': {SavedTVTabs: 'SavedTVTabs'},
      '../../saved/SavedTVDirectory': {SavedTVDirectory: 'SavedTVDirectory'},
    });
    const snapshot = {phase: 'ready', entries: [], resources: [],
      posters: {sections: [{entries: [{id: 'movie/1', kind: 'movie', title: 'Movie'}]}]},
      squares: {sections: [{entries: [{id: 'song/1', kind: 'song', title: 'Song'}]}]},
    };
    const props = {
      controller: {subscribe: () => () => {}, getSnapshot: () => snapshot, source: () => ({})},
      activation: {subscribe: () => () => {}, getSnapshot: () => ({visible})},
      runtime: {reportError: () => {}, text: {}, artwork: () => undefined, getSnapshot: () => ({libraries: []})}, actions: {isMenuOpen: () => false}, authority: {}, initialTab: tab,
      openSaved: () => {}, openEntry: () => {}, browseHome: () => {},
    };
    const render = () => nodes(host.render(() => TVSavedScreen(props as any)));
    const mounted = render();
    const tabs = mounted.find(node => node.type === 'SavedTVTabs');
    const directory = mounted.find(node => node.type === 'SavedTVDirectory');
    if (directory) {
      assert.equal(tabs.props.contentRegionId, directory.props.regionId);
      assert.equal(directory.props.enabled, true);
      assert.deepEqual(directory.props.edges, {up: ids.savedTabs, left: ids.rail});
      visible = false;
      assert.equal(render().find(node => node.type === 'SavedTVDirectory').props.enabled, false);
      continue;
    }
    const region = mounted.find(node => node.type === 'FocusRegion');
    assert.equal(tabs.props.contentRegionId, region.props.id, tab);
    assert.deepEqual(region.props.edges, {up: ids.savedTabs, left: ids.rail});
    assert.equal(region.props.enabled, true);
    for (const control of nodes(region.props.children).filter(node => ['Button', 'Chip', 'PosterCard', 'SquareCard'].includes(node.type) && !node.props.disabled)) {
      assert.ok(control.props.focusId || control.props.testID, 'every focusable region child has a stable address');
    }
    assert.ok(nodes(region.props.children).some(node => node.type === 'Button'), 'content controls belong to the target region');
    visible = false;
    assert.equal(render().find(node => node.type === 'FocusRegion').props.enabled, false, 'retained hidden content cannot receive focus');
  }
});

test('TV Saved directory keeps filters, retry and pagination inside its content region', async () => {
  const host = hooks();
  let snapshot: any;
  const {SavedTVDirectory} = await screenModule(new URL('../src-next/screens/saved/SavedTVDirectory.tsx', import.meta.url), {
    react: host.react,
    'react-native': {ScrollView: 'ScrollView', Text: 'Text', View: 'View'},
    '../../../../../packages/i18n/src': {defaultI18n: {t: (key: string) => key}},
    '../../kit/controls': {Chip: 'Chip', Focusable: 'Focusable'},
    '../../kit/artwork': {AmbientArt: 'AmbientArt', CoverMosaic: 'CoverMosaic', MediaArt: 'MediaArt'},
    '../../kit/cards/primitives': {CardFrame: 'CardFrame'},
    '../../kit/focus': {FocusRegion: 'FocusRegion'},
    '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/states': {StateView: 'StateView'},
    '../../kit/browse/presentation': {alpha: () => '', browseType: () => ({})},
    '../../kit/theme': {useTheme: () => ({colors: {}, gutter: 64})},
    './presentation': Object.fromEntries(['savedCollectionCount', 'savedItemCount', 'savedLibraryName', 'savedTitleCount', 'savedViewCount', 'savedVisibility'].map(key => [key, String])),
  });
  const props: any = {
    view: 'playlists', enabled: true, regionId: 'grid', edges: {up: 'tabs', left: 'rail'}, libraries: [],
    destination: {subscribe: () => () => {}, getSnapshot: () => snapshot},
    runtime: {error: () => ({primaryAction: {id: 'retry', label: 'Retry', onPress: () => {}}})},
  };
  for (const phase of ['empty', 'ready', 'error', 'loading']) {
    snapshot = {phase: phase === 'loading' ? 'loading' : 'ready', ...(phase === 'error' ? {error: new Error('offline')} : {}),
      ...(phase === 'loading' ? {} : {saved: {projection: {
        query: {}, sorts: [{id: 'title'}], filters: [{id: 'category', options: [{id: 'all', label: 'All'}]}],
        sections: [{totalCount: phase === 'ready' ? 1 : 0, entries: phase === 'ready' ? [{id: 'one', kind: 'playlist'}] : []}],
      }, pagination: {next: [{sectionId: 'main'}]}}}),
    };
    const tree = host.render(() => SavedTVDirectory(props));
    assert.equal(tree.type, 'FocusRegion', phase);
    assert.equal(tree.props.id, 'grid');
    assert.deepEqual(tree.props.edges, props.edges);
    const children = nodes(tree.props.children);
    if (phase !== 'loading') assert.ok(children.some(node => node.props.focusId === 'tv-saved-sort'), phase);
    if (phase === 'ready') assert.ok(children.some(node => node.props.focusId === 'tv-saved-more'));
    if (phase === 'error') assert.equal(children.find(node => node.type === 'StateView').props.primaryAction.id, 'retry');
    props.enabled = false;
    assert.equal(host.render(() => SavedTVDirectory(props)).props.enabled, false);
    props.enabled = true;
  }
});

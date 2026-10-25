import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node?.props ? [node, ...nodes(node.props.children)] : [];
}

test('TV Saved tabs have a mounted content target and return edges for every non-directory tab', async () => {
  for (const tab of ['watchlist', 'favorites', 'history']) {
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
      controller: {subscribe: () => () => {}, getSnapshot: () => snapshot},
      activation: {subscribe: () => () => {}, getSnapshot: () => ({visible})},
      runtime: {reportError: () => {}, text: {}, artwork: () => undefined}, actions: {}, authority: {}, initialTab: tab,
      openSaved: () => {}, openEntry: () => {}, browseHome: () => {},
    };
    const render = () => nodes(host.render(() => TVSavedScreen(props as any)));
    const mounted = render();
    const tabs = mounted.find(node => node.type === 'SavedTVTabs');
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

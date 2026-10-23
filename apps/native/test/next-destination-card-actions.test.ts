import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {createTheme} from '../src-next/kit/theme.ts';
import {holdCard, type CardActions} from '../src-next/kit/cards/model.ts';

type Element = {type: any; props: Record<string, any>};
function elements(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return node && typeof node === 'object' && 'props' in node ? [node, ...elements(node.props.children)] : [];
}
const runtime = {text: {}, artwork: () => undefined, reportError() {}};
const theme = createTheme({width: 390, isTV: false});
const selection = (calls: string[], active = false) => ({active, selected: false, onToggle: () => calls.push('toggle'), onEnter: () => calls.push('enter')});

async function searchFixture(group = 'all') {
  const host = hooks(), calls: any[] = [], selected = selection(calls);
  const entry = {id: 'real-result', kind: 'movie', libraryId: 'movies', title: 'Actual title'};
  const snapshot = {text: 'actual', group, groups: [{id: 'movies', status: 'success', items: [entry], totalCount: 1}], recent: [],
    search: {phase: 'ready', data: {capabilities: {groups: [{id: 'movies', available: true}]}}}};
  const actions = {open: (...args: any[]) => calls.push(['open', ...args]), play() {}, menu: (...args: any[]) => calls.push(['menu', ...args]),
    isMenuOpen: (item: any, kind: string) => item === entry && kind === 'movies'};
  const {SearchGridCard} = await screenModule(new URL('../src-next/screens/search/SearchGridCard.tsx', import.meta.url), {
    react: host.react, 'react-native': {View: 'View'}, '../../kit/cards': {PosterCard: 'PosterCard', SquareCard: 'SquareCard', CircleCard: 'CircleCard', EpisodeTile: 'EpisodeTile'},
    '../home/model': {homeCardText: () => ({caption: []})}, './model': {nativeSearchEntryKey: (kind: string, item: any) => JSON.stringify([kind, item.kind, item.id])},
  });
  const {SearchScreen} = await screenModule(new URL('../src-next/screens/search/SearchScreen.tsx', import.meta.url), {
    react: {...host.react, useId: () => 'gradient'}, 'react-native': {FlatList: 'FlatList', ScrollView: 'ScrollView', Text: 'Text', View: 'View', Keyboard: {}, useWindowDimensions: () => ({width: 390, height: 844})},
    'react-native-svg': {default: 'Svg'}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0})},
    '../../../../../packages/i18n/src': {defaultI18n: {t: (id: string) => id}},
    '../../../../../packages/client-core/src/presentation/search-model': {orderedSearchGroups: (groups: unknown) => groups, SEARCH_CHIPS: [], searchGroupLabel: (id: string) => id, topSearchResult: () => undefined},
    '../../kit/artwork': {Artwork: 'Artwork'}, '../../kit/cards': {PosterCard: 'PosterCard', SquareCard: 'SquareCard', CircleCard: 'CircleCard', EpisodeTile: 'EpisodeTile'},
    '../../kit/cards/primitives': {CardFrame: 'CardFrame'}, '../../kit/controls': {Focusable: 'Focusable'}, '../../kit/selection': {SelectionCircle: 'SelectionCircle'},
    '../../kit/states': {}, '../../kit/Icon': {}, '../../kit/browse/presentation': {browseType: () => ({})}, '../../kit/theme': {useTheme: () => theme},
    '../home/model': {homeCardText: () => ({caption: []})}, './model': {nativeSearchEntryKey: (kind: string, item: any) => JSON.stringify([kind, item.kind, item.id])},
    './SearchGridCard': {SearchGridCard}, './TVSearchScreen': {TVSearchScreen: 'TVSearchScreen'},
  });
  const tree = host.render(() => SearchScreen({destination: {subscribe() {}, getSnapshot: () => snapshot, setText() {}}, runtime,
    explore: {subscribe() {}, getSnapshot: () => ({genres: []})}, actions, activation: {subscribe() {}, getSnapshot: () => ({visible: true, intent: 'enter', revision: 1})},
    selection: {item: () => selected, render: () => 'real-selection-toolbar'}}));
  return {host, tree, entry, actions, selected, calls};
}

test('Search rows bind the actual card anchor/live menu and selecting touch holds only toggle', async () => {
  const f = await searchFixture();
  const row = elements(f.tree).find(node => node.type?.name === 'SearchResultRow')!;
  const tree = f.host.render(() => row.type(row.props));
  const card = elements(tree).find(node => node.type === 'CardFrame')!;
  assert.equal(card.props.selection, f.selected, 'inactive selection remains available to CardFrame accessibility actions');
  assert.equal(card.props.moreExpanded, true);
  const realNativeCard = {actual: 'card'}; card.props.menuAnchorRef.current = realNativeCard;
  holdCard(card.props as CardActions, false);
  assert.deepEqual(f.calls, [['menu', f.entry, 'movies', card.props.menuAnchorRef]]);
  assert.equal(f.calls[0][3].current, realNativeCard);
  f.selected.active = true;
  holdCard(card.props as CardActions, false);
  assert.deepEqual(f.calls.at(-1), 'toggle');
  holdCard(card.props as CardActions, true);
  assert.deepEqual(f.calls.at(-1), ['menu', f.entry, 'movies', card.props.menuAnchorRef], 'TV Menu/hold keeps the existing behavior');
  assert.ok(elements(f.tree).some(node => node.props.children?.includes('real-selection-toolbar')));
});

test('Search grid passes genuine inactive selection to media, people and artist shared cards', async () => {
  const f = await searchFixture('movies');
  const list = elements(f.tree).find(node => node.type === 'FlatList')!;
  const element = list.props.renderItem({item: f.entry});
  for (const group of ['movies', 'people', 'artists']) {
    const card = f.host.render(() => element.type({...element.props, group}));
    assert.equal(card.type, group === 'movies' ? 'PosterCard' : 'CircleCard');
    assert.equal(card.props.selection, f.selected);
    card.props.onMore();
    assert.deepEqual(f.calls.at(-1), ['menu', f.entry, group, card.props.menuAnchorRef]);
    assert.equal(card.props.moreExpanded, group === 'movies');
    assert.equal(card.props.onLongPressAction, undefined, 'no custom hold handler bypasses CardFrame');
  }
});

test('Saved preview cards preserve inactive selection and the actual native menu anchor', async () => {
  const host = hooks(), calls: any[] = [], selected = selection(calls), entry = {id: 'saved-id', kind: 'movie', title: 'Actual saved title'};
  const projection = {sections: [{entries: [entry]}]}, state = {myList: {projection}, favorites: {}, playlists: {}, collections: {}, views: {}, pins: []};
  const actions = {menuEntry: (...args: any[]) => calls.push(args), isMenuOpen: (value: any) => value === entry};
  const {SavedScreen} = await screenModule(new URL('../src-next/screens/saved/SavedScreen.tsx', import.meta.url), {
    react: host.react, 'react-native': {ScrollView: 'ScrollView', Text: 'Text', View: 'View'}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0})},
    '../../../../../packages/i18n/src': {defaultI18n: {t: (id: string) => id}}, '../../kit/cards': {PosterCard: 'PosterCard', SquareCard: 'SquareCard'},
    '../../kit/controls': {Focusable: 'Focusable'}, '../../kit/states': {}, '../../kit/Icon': {}, '../../kit/browse/presentation': {browseType: () => ({}), alpha: () => ''},
    '../../kit/theme': {useTheme: () => theme}, '../../platform/offline-downloads': {groupOfflineEntries: () => []}, '../home/model': {homeCardText: () => ({caption: []})},
    './model': {savedProjectionCount: () => undefined, savedDirectoryCount: () => undefined},
    './SavedDownloadCard': {SavedDownloadCard: 'SavedDownloadCard'},
  });
  const tree = host.render(() => SavedScreen({destination: {subscribe() {}, getSnapshot: () => state}, runtime, device: {subscribe() {}, getSnapshot: () => ({entries: []})},
    actions, selection: {item: () => selected, render: () => 'actual-toolbar'}}));
  const child = elements(tree).find(node => node.type?.name === 'SavedMyListCard')!;
  const card = host.render(() => child.type(child.props));
  assert.equal(card.props.selection, selected); assert.equal(card.props.moreExpanded, true);
  const actualCard = {actual: 'native-saved-card'}; card.props.menuAnchorRef.current = actualCard; card.props.onMore();
  assert.deepEqual(calls, [[entry, card.props.menuAnchorRef]]); assert.equal(calls[0][1].current, actualCard);
  selected.active = true; holdCard(card.props, false); assert.equal(calls.at(-1), 'toggle');
});

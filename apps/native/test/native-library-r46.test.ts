import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {createTheme} from '../src-next/kit/theme.ts';
import * as libraryJump from '../src-next/screens/library/jump.ts';
import {hiddenReadingLibraryOnTV, isReadingLibraryKind} from '../src-next/screens/read/platform.ts';
import {homeActionDiagnostics} from '../src-next/platform/home-action-diagnostics.ts';
import {libraryTabletGridGeometry} from '../src-next/screens/library/library-grid.ts';

// The phone Library screen's own declared geometry and paint, taken from
// phone-app.html #r2a (frame 4) and its filter/browse frames: the compact 44
// row with the 38-high back control, the 46-high pivot strip with a 3px accent
// underline, the scrolling strip for the 6+ Music pivots, the count's own
// 10/20 row, and the rack-focus-unchanged TV strip.
type Element = {type: unknown; props: Record<string, any>};
function elements(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return node && typeof node === 'object' && 'props' in node ? [node, ...elements(node.props.children)] : [];
}
const alpha = (color: string, opacity: number) => `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;
const flatten = (style: any): Record<string, unknown> => Array.isArray(style) ? Object.assign({}, ...style.flat(9).filter(Boolean).map(flatten)) : style ?? {};

async function libraryScreen(width: number, isTV = false) {
  const host = hooks(), theme = createTheme({width, isTV});
  const modules = {
    react: host.react,
    'react-native': {ScrollView: 'ScrollView', Text: 'Text', View: 'View', useWindowDimensions: () => ({width, height: 844}),
      StyleSheet: {create: (styles: unknown) => styles, absoluteFill: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0}}},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 47, bottom: 34, left: 0, right: 0})},
    'react-native-reanimated': {default: {View: 'AnimatedView'}, useAnimatedStyle: (fn: () => unknown) => fn(), useSharedValue: (value: unknown) => ({value}), withTiming: (value: unknown) => value},
    '../../../../../packages/i18n/src': {defaultI18n: {t: (id: string) => id, number: (value: number) => String(value), has: () => true}},
    '../../../../../packages/client-core/src/presentation/kit-model': {browseToolbarModel: () => ({groups: [], applied: [], quick: [], sorts: [], sort: {field: 'title', direction: 'asc'}})},
    '../../../../../packages/client-core/src/presentation/library-tabs': {libraryTabs: () => []},
    '../../../../../packages/client-core/src/presentation/server-text': {serverTextLabel: () => ''},
    '../../kit/cards': {PosterCard: 'PosterCard', SquareCard: 'SquareCard'},
    '../../kit/artwork': {AmbientArt: 'AmbientArt'},
    '../../kit/controls': {Focusable: 'Focusable', Button: 'Button'},
    '../../kit/focus': {FocusRegion: 'FocusRegion', useFocusRegistry: () => ({})},
    '../../kit/browse': {LibraryHeader: 'LibraryHeader', LibraryMenu: 'LibraryMenu', LibrarySwitcher: 'LibrarySwitcher', StickyBrowseHeader: 'StickyBrowseHeader', ViewToggle: 'ViewToggle'},
    '../../kit/overlays': {Menu: 'Menu'},
    '../../kit/browse/presentation': {alpha, browseType: (used: any, size: number, weight = 600, tracking = 0) => ({fontSize: size * used.textScale, fontWeight: weight, letterSpacing: tracking * size})},
    '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/layout': {WindowedGrid: 'WindowedGrid', AlphabetRail: 'AlphabetRail'},
    '../../kit/states': {StateView: 'StateView'},
    '../../kit/theme': {useTheme: () => theme},
    '../../kit/useMotion': {useMotion: () => ({transforms: false, timing: () => ({})})},
    '../../platform/native-blur': {BlurView: 'BlurView', glassRecipe: () => ({nativeBlur: false, blurAmount: 0})},
    '../home/model': {homeCardText: () => ({caption: undefined})},
    '../destinations/focus': {createDestinationEntryFocus: () => ({}), nativeDestinationFocusIds: () => ({rail: 'rail', libraryTabs: (id: string) => `tabs:${id}`, libraryToolbar: (id: string) => `toolbar:${id}`, libraryCard: (id: string, key: string) => `card:${id}:${key}`})},
    '../destinations/useEntryFocus': {useDestinationEntryFocus: () => {}},
    './model': {NativeLibraryDestination: 'NativeLibraryDestination', nativeLibraryEntryKey: (entry: any) => entry.id, nativeLibraryCanSave: () => true},
    './LibraryToolbar': {LibraryToolbar: 'LibraryToolbar'}, './LibraryListRow': {LibraryListRow: 'LibraryListRow'},
    './directory': {NativeLibraryDirectory: 'NativeLibraryDirectory'},
    './LibraryFilters': {LibraryFilters: 'LibraryFilters'},
    './applied-filters': {libraryAppliedFilters: () => []},
    './library-grid': {libraryTabletGridGeometry},
    '../destinations/music/MusicMixesRow': {MusicMixesRow: 'MusicMixesRow'},
    '../destinations/music/TVMusicDiscover': {TVMusicDiscover: 'TVMusicDiscover'},
    '../read/platform': {hiddenReadingLibraryOnTV, isReadingLibraryKind},
  };
  const jumpSheet = await screenModule(new URL('../src-next/screens/library/LibraryJumpSheet.tsx', import.meta.url), modules);
  const module = await screenModule(new URL('../src-next/screens/library/LibraryScreen.tsx', import.meta.url), {
    ...modules, './LibraryJumpSheet': jumpSheet, './jump': libraryJump,
    '../../platform/home-action-diagnostics': {homeActionDiagnostics},
  });
  return {theme, module, host};
}

test('a library page renders with no selection port and routes the supplied tablet Select action', async () => {
  for (const width of [390, 1180]) {
    const {module, host} = await libraryScreen(width);
    let starts = 0;
    const selection = width >= 1024 ? {start: () => {starts++;}} : undefined;
    const library = {id: 'movies', name: 'Movies', kind: 'movie'};
    const state = {phase: 'loading', library, tab: {id: 'movies'}, predicates: []};
    const props = {destination: {getSnapshot: () => state, subscribe: () => () => {}},
      runtime: {getSnapshot: () => ({authority: {}}), libraryMenu: () => ({owner: false, onEditPins: () => {}})},
      activation: {getSnapshot: () => ({visible: true, revision: 1, intent: 'enter'}), subscribe: () => () => {}},
      directory: {getSnapshot: () => ({phase: 'ready', libraries: []}), subscribe: () => () => {}},
      libraries: [library], actions: {}, labels: {}, selection};
    const tree = host.render(() => module.LibraryScreen(props));
    assert.ok(elements(tree).some(node => node.props.testID === 'native-library-movies'));
    if (selection) {
      const header = elements(tree).find(node => node.type === module.LibraryExpandedHeader);
      const button = header?.props.selection;
      assert.equal(button?.props.testID, 'library-select-header');
      assert.equal(button.props.onPress, selection.start);
      button.props.onPress();
      assert.equal(starts, 1);
    }
  }
});

test('the wash is drawn only for the Listen and Read libraries', async () => {
  const {module} = await libraryScreen(390);
  for (const kind of ['movie', 'tv', 'anime', 'collection']) assert.equal(module.libraryWashKind(kind), false, `${kind} stays flat`);
  for (const kind of ['music', 'audiobook', 'book', 'comic']) assert.equal(module.libraryWashKind(kind), true, `${kind} draws the wash`);
  assert.equal(module.libraryWashKind('books'), false, 'the legacy spelling is not a Read kind (shared isReadingLibraryKind)');
});

test('the phone compact header is one 44 row with the drawn back control and a screen-centred switcher', async () => {
  const {module, theme} = await libraryScreen(390);
  const calls: string[] = [];
  const tree = module.LibraryCompactHeader({switcher: 'SWITCHER', menu: 'MENU', children: 'PIVOTS', onLibraries: () => calls.push('libraries')});
  const nodes = elements(tree), root = flatten(nodes[0].props.style);
  assert.equal(root.paddingTop, 47, 'the header starts below the actual safe area');
  assert.equal(root.borderBottomWidth, 1);
  assert.equal(root.backgroundColor, alpha(theme.colors.ink, .84), 'a flat library keeps the .84 ink row');
  assert.equal(root.zIndex, theme.layers.sticky);
  const row = nodes.find(node => flatten(node.props.style).height === 44 && flatten(node.props.style).paddingLeft === 12);
  assert.ok(row, 'the compact row is 44 high with the drawn 12/10 padding');
  assert.equal(flatten(row!.props.style).paddingRight, 10);
  const back = nodes.find(node => node.type === 'Focusable' && node.props.accessibilityLabel === 'next.browse.native.libraries');
  assert.deepEqual(flatten(back!.props.style), {height: 38, marginLeft: -4, paddingRight: 6, justifyContent: 'center'});
  assert.equal(nodes.find(node => node.type === 'Icon')?.props.name, 'i-left');
  assert.equal(nodes.find(node => node.type === 'Icon')?.props.size, 22);
  back!.props.onPress();
  assert.deepEqual(calls, ['libraries']);
  const centre = nodes.find(node => flatten(node.props.style).left === 118 && flatten(node.props.style).right === 118);
  assert.ok(centre, 'the switcher is centred on the screen itself');
  assert.equal(flatten(centre!.props.style).alignItems, 'center');
  assert.deepEqual(elements(centre!.props.children)[0].props.children, ['SWITCHER']);
  assert.deepEqual(nodes.find(node => flatten(node.props.style).marginLeft === 'auto')!.props.children[0], 'MENU');
  assert.equal(tree.props.children.at(-1), 'PIVOTS', 'the pivot strip follows the row');

  const washed = flatten(module.LibraryCompactHeader({switcher: 'S', menu: 'M', wash: true, onLibraries: () => {}}).props.style);
  assert.equal(washed.backgroundColor, alpha(theme.colors.ink, .62), 'the Listen/Read wash tints the row .62');
});

test('the phone pivot strip scrolls with the drawn gap while TV keeps its drawn row', async () => {
  const {module, theme} = await libraryScreen(390);
  const items = [{id: 'discover', label: 'library.tab.discover'}, {id: 'browse', label: 'library.tab.artists'}, {id: 'genres', label: 'library.tab.genres'}];
  const calls: string[] = [];
  const phone = elements(module.LibraryTabs({items, selected: 'discover', enabled: true, regionId: 'tabs', leftEdge: 'rail', phone: true, onSelect: (id: string) => calls.push(id)}));
  const strip = phone.find(node => node.type === 'ScrollView');
  assert.ok(strip, 'the phone strip scrolls so Music’s six pivots stay reachable');
  assert.equal(strip!.props.horizontal, true);
  assert.equal(strip!.props.showsHorizontalScrollIndicator, false);
  assert.deepEqual(strip!.props.contentContainerStyle, {paddingHorizontal: 20, gap: 24});
  const tabs = phone.filter(node => node.type === 'Focusable');
  assert.deepEqual(tabs.map(tab => flatten(tab.props.style).height), [46, 46, 46]);
  assert.deepEqual(tabs.map(tab => tab.props.accessibilityState.selected), [true, false, false]);
  assert.deepEqual(tabs.map(tab => tab.props.disabled), [false, false, false]);
  const underline = elements(tabs[0].props.children).find(node => node.type === 'View' && flatten(node.props.style).height === 3);
  assert.ok(underline, 'the selected tab keeps the drawn 3px underline');
  assert.equal(flatten(underline!.props.style).backgroundColor, theme.colors.accent);
  assert.equal(flatten(underline!.props.style).borderRadius, 3);
  assert.equal(elements(tabs[1].props.children).some(node => flatten(node.props.style).height === 3), false);
  tabs[1].props.onPress();
  assert.deepEqual(calls, ['browse']);

  const tvModule = await libraryScreen(1920, true);
  const tv = elements(tvModule.module.LibraryTabs({items, selected: 'browse', enabled: true, regionId: 'tabs', leftEdge: 'rail', phone: false, onSelect: () => {}, onFocusTab: (id: string) => calls.push(`focus:${id}`)}));
  assert.equal(tv.some(node => node.type === 'ScrollView'), false, 'TV keeps one drawn row');
  const region = tv.find(node => node.type === 'FocusRegion');
  assert.deepEqual(flatten(region!.props.style), {flexDirection: 'row', gap: 32, paddingHorizontal: 0});
  const tvTabs = tv.filter(node => node.type === 'Focusable');
  assert.equal(flatten(tvTabs[0].props.style).height, 64);
  assert.equal(flatten(tvTabs[1].props.style).borderBottomWidth, 4, 'TV keeps its accepted underline');
  assert.equal(flatten(tvTabs[1].props.style).borderBottomColor, tvModule.theme.colors.accentStrong);
  tvTabs[2].props.onFocus();
  assert.deepEqual(calls, ['browse', 'focus:genres']);
});

test('the result count has its own 10/20 row on phone and the TV size elsewhere', async () => {
  const {module, theme} = await libraryScreen(390);
  const phone = elements(module.LibraryResultCount({phone: true, children: '19 movies'}));
  const text = phone[0];
  assert.equal(text.type, 'Text');
  assert.equal(text.props.accessibilityLiveRegion, 'polite');
  assert.deepEqual(text.props.children, ['19 movies']);
  const style = flatten(text.props.style);
  assert.equal(style.fontSize, 13);
  assert.equal(style.fontWeight, 600);
  assert.equal(style.color, theme.colors.textTertiary);
  assert.equal(style.paddingHorizontal, 20);
  assert.equal(style.paddingTop, 10);
  assert.equal(style.paddingBottom, 10);
  const tvModule = await libraryScreen(1920, true);
  const tv = flatten(elements(tvModule.module.LibraryResultCount({phone: false, children: '19 titles'}))[0].props.style);
  assert.equal(tv.fontSize, 22);
  assert.equal(tv.paddingHorizontal, undefined, 'TV keeps the count inside the toolbar row');
});

test('the phone sort chip uses the drawn chip geometry and TV keeps its control', async () => {
  const sorts = [{id: 'title', directions: ['asc', 'desc'], defaultDirection: 'asc'}];
  const render = async (width: number, isTV = false) => {
    const host = hooks(), theme = createTheme({width, isTV});
    const module = await screenModule(new URL('../src-next/screens/library/LibrarySortMenu.tsx', import.meta.url), {
      react: host.react, 'react-native': {ScrollView: 'ScrollView', Text: 'Text', View: 'View'},
      '../../../../../packages/i18n/src': {defaultI18n: {t: (id: string) => id}},
      '../../../../../packages/client-core/src/presentation/browse-toolbar': {sortDirectionKind: () => 'title'},
      '../../kit/controls': {Focusable: 'Focusable', Segmented: 'Segmented'}, '../../kit/overlays': {MenuRow: 'MenuRow', Popover: 'Popover'},
      '../../kit/Icon': {Icon: 'Icon'}, '../../kit/browse/presentation': {alpha, browseType: (used: any, size: number, weight = 600) => ({fontSize: size * used.textScale, fontWeight: weight})},
      '../../kit/theme': {useTheme: () => theme},
    });
    const tree = module.LibrarySortMenu({sorts, value: {field: 'title', direction: 'asc'}, label: (sort: any) => sort.id, onValueChange: () => {}, onReshuffle: () => {}});
    return {theme, chip: elements(tree).find(node => node.type === 'Focusable')};
  };
  const phone = await render(390);
  const chip = flatten(phone.chip!.props.style);
  assert.equal(chip.height, 34);
  assert.equal(chip.borderRadius, 9);
  assert.equal(chip.paddingHorizontal, 13);
  assert.equal(chip.gap, 6);
  const icon = elements(phone.chip!.props.children).find(node => node.type === 'Icon');
  assert.equal(icon!.props.size, 17);
  assert.equal(elements(phone.chip!.props.children).find(node => node.type === 'Text')?.props.style[0].fontSize, 13.5);
  const tv = await render(1920, true);
  const tvChip = flatten(tv.chip!.props.style);
  assert.equal(tvChip.height, 64);
  assert.equal(tvChip.borderRadius, 14);
  assert.equal(tvChip.paddingHorizontal, 26);
  assert.equal(elements(tv.chip!.props.children).find(node => node.type === 'Icon')!.props.size, 26);
});

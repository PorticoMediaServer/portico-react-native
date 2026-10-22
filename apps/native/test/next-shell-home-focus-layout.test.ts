import {homeActionDiagnostics} from '../src-next/platform/home-action-diagnostics.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createFocusRegistry} from '../src-next/kit/focus/registry';
import {tvFocusIds, tvHomeRegionMap} from '../src-next/shell/tv-focus';
import {NativeHomePaging} from '../src-next/shell/home-paging';
import {tvHomeRows} from '../src-next/screens/home/tv-presentation';
import {createTheme} from '../src-next/kit/theme';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : node?.props ? [node, ...descendants(node.props.children)] : [];

test('initial TV focus reanchors when the compact hero measurement arrives and ignores inactive or foreign layout', async () => {
  const registry = createFocusRegistry();
  const h = hooks(), frames: FrameRequestCallback[] = [], anchors: number[][] = [];
  const previousFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => {frames.push(callback); return frames.length;};
  try {
    const entry = {id: 'episode', title: 'Actual episode', kind: 'episode', libraryId: 'tv'};
    const row = {id: 'continue', kind: 'continue', artworkShape: 'landscape', entries: [entry]};
    const document = {rows: [row], spotlight: []}, authority = {serverId: 'actual'};
    let currentAuthority = authority;
    const vertical = {scrollRef: {}, offset: {value: 146}, repeating: false, stop() {}, move() {}, anchor: (...args: number[]) => anchors.push(args)};
    const runtime = {home: {subscribe() {}, getSnapshot: () => ({document, phase: 'ready'})},
      getSnapshot: () => ({authority: currentAuthority, libraries: [], selectionActive: false}), selection: () => ({}), text: {}};
    const {HomeScreen} = await screenModule(new URL('../src-next/screens/home/HomeScreen.tsx', import.meta.url), {
      react: h.react,
      'react-native': {AppState: {currentState: 'active'}, RefreshControl: 'RefreshControl', Text: 'Text', View: 'View', useWindowDimensions: () => ({width: 1920, height: 1080})},
      'react-native-reanimated': {default: {ScrollView: 'ScrollView'}, runOnJS: (fn: unknown) => fn, useAnimatedScrollHandler: (fn: unknown) => fn},
      '../../../../../packages/i18n/src': {defaultI18n: {t: (key: string) => key}},
      '../../../../../packages/client-core/src/presentation/home-spotlight': {homeRowPresentation: () => ({cards: [{entry}], title: 'Continue'}), homeSpotlightModels: () => [], homeTitleFactParts: () => []},
      '../../../../../packages/client-core/src/home-selection': {homeEntryCapabilities: () => ({playable: true, details: true, watchlisted: false})},
      '../../../../../packages/client-core/src/presentation/server-text': {serverTextLabel: (_: unknown, text: string) => text},
      '../../../../../packages/client-core/src/presentation/kit-model': {},
      '../../platform/ArtworkPipeline': {}, '../../kit/artwork': {}, '../../kit/controls': {Button: 'Button'}, '../../kit/cards': {},
      '../../kit/focus': {FocusItem: 'FocusItem', FocusRegion: 'FocusRegion', useFocusRegistry: () => registry},
      '../../shell/tv-focus': {tvFocusIds, tvHomeRegionMap}, './tv-presentation': {tvHomeRows}, '../../shell/home-paging': {NativeHomePaging},
      '../../kit/layout': {Row: 'Row', Hero: 'Hero', FocusPreviewHero: 'FocusPreviewHero'},
      '../../kit/layout/FocusAnchor': {useFocusAnchor: () => vertical}, '../../kit/layout/types': {}, '../../kit/states': {},
      '../../platform/home-action-diagnostics': {homeActionDiagnostics}, '../../kit/theme': {useTheme: () => createTheme({isTV: true, width: 1920})}, '../../shell/model': {sameAuthority: (a: unknown, b: unknown) => a === b},
      './HomeHeroFacts': {}, './model': {authorizedHome: (value: unknown) => value, platformRows: () => [row], initialHomeFocus: () => ({rowId: row.id, entryId: entry.id}), homeCardText: () => ({title: entry.title}), homePlayTarget: () => entry},
    });
    const render = (props = {}) => h.render(() => HomeScreen({runtime, authority, ...props}));
    const rowBox = (tree: any) => descendants(tree).find(node => node.type === 'View' && node.props.onLayout);
    let tree = render();
    const hero = descendants(tree).find(node => node.type === 'Hero');
    const candidate = {entry, target: {...entry, playback: {itemId: entry.id}}};
    let actions = descendants(hero.props.renderActions(candidate)).filter(node => node.type === 'Button');
    const wrapper = hero.props.renderActions(candidate);
    const nativeRegion = wrapper.type(wrapper.props);
    assert.equal(nativeRegion.props.style?.flexDirection, 'row', 'real native guide lays out the actual controls horizontally');
    assert.equal(nativeRegion.props.style.gap, createTheme({isTV: true, width: 1920}).spec.hero.actions.gap.tv);
    assert.equal(nativeRegion.props.orientation, 'horizontal');
    assert.deepEqual(nativeRegion.props.order, ['play', 'my-list', 'details']);
    assert.equal(actions[0].props.hasTVPreferredFocus, undefined, 'entry is requested once after guide and target attach');
    const renderedRow = descendants(tree).find(node => node.type === 'Row');
    assert.equal(descendants(renderedRow.props.renderItem({entry}, {index: 0})).find(node => node.props.preferred !== undefined).props.preferred, false);
    actions[0].props.onFocus();
    tree = render();
    actions = descendants(descendants(tree).find(node => node.type === 'Hero').props.renderActions(candidate)).filter(node => node.type === 'Button');
    assert.equal(actions[0].props.hasTVPreferredFocus, undefined, 'late content cannot reissue preferred focus after entry');
    rowBox(tree).props.onLayout({nativeEvent: {layout: {y: 820, height: 300}}});
    descendants(tree).find(node => node.type === 'Row').props.onItemFocus({entry});
    frames.shift()!(0); // Focus may see the old, expanded hero box.
    assert.equal(anchors.at(-1)?.[0], 820);
    tree = render();
    assert.ok(descendants(tree).some(node => node.type === 'Hero'), 'spotlight controls stay mounted as the native Up destination');
    assert.ok(descendants(tree).some(node => node.type === 'FocusPreviewHero'));
    rowBox(tree).props.onLayout({nativeEvent: {layout: {y: 588, height: 300}}});
    assert.deepEqual(anchors.at(-1), [588, 300, 1080, 1080, 588, 96]);
    const count = anchors.length;
    for (const props of [{railExpanded: true}, {active: false}]) rowBox(render(props)).props.onLayout({nativeEvent: {layout: {y: 820, height: 300}}});
    currentAuthority = {serverId: 'foreign'};
    rowBox(render()).props.onLayout({nativeEvent: {layout: {y: 588, height: 300}}});
    assert.equal(anchors.length, count, 'rail, hidden Home and stale authorities cannot move the focused page');
  } finally {globalThis.requestAnimationFrame = previousFrame;}
});

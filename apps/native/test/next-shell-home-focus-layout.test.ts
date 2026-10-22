import assert from 'node:assert/strict';
import test from 'node:test';
import {createTheme} from '../src-next/kit/theme';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : node?.props ? [node, ...descendants(node.props.children)] : [];

test('initial TV focus reanchors when the compact hero measurement arrives and ignores inactive or foreign layout', async () => {
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
      '../../../../../packages/client-core/src/home-selection': {},
      '../../../../../packages/client-core/src/presentation/server-text': {serverTextLabel: (_: unknown, text: string) => text},
      '../../../../../packages/client-core/src/presentation/kit-model': {},
      '../../platform/ArtworkPipeline': {}, '../../kit/artwork': {}, '../../kit/controls': {Button: 'Button'}, '../../kit/cards': {},
      '../../kit/layout': {Row: 'Row', Hero: 'Hero', FocusPreviewHero: 'FocusPreviewHero'},
      '../../kit/layout/FocusAnchor': {useFocusAnchor: () => vertical}, '../../kit/layout/types': {}, '../../kit/states': {},
      '../../kit/theme': {useTheme: () => createTheme({isTV: true, width: 1920})}, '../../shell/model': {sameAuthority: (a: unknown, b: unknown) => a === b},
      './HomeHeroFacts': {}, './model': {authorizedHome: (value: unknown) => value, platformRows: () => [row], initialHomeFocus: () => ({rowId: row.id, entryId: entry.id}), homeCardText: () => ({title: entry.title}), homePlayTarget: () => entry},
    });
    const render = (props = {}) => h.render(() => HomeScreen({runtime, authority, ...props}));
    const rowBox = (tree: any) => descendants(tree).find(node => node.type === 'View' && node.props.onLayout);
    let tree = render();
    rowBox(tree).props.onLayout({nativeEvent: {layout: {y: 820, height: 300}}});
    descendants(tree).find(node => node.type === 'Row').props.onItemFocus({entry});
    frames.shift()!(0); // Focus may see the old, expanded hero box.
    assert.equal(anchors.at(-1)?.[0], 820);
    tree = render();
    rowBox(tree).props.onLayout({nativeEvent: {layout: {y: 588, height: 300}}});
    assert.deepEqual(anchors.at(-1), [588, 300, 1080, 1080, 588, 96]);
    const count = anchors.length;
    for (const props of [{railExpanded: true}, {active: false}]) rowBox(render(props)).props.onLayout({nativeEvent: {layout: {y: 820, height: 300}}});
    currentAuthority = {serverId: 'foreign'};
    rowBox(render()).props.onLayout({nativeEvent: {layout: {y: 588, height: 300}}});
    assert.equal(anchors.length, count, 'rail, hidden Home and stale authorities cannot move the focused page');
  } finally {globalThis.requestAnimationFrame = previousFrame;}
});

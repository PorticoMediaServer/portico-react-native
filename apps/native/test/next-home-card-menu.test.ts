import assert from 'node:assert/strict';
import test from 'node:test';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {HomeService} from '../../../packages/client-core/src/home-service';
import * as homePresentation from '../../../packages/client-core/src/presentation/home-spotlight';
import * as homeCapabilities from '../../../packages/client-core/src/home-selection';
import * as serverText from '../../../packages/client-core/src/presentation/server-text';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme} from '../src-next/kit/theme';
import {createFocusRegistry} from '../src-next/kit/focus/registry';
import {activateCard, holdCard} from '../src-next/kit/cards/model';
import {itemSelection} from '../src-next/kit/layout/types';
import * as shellModel from '../src-next/shell/model';
import * as tvFocus from '../src-next/shell/tv-focus';
import {NativeHomePaging} from '../src-next/shell/home-paging';
import {tvHomeRows} from '../src-next/screens/home/tv-presentation';
import * as homeModel from '../src-next/screens/home/model';
import {homeActionDiagnostics} from '../src-next/platform/home-action-diagnostics';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];

for (const tv of [false, true]) test(`actual ${tv ? 'TV' : 'phone'} Continue card retains its own menu anchor and primary action`, async () => {
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'fence'};
  let currentAuthority = authority, menuOpen = false;
  const entry = {id: 'episode', libraryId: 'television', kind: 'episode', title: 'Actual episode', available: true,
    navigation: {view: 'item', entityId: 'episode'}, playback: {itemId: 'episode'}, duration: 3600, progressSeconds: 300};
  const row = {id: 'continue', viewerFence: 'fence', title: 'Continue', kind: 'continue', artworkShape: 'landscape', entries: [entry],
    privacySensitivity: '', policyState: '', priority: 1, required: false, hideable: true, reorderable: true, critical: false, cursorCapable: false,
    total: 1, start: 0, limit: 20, hasMore: false, nextCursor: '', endpoint: '', revision: {catalog: 1, viewer: 1}};
  const home = new HomeService({request: async () => ({serverId: 'server', viewerFence: 'fence', rows: [row], spotlight: [],
    layout: {revision: 1, rowOrder: ['continue'], hiddenRowIds: []}, revision: {catalog: 1, viewer: 1}, generatedAt: '2026-10-23T12:00:00Z'})});
  await home.load();
  const h = hooks(), child = hooks(), registry = createFocusRegistry(), theme = createTheme({isTV: tv, width: tv ? 1920 : 390});
  let hookOwner = h;
  const react = {...h.react, useRef: (value: unknown) => hookOwner.react.useRef(value)};
  const calls: any[] = [], selection = {active: false, isSelected: () => false, onToggle: () => calls.push('toggle'), onEnter() {}, isMenuOpen: () => menuOpen};
  const runtime = {home, text: {t: defaultI18n.t, locale: 'en-US'}, getSnapshot: () => ({authority: currentAuthority, libraries: []}),
    actions: {navigate: (...args: any[]) => calls.push(['navigate', ...args]), play: (...args: any[]) => calls.push(['play', ...args]), more: (...args: any[]) => calls.push(['menu', ...args])},
    selection: () => selection, playback: {}, artwork() {}, ambient() {}};
  const {HomeScreen} = await screenModule(new URL('../src-next/screens/home/HomeScreen.tsx', import.meta.url), {
    react, 'react-native': {View: 'View', Text: 'Text', RefreshControl: 'RefreshControl', AppState: {currentState: 'active'}, useWindowDimensions: () => ({width: tv ? 1920 : 390, height: tv ? 1080 : 844})},
    'react-native-reanimated': {default: {ScrollView: 'ScrollView'}, runOnJS: (fn: unknown) => fn, useAnimatedScrollHandler: (fn: unknown) => fn},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/home-spotlight': homePresentation,
    '../../../../../packages/client-core/src/home-selection': homeCapabilities, '../../../../../packages/client-core/src/presentation/server-text': serverText,
    '../../../../../packages/client-core/src/presentation/kit-model': {}, '../../platform/ArtworkPipeline': {ArtworkPlacementContext: {Provider: 'ArtworkPlacement'}},
    '../../kit/artwork': {}, '../../kit/controls': {}, '../../kit/cards': {WideCard: 'WideCard'},
    '../../kit/focus': {useFocusRegistry: () => registry}, '../../shell/tv-focus': tvFocus, '../../shell/home-paging': {NativeHomePaging}, './tv-presentation': {tvHomeRows},
    '../../kit/layout': {Row: 'Row', Hero: 'Hero'}, '../../kit/layout/types': {itemSelection},
    '../../kit/layout/FocusAnchor': {useFocusAnchor: () => ({offset: {value: 0}, scrollRef: {current: null}})},
    '../../kit/states': {}, '../../kit/theme': {useTheme: () => theme}, '../../platform/home-action-diagnostics': {homeActionDiagnostics}, '../../shell/model': shellModel,
    './HomeHeroFacts': {}, './model': homeModel,
  });
  try {
    const tree = h.render(() => HomeScreen({runtime, authority}));
    const rowElement = nodes(tree).find(node => node.type === 'Row');
    const actual = home.getSnapshot().document!.rows[0].entries[0];
    const element = rowElement.props.renderItem({entry: actual}, {index: 0, selection: itemSelection(selection, actual.id)});
    // The parent and real private card have separate retained hook hosts.
    const renderCard = () => {hookOwner = child; return child.render(() => element.type(element.props));};
    const card = nodes(renderCard()).find(node => node.type === 'WideCard');
    activateCard(card.props);
    assert.equal(calls[0][0], tv ? 'play' : 'navigate', 'touch opens the title; TV retains resume');
    const nativeHost = {actual: 'native-card'};
    card.props.menuAnchorRef.current = nativeHost;
    holdCard(card.props, tv);
    assert.deepEqual(calls.at(-1), ['menu', actual, 'continue', card.props.menuAnchorRef]);
    menuOpen = true;
    const reopened = nodes(renderCard()).find(node => node.type === 'WideCard');
    assert.equal(reopened.props.menuAnchorRef, card.props.menuAnchorRef);
    assert.equal(reopened.props.moreExpanded, true);
    assert.equal(reopened.props.menuAnchorRef.current, nativeHost);
    selection.active = true;
    holdCard(reopened.props, false);
    assert.equal(calls.at(-1), 'toggle', 'active touch selection keeps its real action');
    currentAuthority = {...authority, epoch: 'retired'};
    const count = calls.length;
    reopened.props.onMore();
    reopened.props.onNavigate();
    assert.equal(calls.length, count, 'retired Home callbacks cannot open a menu or title');
  } finally {home.dispose();}
});

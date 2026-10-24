import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {homeRowPresentation} from '../../../packages/client-core/src/presentation/home-spotlight';
import type {ContentEntry} from '../../../packages/client-core/src/library-content';
import {createFocusRegistry} from '../src-next/kit/focus/registry';
import {createTheme, fontFamilies} from '../src-next/kit/theme';
import {tvFocusIds, tvHomeRegionMap} from '../src-next/shell/tv-focus';
import {NativeHomePaging} from '../src-next/shell/home-paging';
import {tvHomeRows} from '../src-next/screens/home/tv-presentation';
import * as nativeHome from '../src-next/screens/home/native-home-r46';
import {homeHeroBlock, homeRowSpacing, homeRowSubtitle} from '../src-next/screens/home/native-home-r46';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const {homeFactStrong, homeFactTag} = nativeHome;
const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : node?.props ? [node, ...descendants(node.props.children)] : [];
const labels = (node: any): string[] => Array.isArray(node) ? node.flatMap(labels) : typeof node === 'string' ? [node] : node?.props ? labels(node.props.children) : [];

const phoneTheme = createTheme({isTV: false, width: 390});
const tvTheme = createTheme({isTV: true, width: 1920});
const desktopTheme = createTheme({isTV: false, width: 1440});

test('phone Home rows take the drawn 28 px rhythm while the hero keeps its own height', () => {
  assert.deepEqual(homeRowSpacing(phoneTheme), {marginTop: 28});
  assert.equal(homeHeroBlock(phoneTheme, 560, false), 560);
  assert.equal(homeRowSubtitle(phoneTheme).fontSize, 13, 'phone-app.html .phone .row-head .sub is 13 px');
  // Other platforms keep their shipped values.
  assert.deepEqual(homeRowSpacing(tvTheme), {marginBottom: 30});
  assert.deepEqual(homeRowSpacing(desktopTheme), {marginBottom: 18});
  assert.equal(homeHeroBlock(tvTheme, 1080, false), 820);
  assert.equal(homeHeroBlock(tvTheme, 1080, true), 588);
  assert.equal(homeHeroBlock(desktopTheme, 560, false), 520);
  assert.equal(homeRowSubtitle(tvTheme).fontSize, tvTheme.type.rowSubtitle.fontSize);
  assert.equal(homeRowSubtitle(desktopTheme).fontSize, desktopTheme.type.rowSubtitle.fontSize);
});

test('the drawn phone facts badge is 9 px padding, .28 border and a 700 year; TV paint is unchanged', async () => {
  const renderer = async () => {
    const theme = phoneTheme;
    return screenModule(new URL('../src-next/screens/home/HomeHeroFacts.tsx', import.meta.url), {
      react: {...React, default: React}, 'react-native': {View: 'View', Text: 'Text'},
      '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/theme': {useTheme: () => theme},
      './native-home-r46': nativeHome,
    });
  };
  const facts = [{id: 'year', text: '2001', role: 'value'}, {id: 'genres', text: 'Animation, Family', role: 'supplement'},
    {id: 'duration', text: '2 h 5 min', role: 'value'}];
  const phone = await renderer();
  const phoneTree = phone.HomeHeroFacts({facts});
  const phoneBadge = descendants(phoneTree).find(node => node.type === 'View' && node.props.style?.paddingHorizontal !== undefined);
  assert.deepEqual(phoneBadge.props.style, {paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderRadius: 6, borderColor: '#edf5fa47'});
  const phoneYear = descendants(phoneTree).find(node => node.type === 'Text' && labels(node)[0] === '2001');
  assert.equal(phoneYear.props.style[1].fontFamily, fontFamilies[700], 'kit.css .meta strong is 700');

  const theme = tvTheme;
  const tv = await screenModule(new URL('../src-next/screens/home/HomeHeroFacts.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {View: 'View', Text: 'Text'},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/theme': {useTheme: () => theme},
    './native-home-r46': nativeHome,
  });
  const tvTree = tv.HomeHeroFacts({facts});
  const tvBadge = descendants(tvTree).find(node => node.type === 'View' && node.props.style?.paddingHorizontal !== undefined);
  assert.deepEqual(tvBadge.props.style, {paddingHorizontal: 12, paddingVertical: 3, borderWidth: 1.5, borderRadius: 8, borderColor: '#edf5fa4D'});
  const tvYear = descendants(tvTree).find(node => node.type === 'Text' && labels(node)[0] === '2001');
  assert.equal(tvYear.props.style[1].fontFamily, tvTheme.type.bodyStrong.fontFamily);
  assert.equal(homeFactTag(tvTheme).paddingHorizontal, 12);
  assert.equal(homeFactStrong(tvTheme), tvTheme.type.bodyStrong.fontFamily);
});

async function phoneHome(rows: readonly any[]) {
  const h = hooks(), registry = createFocusRegistry(), authority = {serverId: 'actual', viewerFence: 'viewer'};
  const runtime = {
    home: {subscribe() {}, getSnapshot: () => ({document: {rows, spotlight: [], serverId: 'actual', viewerFence: 'viewer'}, phase: 'ready'}), more() {}, revalidate: async () => {}, retry: async () => {}},
    getSnapshot: () => ({authority: {serverId: 'actual', viewerFence: 'viewer'}, libraries: [], selectionActive: false}),
    selection: () => ({}), text: {t: defaultI18n.t, locale: 'en-US'}, registerScrollToTop: () => () => {},
    artwork: () => undefined, ambient: () => undefined, setHomeWindow() {}, playback: undefined,
    actions: {navigate() {}, play() {}, more() {}, seeAll() {}, customize() {}}, reportError() {}, onArtworkError() {},
    renderHomeEmpty: () => null, error: () => ({}),
  };
  const {HomeScreen} = await screenModule(new URL('../src-next/screens/home/HomeScreen.tsx', import.meta.url), {
    react: h.react,
    'react-native': {AppState: {currentState: 'active'}, RefreshControl: 'RefreshControl', Text: 'Text', View: 'View', useWindowDimensions: () => ({width: 390, height: 844})},
    'react-native-reanimated': {default: {ScrollView: 'ScrollView'}, runOnJS: (fn: unknown) => fn, useAnimatedScrollHandler: (fn: unknown) => fn},
    '../../../../../packages/i18n/src': {defaultI18n},
    '../../../../../packages/client-core/src/home': {},
    '../../../../../packages/client-core/src/library-content': {},
    '../../../../../packages/client-core/src/presentation/home-spotlight': {homeRowPresentation, homeSpotlightModels: () => [], homeTitleFactParts: () => []},
    '../../../../../packages/client-core/src/home-selection': {homeEntryCapabilities: () => ({playable: true, details: true, watchlisted: false})},
    '../../../../../packages/client-core/src/presentation/server-text': {serverTextLabel: (_: unknown, label: any, fallback = '') => typeof label === 'string' ? label : label?.fallback ?? fallback},
    '../../../../../packages/client-core/src/presentation/kit-model': {},
    '../../platform/ArtworkPipeline': {}, '../../kit/artwork': {AmbientArt: 'AmbientArt'}, '../../kit/controls': {Button: 'Button'},
    '../../kit/cards': {CollectionBanner: 'CollectionBanner', LiveCard: 'LiveCard', PosterCard: 'PosterCard', RankedCard: 'RankedCard', SquareCard: 'SquareCard', WideCard: 'WideCard'},
    '../../kit/focus': {FocusItem: 'FocusItem', FocusRegion: 'FocusRegion', useFocusRegistry: () => registry},
    '../../shell/tv-focus': {tvFocusIds, tvHomeRegionMap}, '../../shell/home-paging': {NativeHomePaging}, './tv-presentation': {tvHomeRows},
    '../../kit/layout': {Hero: 'Hero', FocusPreviewHero: 'FocusPreviewHero', Row: 'Row'},
    '../../kit/layout/FocusAnchor': {useFocusAnchor: () => ({scrollRef: {}, offset: {value: 0}, repeating: false, stop() {}, move() {}, anchor() {}})},
    '../../kit/layout/types': {itemSelection: () => ({})},
    '../../kit/states': {StateView: 'StateView', HomeSkeleton: 'HomeSkeleton', SkeletonBlock: 'SkeletonBlock'},
    '../../platform/home-action-diagnostics': {homeActionDiagnostics: {action() {}}},
    '../../kit/theme': {useTheme: () => phoneTheme}, '../../shell/model': {sameAuthority: (a: unknown, b: unknown) => a === b},
    './HomeHeroFacts': {HomeHeroFacts: 'HomeHeroFacts', HomeRemoteHint: 'HomeRemoteHint'},
    './native-home-r46': nativeHome,
    './model': {authorizedHome: (value: unknown) => value, platformRows: () => rows, homeCardText: () => ({title: 'x'}), homePlayTarget: () => undefined, pageAtVisibleEnd: () => false},
  });
  return h.render(() => HomeScreen({runtime, authority}));
}

test('phone Home wires the drawn row rhythm, the 13 px sub-line and the live row sub-line', async () => {
  const entry = {id: 'episode-1', title: 'The Last of Us', kind: 'episode', libraryId: 'tv', seasonNumber: 1, episodeNumber: 1, duration: 3840, progressSeconds: 845} as unknown as ContentEntry;
  const rows = [
    {id: 'continue', kind: 'continue', artworkShape: 'landscape', title: 'Continue Watching', subtitleText: {fallback: 'In progress'}, entries: [entry], nextCursor: '', total: 1, start: 0, limit: 1},
    {id: 'on_now', kind: 'live', artworkShape: 'landscape', title: 'On now', subtitleText: {fallback: 'Synthetic Live TV'}, entries: [], nextCursor: '', total: 0, start: 0, limit: 0,
      live: {observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), channels: []}},
  ];
  const tree = await phoneHome(rows);
  const wrappers = descendants(tree).filter(node => node.type === 'View' && node.props.onLayout);
  assert.equal(wrappers.length, 2);
  for (const wrapper of wrappers) assert.deepEqual(wrapper.props.style, {marginTop: 28}, 'phone-app.html .phone .row margin-top 28');
  assert.equal(descendants(tree).filter(node => node.type === 'View' && node.props.style?.height === 560).length, 1, 'hero block is the drawn 560 px');
  const row = descendants(tree).find(node => node.type === 'Row');
  assert.equal(row.props.subtitle.type, 'Text');
  assert.equal(row.props.subtitle.props.style[0].fontSize, 13);
  assert.deepEqual(labels(row.props.subtitle), ['In progress']);

  const liveElement = descendants(tree).find(node => typeof node.type === 'function' && node.props?.itemWidth === 244);
  assert.ok(liveElement, 'the live row keeps the drawn 244 px channel card');
  const liveRow = liveElement.type(liveElement.props);
  assert.deepEqual(labels(liveRow.props.subtitle), ['Synthetic Live TV']);
  assert.equal(liveRow.props.subtitle.props.style[0].fontSize, 13);
});

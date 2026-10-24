import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {homeRowPresentation} from '../../../packages/client-core/src/presentation/home-spotlight';
import type {ContentEntry} from '../../../packages/client-core/src/library-content';
import {createFocusRegistry} from '../src-next/kit/focus/registry';
import {createTheme} from '../src-next/kit/theme';
import {tvFocusIds, tvHomeRegionMap} from '../src-next/shell/tv-focus';
import {NativeHomePaging} from '../src-next/shell/home-paging';
import {tvHomeRows} from '../src-next/screens/home/tv-presentation';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : node?.props ? [node, ...descendants(node.props.children)] : [];
const labels = (node: any): string[] => Array.isArray(node) ? node.flatMap(labels) : typeof node === 'string' ? [node] : node?.props ? labels(node.props.children) : [];

const phoneTheme = createTheme({isTV: false, width: 390});
const tabletTheme = createTheme({isTV: false, width: 834});
const tvTheme = createTheme({isTV: true, width: 1920});
const desktopTheme = createTheme({isTV: false, width: 1440});

function factsModule(theme: typeof phoneTheme) {
  return screenModule(new URL('../src-next/screens/home/HomeHeroFacts.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {View: 'View', Text: 'Text'},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/theme': {useTheme: () => theme},
  });
}

test('phone Home rows take the drawn 28 px rhythm while the hero keeps its own height', async () => {
  const home = await homeModule(phoneTheme, []);
  assert.deepEqual(home.homeRowSpacing(phoneTheme), {marginTop: 28});
  assert.equal(home.homeHeroBlock(phoneTheme, 560, false), 560);
  assert.equal(home.homeRowSubtitle(phoneTheme).fontSize, 13, 'phone-app.html .phone .row-head .sub is 13 px');
  assert.equal(home.homeContentBottom(phoneTheme, 84), 96, 'kit.css .ph-scroll ends 96 px over the 84 px bar');
  // Other platforms keep their shipped values.
  assert.deepEqual(home.homeRowSpacing(tvTheme), {marginBottom: 30});
  assert.deepEqual(home.homeRowSpacing(desktopTheme), {marginBottom: 18});
  assert.equal(home.homeHeroBlock(tvTheme, 1080, false), 820);
  assert.equal(home.homeHeroBlock(tvTheme, 1080, true), 588);
  assert.equal(home.homeHeroBlock(desktopTheme, 560, false), 520);
  assert.equal(home.homeRowSubtitle(tvTheme).fontSize, tvTheme.type.rowSubtitle.fontSize);
  assert.equal(home.homeRowSubtitle(desktopTheme).fontSize, desktopTheme.type.rowSubtitle.fontSize);
  assert.equal(home.homeContentBottom(tvTheme, 0), 96);
  assert.equal(home.homeContentBottom(desktopTheme, 0), 24);
});

test('the drawn phone facts badge is 9 px padding, .28 border and a 700 year; TV paint is unchanged', async () => {
  const facts = [{id: 'year', text: '2001', role: 'value'}, {id: 'genres', text: 'Animation, Family', role: 'supplement'},
    {id: 'duration', text: '2 h 5 min', role: 'value'}];
  const phone = await factsModule(phoneTheme);
  const phoneTree = phone.HomeHeroFacts({facts});
  const phoneBadge = descendants(phoneTree).find(node => node.type === 'View' && node.props.style?.paddingHorizontal !== undefined);
  assert.deepEqual(phoneBadge.props.style, {paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderRadius: 6, borderColor: '#edf5fa47'});
  const phoneYear = descendants(phoneTree).find(node => node.type === 'Text' && labels(node)[0] === '2001');
  assert.equal(phoneYear.props.style[1].fontFamily, phoneTheme.type.rowHeading.fontFamily, 'kit.css .meta strong is 700');

  const tv = await factsModule(tvTheme);
  const tvTree = tv.HomeHeroFacts({facts});
  const tvBadge = descendants(tvTree).find(node => node.type === 'View' && node.props.style?.paddingHorizontal !== undefined);
  assert.deepEqual(tvBadge.props.style, {paddingHorizontal: 12, paddingVertical: 3, borderWidth: 1.5, borderRadius: 8, borderColor: '#edf5fa4D'});
  const tvYear = descendants(tvTree).find(node => node.type === 'Text' && labels(node)[0] === '2001');
  assert.equal(tvYear.props.style[1].fontFamily, tvTheme.type.bodyStrong.fontFamily);
  assert.equal(phone.homeFactTag(tvTheme).paddingHorizontal, 12);
  assert.equal(phone.homeFactStrong(tvTheme), tvTheme.type.bodyStrong.fontFamily);
  for (const theme of [tabletTheme, desktopTheme]) {
    const module = await factsModule(theme), tree = module.HomeHeroFacts({facts});
    const badge = descendants(tree).find(node => node.type === 'View' && node.props.style?.paddingHorizontal !== undefined);
    assert.deepEqual(badge.props.style, {paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: 6, borderColor: `${theme.colors.text}4D`});
    const year = descendants(tree).find(node => node.type === 'Text' && labels(node)[0] === '2001');
    assert.equal(year.props.style[1].fontFamily, theme.type.bodyStrong.fontFamily, 'non-phone year retains its existing face');
  }
});

async function homeModule(theme: typeof phoneTheme | (() => typeof phoneTheme), rows: readonly any[], react: any = {...React, default: React}, registry = createFocusRegistry()) {
  return screenModule(new URL('../src-next/screens/home/HomeScreen.tsx', import.meta.url), {
    react,
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
    '../../kit/theme': {useTheme: typeof theme === 'function' ? theme : () => theme}, '../../shell/model': {sameAuthority: (a: unknown, b: unknown) => a === b},
    './HomeHeroFacts': {HomeHeroFacts: 'HomeHeroFacts', HomeRemoteHint: 'HomeRemoteHint'},
    './model': {authorizedHome: (value: unknown) => value, platformRows: () => rows, homeCardText: () => ({title: 'x'}), homePlayTarget: () => undefined, pageAtVisibleEnd: () => false},
  });
}

test('phone Home wires the drawn row rhythm, the 13 px sub-line and the live row sub-line', async () => {
  const entry = {id: 'episode-1', title: 'The Last of Us', kind: 'episode', libraryId: 'tv', seasonNumber: 1, episodeNumber: 1, duration: 3840, progressSeconds: 845} as unknown as ContentEntry;
  const rows = [
    {id: 'continue', kind: 'continue', artworkShape: 'landscape', title: 'Continue Watching', subtitleText: {fallback: 'In progress'}, entries: [entry], nextCursor: '', total: 1, start: 0, limit: 1},
    {id: 'on_now', kind: 'live', artworkShape: 'landscape', title: 'On now', subtitleText: {fallback: 'Synthetic Live TV'}, entries: [], nextCursor: '', total: 0, start: 0, limit: 0,
      live: {observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), channels: []}},
  ];
  const h = hooks(), authority = {serverId: 'actual', viewerFence: 'viewer'};
  const runtime = {
    home: {subscribe() {}, getSnapshot: () => ({document: {rows, spotlight: [], serverId: 'actual', viewerFence: 'viewer'}, phase: 'ready'}), more() {}, revalidate: async () => {}, retry: async () => {}},
    getSnapshot: () => ({authority: {serverId: 'actual', viewerFence: 'viewer'}, libraries: [], selectionActive: false}),
    selection: () => ({}), text: {t: defaultI18n.t, locale: 'en-US'}, registerScrollToTop: () => () => {},
    artwork: () => undefined, ambient: () => undefined, setHomeWindow() {}, playback: undefined,
    actions: {navigate() {}, play() {}, more() {}, seeAll() {}, customize() {}}, reportError() {}, onArtworkError() {},
    renderHomeEmpty: () => null, error: () => ({}),
  };
  let currentTheme = phoneTheme;
  const {HomeScreen} = await homeModule(() => currentTheme, rows, h.react);
  const tree = h.render(() => HomeScreen({runtime, authority, bottomInset: 84}));
  const wrappers = descendants(tree).filter(node => node.type === 'View' && node.props.onLayout);
  assert.equal(wrappers.length, 2);
  for (const wrapper of wrappers) assert.deepEqual(wrapper.props.style, {marginTop: 28}, 'phone-app.html .phone .row margin-top 28');
  assert.equal(descendants(tree).filter(node => node.type === 'View' && node.props.style?.height === 560).length, 1, 'hero block is the drawn 560 px');
  const scroller = descendants(tree).find(node => node.type === 'ScrollView');
  assert.equal(scroller.props.contentContainerStyle.paddingBottom, 96, 'drawn end padding over the 84 px bar');
  const row = descendants(tree).find(node => node.type === 'Row');
  assert.equal(row.props.subtitle.type, 'Text');
  assert.equal(row.props.subtitle.props.style[0].fontSize, 13);
  assert.deepEqual(labels(row.props.subtitle), ['In progress']);

  const liveElement = descendants(tree).find(node => typeof node.type === 'function' && node.props?.itemWidth === 244);
  assert.ok(liveElement, 'the live row keeps the drawn 244 px channel card');
  const liveRow = liveElement.type(liveElement.props);
  assert.deepEqual(labels(liveRow.props.subtitle), ['Synthetic Live TV']);
  assert.equal(liveRow.props.subtitle.props.style[0].fontSize, 13);
  for (const theme of [tabletTheme, desktopTheme, tvTheme]) {
    currentTheme = theme;
    assert.equal(liveElement.type(liveElement.props).props.subtitle, undefined, `${theme.layoutMode} Live row retains no subtitle`);
  }
});

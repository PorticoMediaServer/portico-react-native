import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {defaultI18n, type I18n} from '../../../packages/i18n/src';
import {homeRowPresentation, homeSpotlightModels} from '../../../packages/client-core/src/presentation/home-spotlight';
import {homeRowHasContent} from '../src-next/screens/home/model';
import {serverTextLabel} from '../../../packages/client-core/src/presentation/server-text';
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
  assert.equal(tabletTheme.platform, 'tablet');
  assert.equal(tabletTheme.layoutMode, 'phone', 'tablet shares the shell mode, so mode alone cannot admit phone-only changes');
  assert.deepEqual(home.homeRowSpacing(tabletTheme), {marginTop: 26}, 'foldable.html .phone.md .row is 26 px above');
  assert.equal(home.homeHeroBlock(tabletTheme, 560, false), 560, 'the medium hero keeps the height its composition supplies');
  assert.equal(home.homeRowSubtitle(tabletTheme), tabletTheme.type.caption, 'foldable.html keeps the drawn 13 px sub-line');
  assert.equal(home.homeContentBottom(tabletTheme, 92), 132, 'foldable.html .md .ph-scroll keeps 40 px under the last row');
});

test('the medium window draws the two foldable hero compositions at their authored sizes', async () => {
  const home = await homeModule(phoneTheme, []);
  assert.equal(home.mediumHeroHeight(840, 880), 440, 'foldable.html frame 7: portrait hero is half the 880 window');
  assert.equal(home.mediumHeroHeight(880, 840), home.MEDIUM_SIDEWAYS_HERO, 'frame 3f authors 392 sideways');
  assert.equal(home.MEDIUM_SIDEWAYS_HERO, 392);
  assert.deepEqual(home.mediumCopySide(840, 880), {inset: 28, width: 300, bottom: 30});
  assert.deepEqual(home.mediumCopySide(880, 840), {inset: 28, width: 320, bottom: 30});
  assert.equal(home.mediumBackdropFraction(840, 880), 0.6);
  assert.equal(home.mediumBackdropFraction(880, 840), 0.66);
  const sideways = home.mediumLockupStyle(tabletTheme, 880, 840), upright = home.mediumLockupStyle(tabletTheme, 840, 880);
  assert.equal(sideways.fontSize, 50, 'frame 3f draws the sideways lockup at 50');
  assert.ok(Math.abs(sideways.lineHeight - 50 * (43.24 / 46)) < 1e-9, 'the line box keeps the handheld lockup ratio');
  assert.ok(Math.abs(sideways.letterSpacing - -0.045 * 50) < 1e-9, 'the tracking keeps the handheld lockup ratio');
  assert.equal(upright.fontSize, 42, 'frame 7 draws the upright lockup at 42');
  assert.equal(home.mediumCardWidth(false), 140);
  assert.equal(home.mediumCardWidth(true), 292);
  assert.deepEqual({...home.mediumCardType.title}, {fontSize: 14});
  assert.deepEqual({...home.mediumCardType.caption}, {fontSize: 12.5});
  assert.deepEqual({...home.mediumHeadingStyle}, {fontSize: 21});
});

test('a row with nothing under its heading is not drawn at all', async () => {
  const entry = {id: 'new-movie', libraryId: 'movies', kind: 'movie', title: 'Toy Story 5', playback: {itemId: 'new-movie'}};
  const rows = [
    {id: 'continue', kind: 'continue', artworkShape: 'landscape', title: 'Continue Watching', entries: [], nextCursor: ''},
    {id: 'new_movies', kind: 'new', artworkShape: 'poster', title: 'New on your server', entries: [entry], nextCursor: ''},
    {id: 'live_now', kind: 'live', artworkShape: 'landscape', title: 'On now', entries: [], live: {observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), channels: []}},
    {id: 'more', kind: 'new', artworkShape: 'poster', title: 'More coming', entries: [], nextCursor: 'page-2'},
  ];
  assert.equal(homeRowHasContent(rows[0]), false, 'a profile with no history keeps no Continue Watching heading');
  assert.equal(homeRowHasContent(rows[1]), true);
  assert.equal(homeRowHasContent(rows[2]), false, 'a live row with no channels draws no heading either');
  assert.equal(homeRowHasContent(rows[3]), false, 'a cursor alone draws nothing, so its heading goes too');
  const h = hooks(), authority = {serverId: 'actual', viewerFence: 'viewer'};
  const runtime = {
    home: {subscribe() {}, getSnapshot: () => ({document: {rows, spotlight: [], serverId: 'actual', viewerFence: 'viewer'}, phase: 'ready'}), more() {}, revalidate: async () => {}, retry: async () => {}},
    getSnapshot: () => ({authority, libraries: [], selectionActive: false}), selection: () => ({}), text: {t: defaultI18n.t, locale: 'en-US'},
    registerScrollToTop: () => () => {}, artwork: () => undefined, ambient: () => undefined, setHomeWindow() {}, playback: undefined,
    actions: {navigate() {}, play() {}, more() {}, seeAll() {}, customize() {}}, reportError() {}, onArtworkError() {}, renderHomeEmpty: () => null, error: () => ({}),
  };
  const {HomeScreen} = await homeModule(phoneTheme, rows, h.react);
  const tree = h.render(() => HomeScreen({runtime, authority, bottomInset: 84}));
  const drawn = descendants(tree).filter(node => node.type === 'Row');
  assert.deepEqual(drawn.map(node => node.props.title), ['New on your server']);
  assert.equal(labels(tree).includes('Continue Watching'), false);
  assert.equal(labels(tree).includes('On now'), false);
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
    '../../../../../packages/client-core/src/presentation/home-spotlight': {homeRowPresentation, homeSpotlightModels, homeTitleFactParts: () => []},
    '../../../../../packages/client-core/src/home-selection': {homeEntryCapabilities: () => ({playable: true, details: true, watchlisted: false})},
    '../../../../../packages/client-core/src/presentation/server-text': {serverTextLabel},
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
    './model': {authorizedHome: (value: unknown) => value, platformRows: () => rows, homeRowHasContent, homeCardText: () => ({title: 'x'}), homePlayTarget: () => undefined, pageAtVisibleEnd: () => false},
  });
}

test('phone Home wires the drawn row rhythm, the 13 px sub-line and the live row sub-line', async () => {
  const entry = {id: 'episode-1', title: 'The Last of Us', kind: 'episode', libraryId: 'tv', seasonNumber: 1, episodeNumber: 1, duration: 3840, progressSeconds: 845} as unknown as ContentEntry;
  const rows = [
    {id: 'continue', kind: 'continue', artworkShape: 'landscape', title: 'Continue Watching', subtitleText: {fallback: 'In progress'}, entries: [entry], nextCursor: '', total: 1, start: 0, limit: 1},
    {id: 'on_now', kind: 'live', artworkShape: 'landscape', title: 'On now', subtitleText: {fallback: 'Synthetic Live TV'}, entries: [], nextCursor: '', total: 0, start: 0, limit: 0,
      live: {observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), channels: [
        {channel: {id: 'channel-1', sourceId: 'source-1', name: 'Channel One', number: 1, mark: {}, programmes: []}, source: {name: 'Synthetic Live TV'}},
      ]}},
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


test('Home replaces server reason/action words when the confirmed translator changes without replacing the document or entries', async () => {
  const h = hooks(), authority = {serverId: 'actual', viewerFence: 'viewer'};
  const entry = {id: 'locale-movie', libraryId: 'movies', kind: 'movie', title: 'Stored source title (Full Cut)', playback: {itemId: 'locale-movie'}};
  const document = {rows: [], spotlight: [{entry, reason: {kind: 'featured', text: {code: 'next.home.play', fallback: 'Stored reason'}}}], serverId: 'actual', viewerFence: 'viewer'};
  const translated = (prefix: string): I18n['t'] => (key, values) => `${prefix}/${defaultI18n.t(key, values)}`;
  let current = translated('CA');
  const text = {get t() {return current;}, locale: 'en-US'};
  const runtime = {
    home: {subscribe() {}, getSnapshot: () => ({document, phase: 'ready'}), more() {}, revalidate: async () => {}, retry: async () => {}},
    getSnapshot: () => ({authority, libraries: [], selectionActive: false}), selection: () => ({}), text,
    registerScrollToTop: () => () => {}, artwork: () => undefined, ambient: () => undefined, setHomeWindow() {}, playback: undefined,
    actions: {navigate() {}, play() {}, more() {}, seeAll() {}, customize() {}}, reportError() {}, onArtworkError() {}, renderHomeEmpty: () => null, error: () => ({}),
  };
  const {HomeScreen} = await homeModule(phoneTheme, [], h.react);
  const render = () => h.render(() => HomeScreen({runtime, authority, bottomInset: 84}));
  const first = descendants(render()).find(node => node.type === 'Hero');
  assert.equal(first.props.candidates[0].reason, 'CA/Play');
  assert.equal(first.props.candidates[0].primaryLabel, 'CA/Play');
  current = translated('GB');
  const next = descendants(render()).find(node => node.type === 'Hero');
  assert.equal(next.props.candidates[0].reason, 'GB/Play');
  assert.equal(next.props.candidates[0].primaryLabel, 'GB/Play');
  assert.equal(next.props.candidates[0].entry, entry);
  assert.equal(runtime.home.getSnapshot().document, document);
});

test('TV Home passes the current runtime translator into the focused preview hint', async () => {
  const h = hooks(), frames: FrameRequestCallback[] = [], previousFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => {frames.push(callback); return frames.length;};
  try {
    const authority = {serverId: 'actual', viewerFence: 'viewer'};
    const entry = {id: 'resume-episode', libraryId: 'tv', kind: 'episode', title: 'Stored episode', playback: {itemId: 'resume-episode'}, progressSeconds: 120};
    const row = {id: 'continue', kind: 'continue', artworkShape: 'landscape', entries: [entry]};
    const document = {rows: [row], spotlight: [], serverId: 'actual', viewerFence: 'viewer'};
    const translated = (prefix: string): I18n['t'] => (key, values) => `${prefix}/${defaultI18n.t(key, values)}`;
    let current = translated('CA');
    const text = {get t() {return current;}, locale: 'en-US'};
    const runtime = {
      home: {subscribe() {}, getSnapshot: () => ({document, phase: 'ready'}), more() {}, revalidate: async () => {}, retry: async () => {}},
      getSnapshot: () => ({authority, libraries: [], selectionActive: false}), selection: () => ({}), text,
      registerScrollToTop: () => () => {}, artwork: () => undefined, ambient: () => undefined, setHomeWindow() {}, playback: undefined,
      actions: {navigate() {}, play() {}, more() {}, seeAll() {}, customize() {}}, reportError() {}, onArtworkError() {}, renderHomeEmpty: () => null, error: () => ({}),
    };
    const {HomeScreen} = await homeModule(tvTheme, [row], h.react);
    descendants(h.render(() => HomeScreen({runtime, authority}))).find(node => node.type === 'Row').props.onItemFocus({entry});
    current = translated('GB');
    const preview = descendants(h.render(() => HomeScreen({runtime, authority}))).find(node => node.type === 'FocusPreviewHero');
    assert.ok(preview, 'the focused TV row draws its preview hero');
    const candidate = {id: entry.id, title: entry.title, entry, target: {...entry, playback: {itemId: entry.id}, progressSeconds: 120}};
    const hint = preview.props.renderHint(candidate);
    assert.equal(hint.props.text, text, 'the drawn hint reads the runtime translator, not the module default');
    assert.equal(hint.props.text.t('next.home.resume'), `GB/${defaultI18n.t('next.home.resume')}`);
    assert.equal(hint.props.resume, true);
  } finally {globalThis.requestAnimationFrame = previousFrame;}
});

test('the actual TV Home keycap hint uses the supplied current translator without changing its native controls', async () => {
  const {HomeRemoteHint} = await factsModule(tvTheme);
  const t: I18n['t'] = (key, values) => `GB/${defaultI18n.t(key, values)}`;
  const view = HomeRemoteHint({resume: true, text: {t}});
  const words = labels(view);
  for (const key of ['next.layout.ok', 'next.layout.holdOk', 'next.home.resume', 'next.layout.moreOptions'] as const) assert.ok(words.includes(t(key)));
});

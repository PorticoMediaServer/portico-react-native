import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
import {playbackFence, sameFence} from '../../../packages/player-core/src/index.ts';
import {cardText, playbackIdentity, titleFactParts} from '../../../packages/client-core/src/presentation/kit-model/index.ts';
import {durationText} from '../../../packages/client-core/src/presentation/kit-model/text.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
const {NativeTitleScreen} = await screenModule(new URL('../src-next/screens/watch/TitleScreen.tsx', import.meta.url), {
  react: {...React, default: React}, 'react-native': {View: 'View', Text: 'Text', ScrollView: 'Scroll', useWindowDimensions: () => ({width: 390, height: 844})},
  '../../../../../packages/player-core/src': {sameFence}, '../../../../../packages/client-core/src/presentation/kit-model/text': {durationText},
  '../../../../../packages/client-core/src/presentation/kit-model': {cardText, playbackIdentity, titleFactParts}, '../../../../../packages/i18n/src': {defaultI18n},
  '../../kit/artwork': {AmbientArt: 'Ambient'}, '../../kit/cards': {EpisodeTile: 'Episode', PosterCard: 'Poster'},
  '../../kit/controls': {Button: 'Button', Chip: 'Chip', Tabs: 'Tabs'}, '../../kit/layout/Hero': {HeroMetadata: 'Facts'},
  '../../kit/states': {TitleSkeleton: 'Skeleton'}, './TitlePeople': {TitlePeople: 'TitlePeople'}, '../../kit/theme': {nativeType: () => ({}), useTheme: () => ({isTV: false, colors: {}, type: {bodyStrong: {}, body: {}, heading: {}, caption: {}}})},
});
const fence = playbackFence({kind: 'queue', playback: {scope: {serverId: 's', accountId: 'a', profileId: 'p', controllerId: 'c', controllerEpoch: 'e', commandLaneId: 'l', authority: 'local'}, run: 1}, sessionId: 'session', itemId: 'item', sourceId: 'v2', entryId: 'entry', generation: 3});
const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : React.isValidElement(node) ? [node, ...descendants((node as any).props.children)] : [];
test('upright body reuses real title memory and toggles only the existing exact session without a new Play', () => {
  const calls: unknown[] = [], entry = {id: 'item', kind: 'movie', title: 'The Hunger Games', displayTitle: 'The Hunger Games: Special Edition'};
  const snapshot = {retired: false, entry, place: {tab: 'details', anchor: {itemId: null, offset: 0}}, episodes: [],
    detail: {phase: 'ready', data: {item: entry, actions: [], personal: {}, metadata: {genres: [], ratings: [], credits: []}}}};
  const controller = {getSnapshot: () => snapshot, subscribe: () => () => {}, memory: {getSnapshot: () => snapshot.place}, open: async () => {}, play: () => {assert.fail('Watch body must not start playback');}};
  let source: any = {retired: false, fence, playback: {intent: 'playing', duration: 100, positionSeconds: 10}, capabilities: {play: true, pause: true}}, width = 390, tree: any;
  const playback = {getSnapshot: () => source, toggle: async (expected: unknown) => {calls.push(expected);}};
  const host = createHookHost(() => {tree = NativeTitleScreen({controller, text: {t: defaultI18n.t}, artwork: () => undefined, ambient: () => undefined,
    back: assert.fail, navigate: assert.fail, more: assert.fail, reportError: assert.fail, renderError: assert.fail, aboutLabel: 'About', watch: {source, width, playback}});});
  host.mount();
  try {
    assert.ok(descendants(tree).some(node => node.type === 'Text' && node.props.children === entry.displayTitle));
    assert.equal(descendants(tree).find(node => node.props.testID === 'watch-title-back'), undefined);
    const toggle = descendants(tree).find(node => node.props.testID === 'watch-body-toggle');
    toggle.props.onPress(); assert.deepEqual(calls, [fence]);
    width = 300; host.rerender(); assert.equal(controller.getSnapshot().place, snapshot.place);
    const old = source; source = {...source, fence: {...fence, generation: 4}};
    toggle.props.onPress(); assert.equal(calls.length, 1);
    source = old;
  } finally {host.unmount();}
});

test('title My List reads actual Detail actions and personal state after the first lazy read', async () => {
  const calls: unknown[] = [], entry = {id: 'item', kind: 'movie', title: 'Actual title'};
  let snapshot: any = {retired: false, entry, place: {tab: 'details', anchor: {itemId: null, offset: 0}}, episodes: [], detail: {phase: 'idle', data: null}}, tree: any;
  const controller = {getSnapshot: () => snapshot, subscribe: () => () => {}, memory: {getSnapshot: () => snapshot.place}, open: async () => {},
    personal: async (intent: unknown) => {calls.push(intent);}};
  const host = createHookHost(() => {tree = NativeTitleScreen({controller, text: {t: defaultI18n.t}, artwork: () => undefined, ambient: () => undefined,
    back: assert.fail, navigate: assert.fail, more: assert.fail, reportError: assert.fail, renderError: assert.fail, aboutLabel: 'About'});});
  host.mount();
  try {
    assert.equal(descendants(tree).some(node => node.props.accessibilityLabel === defaultI18n.t('entry.addToWatchlist')), false);
    snapshot = {...snapshot, detail: {phase: 'ready', data: {item: entry, actions: [{id: 'watchlist', enabled: true}], personal: {watchlisted: false}, metadata: {genres: [], ratings: [], credits: []}}}};
    host.rerender();
    descendants(tree).find(node => node.props.accessibilityLabel === defaultI18n.t('entry.addToWatchlist')).props.onPress();
    await Promise.resolve(); assert.deepEqual(calls, [{action: 'watchlist', value: true}]);
    snapshot = {...snapshot, detail: {...snapshot.detail, data: {...snapshot.detail.data, personal: {watchlisted: true}}}};
    host.rerender();
    assert.ok(descendants(tree).some(node => node.props.accessibilityLabel === defaultI18n.t('entry.removeFromWatchlist')));
  } finally {host.unmount();}
});

test('phone details draws the real cast and crew row, its credit lines and the in-progress remaining line', () => {
  const personCalls: string[] = [], entry = {id: 'item', kind: 'movie', title: 'Real film', duration: 5700, progressSeconds: 540};
  const snapshot = {retired: false, entry, place: {tab: 'details', anchor: {itemId: null, offset: 0}}, episodes: [],
    detail: {phase: 'ready', data: {item: entry, facts: {},
      actions: [{id: 'resume', enabled: true, playback: {itemId: entry.id, startSeconds: 540}}, {id: 'start_over', enabled: true, playback: {itemId: entry.id, startSeconds: 0}}],
      personal: {progressSeconds: 540, watched: false},
      metadata: {genres: [], ratings: [], status: 'available', credits: [
        {id: 'c1', name: 'Timothée Chalamet', role: 'Paul Atreides', department: 'acting', provider: 'tmdb', personId: 'p1'},
        {id: 'c2', name: 'Denis Villeneuve', role: 'Director', department: 'directing', provider: 'tmdb', personId: 'p2'}]}}}};
  const controller = {getSnapshot: () => snapshot, subscribe: () => () => {}, memory: {getSnapshot: () => snapshot.place}, open: async () => {}, play: async () => {}, personal: async () => {}};
  let tree: any;
  const host = createHookHost(() => {tree = NativeTitleScreen({controller, text: {t: defaultI18n.t}, artwork: () => undefined, ambient: () => undefined,
    back: assert.fail, navigate: assert.fail, more: assert.fail, reportError: assert.fail, renderError: assert.fail, aboutLabel: 'About', person: id => personCalls.push(id)});});
  host.mount();
  try {
    const people = descendants(tree).find(node => node.type === 'TitlePeople');
    assert.equal(people.props.credits.length, 2);
    people.props.onPerson('p1'); assert.deepEqual(personCalls, ['p1']);
    assert.ok(descendants(tree).some(node => node.type === 'Text' && node.props.children === defaultI18n.t('title.directedBy', {names: 'Denis Villeneuve'})));
    const remaining = defaultI18n.t('next.kit.remaining', {time: durationText(5160, defaultI18n.t)});
    assert.ok(descendants(tree).some(node => node.type === 'Text' && node.props.children === remaining));
    assert.ok(descendants(tree).some(node => node.type === 'Button' && node.props.icon === 'i-replay'));
  } finally {host.unmount();}
});

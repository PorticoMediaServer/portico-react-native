import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
import {sameFence} from '../../../packages/player-core/src/index.ts';
import {cardText, playbackIdentity, titleFactParts} from '../../../packages/client-core/src/presentation/kit-model/index.ts';
import {durationText} from '../../../packages/client-core/src/presentation/kit-model/text.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';

const {NativeTitleScreen} = await screenModule(new URL('../src-next/screens/watch/TitleScreen.tsx', import.meta.url), {
  react: {...React, default: React}, 'react-native': {View: 'View', Text: 'Text', ScrollView: 'Scroll', useWindowDimensions: () => ({width: 1920, height: 1080})},
  '../../../../../packages/player-core/src': {sameFence}, '../../../../../packages/client-core/src/presentation/kit-model/text': {durationText},
  '../../../../../packages/client-core/src/presentation/kit-model': {cardText, playbackIdentity, titleFactParts}, '../../../../../packages/i18n/src': {defaultI18n},
  '../../kit/artwork': {AmbientArt: 'Ambient'}, '../../kit/cards': {EpisodeTile: 'Episode', PosterCard: 'Poster'},
  '../../kit/controls': {Button: 'Button', ResumeButton: 'Resume', Chip: 'Chip', Tabs: 'Tabs'}, '../../kit/layout/Hero': {HeroMetadata: 'Facts'},
  '../../kit/states': {TitleSkeleton: 'Skeleton'}, '../../kit/theme': {nativeType: () => ({}), useTheme: () => ({isTV: true, colors: {}, type: {bodyStrong: {}, body: {}, heading: {}, caption: {}}})},
});
const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : React.isValidElement(node) ? [node, ...descendants((node as any).props.children)] : [];

test('TV title resume, Start over, watched and Play menu bind actual current title actions and the genuine anchor', async () => {
  const calls: unknown[][] = [], entry = {id: 'inside-out', kind: 'movie', title: 'Inside Out', duration: 5700, progressSeconds: 540};
  let snapshot: any = {retired: false, entry, place: {tab: 'related', anchor: {itemId: null, offset: 0}}, episodes: [],
    detail: {phase: 'ready', data: {item: entry, actions: [
      {id: 'resume', enabled: true, playback: {itemId: entry.id, startSeconds: 540}},
      {id: 'start_over', enabled: true, playback: {itemId: entry.id, startSeconds: 0}},
      {id: 'watched', enabled: true},
    ], personal: {progressSeconds: 540, watched: false}, metadata: {genres: [], ratings: [], credits: []}}}};
  const controller = {getSnapshot: () => snapshot, subscribe: () => () => {}, memory: {getSnapshot: () => snapshot.place}, open: async () => {},
    play: async (...args: unknown[]) => {calls.push(['play', ...args]);}, personal: async (...args: unknown[]) => {calls.push(['personal', ...args]);}};
  let tree: any;
  const host = createHookHost(() => {tree = NativeTitleScreen({controller, text: {t: defaultI18n.t}, artwork: () => undefined, ambient: () => undefined,
    back: assert.fail, navigate: assert.fail, more: (...args: unknown[]) => {calls.push(['more', ...args]);}, reportError: assert.fail, renderError: assert.fail, aboutLabel: 'About'});});
  host.mount();
  try {
    const resume = descendants(tree).find(node => node.props.testID === 'watch-title-play');
    assert.equal(resume.type, 'Resume'); assert.equal(resume.props.progress, 540 / 5700);
    assert.equal(resume.props.remaining, defaultI18n.t('next.kit.remaining', {time: durationText(5160, defaultI18n.t)}));
    const anchor = resume.props.ref; anchor.current = {nativeTag: 72}; resume.props.onLongPressAction();
    assert.deepEqual(calls.shift(), ['more', entry, anchor]);
    await descendants(tree).find(node => node.props.focusId === 'watch-title-start-over').props.onPress();
    assert.deepEqual(calls.shift(), ['play', entry, true]);
    const watched = descendants(tree).find(node => node.props.focusId === 'watch-title-watched');
    assert.equal(watched.props.accessibilityLabel, defaultI18n.t('entry.markWatched')); watched.props.onPress();
    assert.deepEqual(calls.shift(), ['personal', {action: 'watched', value: true}]);
    snapshot = {...snapshot, detail: {...snapshot.detail, data: {...snapshot.detail.data, actions: snapshot.detail.data.actions.filter((action: any) => action.id === 'resume')}}};
    host.rerender();
    assert.equal(descendants(tree).some(node => node.props.focusId === 'watch-title-watched' || node.props.focusId === 'watch-title-start-over'), false);
  } finally {host.unmount();}
});

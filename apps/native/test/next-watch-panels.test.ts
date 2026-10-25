import {subtitleReason} from '../../../packages/client-core/src/subtitles.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {act, createHookHost} from './hook-driver.ts';
import {playbackFence, sameFence} from '../../../packages/player-core/src/index.ts';
import {parseOptions} from '../../../packages/client-core/src/playback-v1/types.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {nativeWatchTracks} from '../src-next/screens/watch/track-identity.ts';
import {nativeWatchPanelRows} from '../src-next/screens/watch/panel-model.ts';
import {nativeWatchSubtitleTiming} from '../src-next/screens/watch/subtitle-timing.ts';
let isTV = false;
const {NativeWatchPanels} = await screenModule(new URL('../src-next/screens/watch/WatchPanels.tsx', import.meta.url), {
  react: {...React, default: React}, 'react-native': {ActivityIndicator: 'Loading', ScrollView: 'Scroll', Text: 'Text', View: 'View'},
  '../../../../../packages/player-core/src': {sameFence}, '../../../../../packages/i18n/src': {defaultI18n},
  '../../../../../packages/client-core/src/presentation/kit-model/text': {clockText: String},
  '../../kit/controls': {Button: 'Button', Focusable: 'Row'}, '../../kit/focus': {FocusRegion: 'Focus'},
  '../../kit/overlays/OverlayHost': {useOverlayLifecycle() {}}, '../../kit/overlays/surface': {PanelBackground: 'Background'},
  '../../kit/Icon': {Icon: 'Icon'}, '../../kit/theme': {nativeType: () => ({}), useTheme: () => ({isTV, colors: {}, type: {bodyStrong: {}, caption: {}}})},
  './track-identity': {nativeWatchTracks}, './panel-model': {nativeWatchPanelRows},
  './subtitle-timing': {nativeWatchSubtitleTiming},
  '../../../../../packages/client-core/src/subtitles': {subtitleReason},
});
const fence = playbackFence({kind: 'queue', playback: {scope: {serverId: 's', accountId: 'a', profileId: 'p', controllerId: 'c', controllerEpoch: 'e', commandLaneId: 'l', authority: 'local'}, run: 1}, sessionId: 'session', itemId: 'item', sourceId: 'v2', entryId: 'entry', generation: 3});
const options = parseOptions({itemId: 'item', versions: [{id: 'v2', audio: [{id: 'first', default: true}, {id: 'chosen'}], subtitles: [{id: 'first', default: true}, {id: 'chosen'}]}], qualities: [{mode: 'original'}, {mode: 'automatic'}]});
const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : React.isValidElement(node)
  ? [node, ...descendants(typeof (node as any).props.children === 'function' ? (node as any).props.children({focused: false}) : (node as any).props.children)] : [];

test('real panel renderer sends exact selected-source track/quality commands, blocks stale actions and retains one focus owner', async () => {
  for (const tv of [false, true]) {
    isTV = tv; const calls: unknown[][] = [], listeners = new Set<() => void>();
    let source: any = {retired: false, fence, dock: {local: {fence, expanded: true}}, options,
      playback: {positionSeconds: 2}, supportedRates: [1, 1.5], effectiveRate: 1,
      session: {id: 'session', itemId: 'item', versionId: 'v2', queue: {entryId: 'entry'}, presentation: {generation: 3, audioTrackId: 'chosen', quality: {mode: 'original'}}}};
    let context: any = {source, fence, state: {fence, panel: 'audio', panelOffset: 0}, layout: {mode: 'watch'}, runtime: {text: {locale: 'en-US'}},
      renderer: {width: tv ? 1920 : 390, height: tv ? 1080 : 844, scale: 1},
      closePanel() {}, backPanel() {}, openPanel: (panel: string) => {context = {...context, state: {...context.state, panel}};}, rememberPanel() {}};
    const controller = {getSnapshot: () => snapshot, subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};}, load: async () => {}, clear() {}};
    const snapshot = {phase: 'ready', fence, options};
    const playback = {getSnapshot: () => source, change: async (...args: unknown[]) => {calls.push(args);}, chooseQuality: async (...args: unknown[]) => {calls.push(args);}, setRate: (...args: unknown[]) => {calls.push(args);}};
    const names = {audio: (track: any) => ({primary: track.id}), subtitle: (track: any) => ({primary: track.id}), quality: (choice: any) => ({primary: choice.mode}), audioFooter: () => [], qualityFooter: () => []};
    let tree: any;
    const host = createHookHost(() => {tree = NativeWatchPanels({context, options: controller, playback, names, copy: {sessionLead: 'Actual localized lead', sessionDefaults: 'Actual localized defaults', audioContinues: 'Actual localized continuing audio'}, reportError: assert.fail, renderError: assert.fail});});
    host.mount();
    try {
      assert.equal(descendants(tree).filter(node => node.type === 'Focus').length, 1);
      await act(() => {descendants(tree).find(node => node.props.testID === 'watch-choice-first').props.onPress();});
      assert.deepEqual(calls[0], [fence, {audioTrackId: 'first'}]);
      await act(() => {context.openPanel('quality'); host.rerender();});
      await act(() => {descendants(tree).find(node => node.props.testID === 'watch-choice-automatic').props.onPress();});
      assert.deepEqual(calls[1], [fence, options.qualities[1]]);
      await act(() => {source = {...source, fence: {...fence, generation: 4}};});
      await act(() => {descendants(tree).find(node => node.props.testID === 'watch-choice-automatic').props.onPress();});
      assert.equal(calls.length, 2);
    } finally {host.unmount();}
    assert.equal(listeners.size, 0);
  }
});

test('a retiring panel command cannot keep a new source busy or report its old failure on the new panel', async () => {
  isTV = true;
  let rejectOld!: (error: unknown) => void;
  const held = new Promise<void>((_, reject) => {rejectOld = reject;}), errors: unknown[] = [];
  let source: any = {retired: false, fence, dock: {local: {fence, expanded: true}}, options, playback: {positionSeconds: 2},
    session: {id: 'session', itemId: 'item', versionId: 'v2', queue: {entryId: 'entry'}, presentation: {generation: 3, audioTrackId: 'chosen', quality: {mode: 'original'}}}};
  let context: any = {source, fence, state: {fence, panel: 'audio', panelOffset: 0}, runtime: {text: {locale: 'en-US'}}, layout: {mode: 'full-window'},
    renderer: {width: 1920, height: 1080, scale: 1}, backPanel() {}, closePanel() {}, openPanel() {}, rememberPanel() {}};
  let snapshot = {phase: 'ready', fence, options};
  const controller = {getSnapshot: () => snapshot, subscribe: () => () => {}, load: async () => {}, clear() {}};
  const playback = {getSnapshot: () => source, change: () => held};
  const names = {audio: (track: any) => ({primary: track.id}), subtitle: (track: any) => ({primary: track.id}), quality: (choice: any) => ({primary: choice.mode}), audioFooter: () => [], qualityFooter: () => []};
  let tree: any;
  const host = createHookHost(() => {tree = NativeWatchPanels({context, options: controller, playback, names,
    copy: {sessionLead: 'Actual localized lead', sessionDefaults: 'Actual localized defaults', audioContinues: 'Actual localized continuing audio'}, reportError: (error: unknown) => errors.push(error), renderError: assert.fail});});
  host.mount();
  try {
    await act(() => {descendants(tree).find(node => node.props.testID === 'watch-choice-first').props.onPress();});
    assert.equal(descendants(tree).find(node => node.props.testID === 'watch-choice-first').props.disabled, true);
    const next = {...fence, generation: 4};
    await act(() => {
      source = {...source, fence: next, dock: {local: {fence: next, expanded: true}}, session: {...source.session, presentation: {...source.session.presentation, generation: 4}}};
      snapshot = {...snapshot, fence: next}; context = {...context, source, fence: next, state: {...context.state, fence: next}}; host.rerender();
    });
    assert.equal(descendants(tree).find(node => node.props.testID === 'watch-choice-first').props.disabled, false);
    await act(async () => {rejectOld(new Error('retired source command')); await Promise.resolve();});
    assert.deepEqual(errors, []);
    assert.equal(descendants(tree).find(node => node.props.testID === 'watch-choice-first').props.disabled, false);
  } finally {host.unmount();}
});

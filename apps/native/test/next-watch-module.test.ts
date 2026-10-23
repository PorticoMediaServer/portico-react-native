import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule, hooks} from './helpers/screen-harness.mjs';
import {sameFence, playbackFence} from '../../../packages/player-core/src/index.ts';
import {qualityOptionSelected} from '../../../packages/client-core/src/playback-v1/quality.ts';
import {nativeWatchTracks} from '../src-next/screens/watch/track-identity.ts';
import {createNativeWatchPanelNames} from '../src-next/screens/watch/panel-names.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';

const {react} = hooks();
let captured: any, optionsDisposed = 0, screensDisposed = 0;
const {createNativeWatchModule, nativeWatchChromeFacts} = await screenModule(new URL('../src-next/screens/watch/module.tsx', import.meta.url), {
  react, 'react-native': {Platform: {isTV: false}}, '../../../../../packages/player-core/src': {sameFence},
  '../../../../../packages/client-core/src/playback-v1/quality': {qualityOptionSelected}, './track-identity': {nativeWatchTracks},
  '../../../../../packages/i18n/src': {defaultI18n}, './panel-names': {createNativeWatchPanelNames},
  './WatchPanels': {NativeWatchPanels: 'Panels'}, './panel-options': {NativeWatchPanelOptions: class {dispose() {optionsDisposed++;}}},
  './factory': {createNativeWatchScreens: (ports: any) => {captured = ports; return {title: {render: () => 'title'}, watch: {
    render: (runtime: any) => ports.player.chrome(ports.playback.getSnapshot(), runtime), body: () => 'body', back: () => true,
  }, dispose: () => {screensDisposed++;}};}},
});
const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'};
const fence = playbackFence({kind: 'queue', playback: {scope: {serverId: 'server', accountId: 'account', profileId: 'profile', controllerId: 'controller', controllerEpoch: 'epoch', commandLaneId: 'lane', authority: 'local'}, run: 1}, sessionId: 'session', itemId: 'item', sourceId: 'v2', entryId: 'entry', generation: 3});
const names = {audio: (track: any) => ({primary: track.id}), subtitle: (track: any) => ({primary: track.id}), quality: (option: any) => ({primary: option.id ?? option.mode})};
function source(): any {
  return {retired: false, fence, dock: {local: {fence}}, options: {itemId: 'item', qualities: [{mode: 'original'}, {mode: 'fixed', id: '720p-high'}], versions: [
    {id: 'v1', audio: [], subtitles: []}, {id: 'v2', audio: [{id: 'default', default: true}, {id: 'actual'}], subtitles: [{id: 'actual-subtitle'}]},
  ]}, session: {id: 'session', itemId: 'item', versionId: 'v2', queue: {entryId: 'entry'}, presentation: {generation: 3,
    audioTrackId: 'actual', subtitle: {trackId: 'actual-subtitle'}, quality: {mode: 'fixed', id: '720p-high'}}}};
}

test('chrome facts use current selected IDs and never a preferred version or an unknown output', () => {
  const live = source();
  assert.deepEqual(nativeWatchChromeFacts(live, names), {quality: '720p-high', audio: 'actual', subtitle: 'actual-subtitle'});
  assert.deepEqual(nativeWatchChromeFacts({...live, session: {...live.session, presentation: {...live.session.presentation, generation: 2}}}, names), {quality: ''});
  assert.deepEqual(nativeWatchChromeFacts({...live, session: {...live.session, presentation: {...live.session.presentation, audioTrackId: undefined, subtitle: undefined}}}, names), {quality: '720p-high', audio: undefined, subtitle: 'Off'});
});

test('module preserves the genuine adapter/outlet, current preferences, body and retirement lifetime', async () => {
  let live = true, back = 5000, forward = 60000;
  const transitions: any[] = [], layouts: any[] = [], errors: any[] = [];
  const transition = {action: 'collapse'}, playback = {getSnapshot: source, dock: {collapse: (expected: any) => {assert.equal(expected, fence); return transition;}},
    onTransition: async (value: any) => {transitions.push(value);}}, outlet = {genuine: true};
  const context = {current: () => live, authority: () => authority, session: () => ({viewer: {...authority, authority: 'local'}}), api: {},
    subscribeAuthority() {}, navigation: {}, playback, watch: outlet,
    preferences: () => ({effective: {'playback.skipBackMs': back, 'playback.skipForwardMs': forward}})};
  const module = createNativeWatchModule(context, {names, title: {renderError() {}}, presentation: (value: any) => {layouts.push(value);}});
  const runtime = {reportError: (error: any) => {errors.push(error);}};
  assert.equal(captured.playback, playback); assert.equal(captured.watch, outlet); assert.equal(captured.isCurrent(), true);
  let chrome = module.render(runtime); assert.equal(chrome.skipBackSeconds, 5); assert.equal(chrome.skipForwardSeconds, 60);
  back = 15000; forward = 30000; chrome = module.render(runtime); assert.equal(chrome.skipBackSeconds, 15); assert.equal(chrome.skipForwardSeconds, 30);
  chrome.onMinimize(fence); await Promise.resolve(); assert.deepEqual(transitions, [transition]);
  assert.equal(captured.player.content({}), 'body'); assert.equal(module.back(), true);
  live = false; assert.equal(module.render(runtime), null); assert.equal(module.back(), false); assert.equal(captured.isCurrent(), false);
  module.dispose(); module.dispose(); assert.equal(optionsDisposed, 1); assert.equal(screensDisposed, 1); assert.deepEqual(layouts, [undefined]); assert.deepEqual(errors, []);
});

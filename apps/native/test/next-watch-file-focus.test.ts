import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {deletionAllowed} from '../../../packages/client-core/src/administration.ts';
import {mergeExplanation} from '../../../packages/client-core/src/title-identity.ts';
import {shellLayout} from '../src-next/shell/model.ts';
import * as registry from '../src-next/kit/focus/registry.ts';
import * as hostRefs from '../src-next/kit/focus/useHostRef.ts';
const react = {...React, default: React}, theme = {isTV: true, colors: {}, type: {body: {}, caption: {}, captionStrong: {}, bodyStrong: {}}};
const controls = {Button: 'Button', TextField: 'TextField'};
const themed = {useTheme: () => theme, nativeType: () => ({})};
const {NativeFileInfoContent} = await screenModule(new URL('../src-next/screens/watch/FileInfoContent.tsx', import.meta.url), {
  react, 'react-native': {ScrollView: 'ScrollView', Text: 'Text', View: 'View'}, '../../../../../packages/i18n/src': {defaultI18n},
  '../../kit/controls': controls, '../../kit/Icon': {Icon: 'Icon'}, '../../kit/theme': themed,
});
const {NativeWatchOverlays} = await screenModule(new URL('../src-next/screens/watch/WatchOverlays.tsx', import.meta.url), {
  react, 'react-native': {Modal: 'Modal', Platform: {isTV: true}, ScrollView: 'ScrollView', StyleSheet: {absoluteFill: {}}, Text: 'Text', View: 'View', useWindowDimensions: () => ({width: 1920, height: 1080})},
  '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/administration': {deletionAllowed}, '../../../../../packages/client-core/src/title-identity': {mergeExplanation},
  '../../shell/model': {shellLayout}, '../../kit/controls': controls, '../../kit/artwork': {Artwork: 'Artwork'}, '../../kit/states': {StateView: 'StateView'},
  '../../kit/overlays': {BottomSheet: 'BottomSheet', Dialog: 'Dialog', Menu: 'Menu'}, '../../kit/overlays/Menu': {TouchMenuHeader: 'TouchMenuHeader'},
  '../../kit/overlays/surface': {FocusBoundary: 'FocusBoundary', PanelBackground: 'PanelBackground'}, '../../kit/overlays/OverlayHost': {useOverlayLifecycle() {}}, '../../kit/theme': themed,
});
const contexts: {current: unknown}[] = [];
const focus = await screenModule(new URL('../src-next/kit/focus/FocusRegion.tsx', import.meta.url), {
  react: {...react, createContext: (current: unknown) => {const value = {current}; contexts.push(value); return value;}, useContext: (context: {current: unknown}) => context.current},
  'react-native': {findNodeHandle: () => null, TVFocusGuideView: 'Guide', View: 'View'}, '../theme': themed, './registry': registry, './useHostRef': hostRefs,
});
function targets(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(targets);
  if (!React.isValidElement(value)) return [];
  const node: any = value;
  if (typeof node.type === 'function') return targets(node.type(node.props));
  return [...(node.type === 'Button' || node.type === 'TextField' ? [node] : []), ...targets(node.props.children), ...targets(node.props.footer), ...targets(node.props.headerContent)];
}
const entry = {id: 'actual-title', kind: 'movie', title: 'Actual title', libraryId: 'actual-library'}, other = {...entry, id: 'other-title'};
const model = {files: [], owner: {heading: 'Manage files', locations: [{id: 'asset', actions: [{id: 'delete-version', label: 'Delete'}]}], actions: [{id: 'split-title', label: 'Split'}, {id: 'merge-title', label: 'Merge'}]}};
for (const phase of ['file-info', 'delete', 'split-pick', 'split', 'merge-search', 'merge-confirm']) test(`real ${phase} controls mount the strict TV focus hook using stable member/action identities`, () => {
  const value = {phase: phase.startsWith('merge') ? 'merge' : phase, capture: {entry}, busy: false, candidates: [other], confirmation: '', keep: entry.id,
    ...(phase === 'merge-confirm' ? {other} : {}), owner: {info: {model, files: [], groups: [{members: [{id: 'asset', available: true}]}]}},
    content: NativeFileInfoContent({model, onManage() {}})};
  const presenters = {subscribe: () => () => {}, getSnapshot: () => value, current: () => true, close() {}, backToInfo() {}, search: async () => {}};
  let buttons: any[] = [];
  const host = createHookHost(() => {buttons = targets(React.createElement(NativeWatchOverlays, {presenters, runtime: {}, common: {}}));});
  host.mount();
  try {
    assert.ok(buttons.length >= 2);
    const ids = buttons.map(node => node.props.focusId ?? node.props.testID);
    assert.equal(new Set(ids).size, ids.length); assert.ok(ids.every(id => typeof id === 'string' && id.startsWith('watch-')));
    const region = registry.createFocusRegistry(); region.configure({id: 'watch-file-manage', orientation: 'vertical'});
    contexts[0]!.current = region; contexts[1]!.current = 'watch-file-manage';
    for (const button of buttons) {
      const mounted = createHookHost(() => {focus.useFocusTarget({focusId: button.props.focusId, testID: button.props.testID, disabled: button.props.disabled});});
      mounted.mount(); mounted.unmount();
    }
  } finally {host.unmount();}
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {presentError} from '../../../packages/client-core/src/presentation/errors';
import {createTheme, nativeType} from '../src-next/kit/theme';
import {applyNativeTVKeyboardKey, nativeTVKeyboardRows} from '../src-next/screens/search/keyboard';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children), ...nodes(node.props.footer)] : [];

test('TV Save view opens real first-key entry, edits Unicode, and Back returns through Name before the captured opener', async () => {
  let snapshot = {open: true, name: 'Genre Action', busy: false, nameLocked: false}, tree: any, saves = 0, backs = 0, restored = 0;
  const listeners = new Set<() => void>(), entries: any[] = [], changes: string[] = [];
  const publish = (next: Partial<typeof snapshot>) => {snapshot = {...snapshot, ...next}; for (const listener of listeners) listener();};
  const controller = {getSnapshot: () => snapshot, subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    setName: (name: string) => {changes.push(name); publish({name});}, save: async () => {saves++;}};
  const {NativeTVSaveViewKeyboard} = await screenModule(new URL('../src-next/tv/library/SaveViewKeyboard.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {Text: 'Text', View: 'View'},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/errors': {presentError},
    '../../kit/controls': {Button: 'Button', Focusable: 'Focusable'}, '../../kit/focus': {FocusRegion: 'Region', requestNativeFocus: (target: any) => target?.requestTVFocus()},
    '../../kit/overlays': {Banner: 'Banner', SidePanel: 'Panel'}, '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/theme': {nativeType, useTheme: () => createTheme({isTV: true, width: 1920})},
    '../../screens/destinations/useEntryFocus': {useDestinationEntryFocus: (activation: unknown, address: unknown) => entries.push({activation, address})},
    '../../screens/search/keyboard': {applyNativeTVKeyboardKey, nativeTVKeyboardRows},
  });
  const host = createHookHost(() => {tree = NativeTVSaveViewKeyboard({controller, onBack: () => {backs++;}});});
  const find = (id: string) => nodes(tree).find(node => node.props.testID === `tv.library.save-view.${id}`);
  try {
    await act(() => host.mount());
    assert.equal(tree.props.title, defaultI18n.t('lib.saveViewTitle'));
    assert.equal(nodes(tree).some(node => node.type === 'TextInput'), false, 'TV naming never opens the system text keyboard');
    assert.equal(find('key.a'), undefined, 'OK on Name is the explicit keyboard entry');
    tree.props.initialFocusRef.current = {requestTVFocus: () => {restored++;}};
    await act(() => find('name').props.onPress());
    assert.deepEqual(entries.at(-1), {activation: {visible: true, intent: 'enter', revision: 0}, address: {regionId: 'tv.library.save-view.keys.0', childId: 'a'}});
    assert.equal(nodes(tree).filter(node => node.type === 'Focusable' && node.props.testID?.includes('.key.')).length, 39);
    await act(() => find('key.a').props.onPress()); assert.equal(snapshot.name, 'Genre Actiona');
    await act(() => publish({name: '🎬'}));
    await act(() => find('key.delete').props.onPress()); assert.equal(snapshot.name, '', 'delete removes a complete Unicode codepoint');
    assert.equal(find('save').props.disabled, true);
    await act(() => publish({name: '🎬'.repeat(200)}));
    const before = changes.length;
    await act(() => find('key.a').props.onPress()); assert.equal(changes.length, before, 'the name bound counts Unicode characters without truncating');
    await act(() => tree.props.onOpenChange(false, 'back'));
    assert.equal(backs, 0); assert.equal(restored, 1); assert.equal(find('key.a'), undefined);
    await act(() => tree.props.onOpenChange(false, 'back')); assert.equal(backs, 1);
    assert.equal(saves, 0, 'neither keyboard Back nor panel Back creates a view');
    await act(() => publish({busy: true}));
    await act(() => tree.props.onOpenChange(false, 'back')); assert.equal(backs, 1);
    assert.equal(tree.props.dismissOnBack, false); assert.equal(find('save').props.disabled, true);
    await act(() => publish({busy: false, nameLocked: true}));
    assert.equal(find('name').props.disabled, true); assert.equal(find('save').props.disabled, false, 'a locked uncertain operation retains its original name and can retry');
    await act(() => find('save').props.onPress()); assert.equal(saves, 1);
  } finally {host.unmount();}
  assert.equal(listeners.size, 0);
});

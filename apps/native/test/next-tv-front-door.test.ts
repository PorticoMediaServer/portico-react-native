import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme, nativeType} from '../src-next/kit/theme';
import {shellLayout} from '../src-next/shell/model';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];

test('the TV front door renders its wordmark and only actual authority-choice callbacks without starting either flow', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'require');
  Object.defineProperty(globalThis, 'require', {configurable: true, value: (path: string) => {assert.equal(path, '../../../assets/wordmark.png'); return 'wordmark';}});
  let host: ReturnType<typeof createHookHost> | undefined;
  try {
    const calls: string[] = [], entries: any[] = [], theme = createTheme({isTV: true, width: 1920});
    let dimensions = {width: 1920, height: 1080}, tree: any;
    const {TVFrontDoor} = await screenModule(new URL('../src-next/tv/auth/TVFrontDoor.tsx', import.meta.url), {
      react: {...React, default: React}, 'react-native': {Image: 'Image', Text: 'Text', View: 'View', useWindowDimensions: () => dimensions},
      '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/artwork': {ColourBackdrop: 'Backdrop'}, '../../kit/controls': {Button: 'Button'},
      '../../kit/focus': {FocusProvider: 'Provider', FocusRegion: 'Region'}, '../../kit/theme': {nativeType, useTheme: () => theme},
      '../../screens/destinations/useEntryFocus': {useDestinationEntryFocus: (activation: unknown, address: unknown) => entries.push({activation, address})},
      '../../shell/model': {shellLayout},
    });
    const props = {busy: false, onPortico: () => calls.push('portico'), onLocal: () => calls.push('local')};
    host = createHookHost(() => {const provider = TVFrontDoor(props); assert.equal(provider.type, 'Provider'); const child = provider.props.children; tree = child.type(child.props);});
    await act(() => host!.mount());
    assert.deepEqual(calls, [], 'mounting does not contact Portico Services or a media server');
    const all = nodes(tree), logo = all.find(node => node.type === 'Image');
    assert.equal(logo.props.source, 'wordmark'); assert.equal(logo.props.accessibilityLabel, defaultI18n.t('accounts.brand'));
    const buttons = all.filter(node => node.type === 'Button');
    assert.deepEqual(buttons.map(node => node.props.children), [defaultI18n.t('accounts.signIn.portico'), defaultI18n.t('accounts.signIn.local')]);
    assert.equal(buttons.length, 2, 'no code, terms, provider or extra Back control appears at the front door');
    assert.ok(buttons.every(node => node.props.loading === undefined), 'idle labels reserve no undrawn loading-glyph slot');
    assert.deepEqual(entries[0].address, {regionId: 'tv.auth.front-door', childId: 'portico'});
    assert.equal(all.find(node => node.type === 'Region').props.orientation, 'horizontal');
    buttons[0].props.onPress(); buttons[1].props.onPress(); assert.deepEqual(calls, ['portico', 'local']);
    const heading = all.find(node => node.props.accessibilityRole === 'header');
    assert.equal(heading.props.style[1].marginBottom, 56);
    assert.equal(all.find(node => node.type === 'Region').props.style.gap, 36);
    assert.deepEqual(logo.props.style, {position: 'absolute', left: 0, top: 72, width: 174, height: 40});
    assert.ok(all.some(node => node.props.style?.left === 200 && node.props.style?.width === 900));
    dimensions = {width: 1280, height: 800}; props.busy = true;
    await act(() => host!.rerender());
    const canvas = nodes(tree).find(node => node.props.style?.transformOrigin === 'top left');
    assert.equal(canvas.props.style.width, 1920); assert.equal(canvas.props.style.height, 1080);
    assert.deepEqual(canvas.props.style.transform, [{scale: 2 / 3}]); assert.equal(canvas.props.style.top, 40);
    nodes(tree).filter(node => node.type === 'Button').forEach(node => {assert.equal(node.props.disabled, true); node.props.onPress();});
    assert.deepEqual(calls, ['portico', 'local']);
    assert.equal(entries.at(-1).activation.visible, false);
  } finally {
    host?.unmount();
    if (previous) Object.defineProperty(globalThis, 'require', previous); else delete (globalThis as {require?: unknown}).require;
  }
});

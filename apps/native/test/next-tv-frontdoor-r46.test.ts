import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme, nativeType} from '../src-next/kit/theme';
import {shellLayout} from '../src-next/shell/model';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';
import {createNativeMeasurementRegistry} from '../src-next/dev/layout-dump/registry';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];

/** connect40's `.tvl h1` shadow is declared paint on the one public heading; the
 * comparator measured it missing while the rest of the title box already matched. */
test('the TV front door title declares connect40 .tvl h1 shadow and no other Text carries one', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, '__DEV__'),
    previousRequire = Object.getOwnPropertyDescriptor(globalThis, 'require');
  Object.defineProperty(globalThis, '__DEV__', {configurable: true, value: false});
  Object.defineProperty(globalThis, 'require', {configurable: true, value: (path: string) => {
    assert.equal(path, '../../../assets/wordmark.png', 'only the drawn wordmark asset is required');
    return 'wordmark';
  }});
  let host: ReturnType<typeof createHookHost> | undefined;
  try {
    let tree: any, dimensions = {width: 1920, height: 1080}, theme = createTheme({isTV: true, width: 1920});
    const flatten = (value: any): any => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value;
    const {TVFrontDoor} = await screenModule(new URL('../src-next/tv/auth/TVFrontDoor.tsx', import.meta.url), {
      react: {...React, default: React}, 'react-native': {Image: 'Image', Text: 'Text', View: 'View', useWindowDimensions: () => dimensions},
      '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/artwork': {ColourBackdrop: 'Backdrop'}, '../../kit/controls': {Button: 'Button'},
      '../../kit/focus': {FocusProvider: 'Provider', FocusRegion: 'Region'}, '../../kit/theme': {nativeType, useTheme: () => theme},
      '../../screens/destinations/useEntryFocus': {useDestinationEntryFocus: () => {}}, '../../shell/model': {shellLayout},
      '../../kit/dev-observation': {useNativeObservation: () => ({})},
    });
    const props = {busy: false, onPortico: () => {}, onLocal: () => {}};
    host = createHookHost(() => {const provider = TVFrontDoor(props); const child = provider.props.children; tree = child.type(child.props);});
    await act(() => host!.mount());
    const texts = () => nodes(tree).filter(node => node.type === 'Text');
    assert.equal(texts().length, 1, 'the front door has one public heading and no other Text node');
    const title = flatten(texts()[0].props.style);
    assert.equal(title.textShadowColor, 'rgba(7, 16, 24, 0.5)');
    assert.deepEqual(title.textShadowOffset, {width: 0, height: 2});
    assert.equal(title.textShadowRadius, 30);
    assert.equal(title.fontSize, 88);
    assert.equal(title.marginBottom, 56, 'the measured title box keeps its drawn margins and type');
    assert.ok(nodes(tree).filter(node => node.type !== 'Text').every(node => !/textShadow/.test(JSON.stringify(node.props.style ?? {}))),
      'the drawn views and buttons carry no text shadow of their own');
    dimensions = {width: 1280, height: 800}; theme = {...theme, textScale: 1.25}; props.busy = true;
    await act(() => host!.rerender());
    const scaled = flatten(texts()[0].props.style);
    assert.equal(scaled.fontSize, 110, 'the shadow follows the same heading that a text-scale change rebuilds');
    assert.equal(scaled.textShadowColor, 'rgba(7, 16, 24, 0.5)');
    assert.deepEqual(scaled.textShadowOffset, {width: 0, height: 2});
    assert.equal(scaled.textShadowRadius, 30);
  } finally {
    host?.unmount();
    if (previous) Object.defineProperty(globalThis, '__DEV__', previous); else delete (globalThis as {__DEV__?: unknown}).__DEV__;
    if (previousRequire) Object.defineProperty(globalThis, 'require', previousRequire); else delete (globalThis as {require?: unknown}).require;
  }
});

/** The comparator only accepts declared paint when the owner marks its final
 * evaluated style complete; the title's own registration must say so. */
test('the DEV TV heading publishes the drawn shadow as a complete declared style', async () => {
  const beforeRequire = Object.getOwnPropertyDescriptor(globalThis, 'require'), beforeDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
  const registry = createNativeMeasurementRegistry();
  Object.defineProperty(globalThis, '__DEV__', {configurable: true, value: true});
  Object.defineProperty(globalThis, 'require', {configurable: true, value: (path: string) => {
    if (path === '../../../assets/wordmark.png') return 'wordmark';
    assert.equal(path, '../../dev/layout-dump/index', 'only the DEV layout dump is required');
    return {registerNativeHost: registry.register};
  }});
  let host: ReturnType<typeof createHookHost> | undefined;
  try {
    let tree: any, theme = createTheme({isTV: true, width: 1920});
    const flatten = (value: any): any => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value;
    const {TVFrontDoor} = await screenModule(new URL('../src-next/tv/auth/TVFrontDoor.tsx', import.meta.url), {
      react: {...React, default: React}, 'react-native': {Image: 'Image', Text: 'Text', View: 'View', useWindowDimensions: () => ({width: 1920, height: 1080}),
        StyleSheet: {flatten}, findNodeHandle: (native: {tag: number}) => native.tag},
      '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/artwork': {ColourBackdrop: 'Backdrop'}, '../../kit/controls': {Button: 'Button'},
      '../../kit/focus': {FocusProvider: 'Provider', FocusRegion: 'Region'}, '../../kit/theme': {nativeType, useTheme: () => theme},
      '../../screens/destinations/useEntryFocus': {useDestinationEntryFocus: () => {}}, '../../shell/model': {shellLayout},
      '../../kit/dev-observation': {useNativeObservation: () => ({})},
    });
    host = createHookHost(() => {const provider = TVFrontDoor({busy: false, onPortico: () => {}, onLocal: () => {}});
      const child = provider.props.children; tree = child.type(child.props);});
    await act(() => host!.mount());
    const heading = nodes(tree).find(node => node.props.accessibilityRole === 'header'), native = {tag: 101};
    heading.props.ref(native);
    const declared = registry.read(native)!;
    assert.equal(declared.declaredStyleComplete, true, 'the title publishes its final evaluated style, not a partial recipe');
    assert.equal(declared.flattenedStyle.textShadowColor, 'rgba(7, 16, 24, 0.5)');
    assert.equal(declared.flattenedStyle.textShadowRadius, 30);
    assert.equal(declared.flattenedStyle.textShadowOffsetX, 0);
    assert.equal(declared.flattenedStyle.textShadowOffsetY, 2);
    theme = {...theme, textScale: 1.25}; await act(() => host!.rerender());
    const scaled = registry.read(native)!;
    assert.equal(scaled.declaredStyleComplete, true, 'the scaled rebuild stays a complete declared style');
    assert.equal(scaled.flattenedStyle.fontSize, 110);
    assert.equal(scaled.flattenedStyle.textShadowColor, 'rgba(7, 16, 24, 0.5)');
  } finally {
    host?.unmount();
    if (beforeDev) Object.defineProperty(globalThis, '__DEV__', beforeDev); else delete (globalThis as {__DEV__?: unknown}).__DEV__;
    if (beforeRequire) Object.defineProperty(globalThis, 'require', beforeRequire); else delete (globalThis as {require?: unknown}).require;
  }
});

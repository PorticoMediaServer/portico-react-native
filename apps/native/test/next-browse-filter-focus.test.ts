import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import * as design from '../../../packages/design/src/index.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {createTheme, fontFamilies} from '../src-next/kit/theme.ts';
import * as controlModel from '../src-next/kit/controls/control-model.ts';
import {useControlValue} from '../src-next/kit/controls/useControlValue.ts';
import * as presentation from '../src-next/kit/browse/presentation.ts';
import * as registryModule from '../src-next/kit/focus/registry.ts';
import {useHostRef} from '../src-next/kit/focus/useHostRef.ts';
import {createHookHost} from './hook-driver.ts';
import {screenModule} from './helpers/screen-harness.mjs';

type Node = {type: string; props: Record<string, any>; children: (Node | string | number)[]};
const text = (node: Node | string | number): string => typeof node === 'object' ? node.children.map(text).join('') : String(node);

// Actual FilterBuilder, controls, FocusRegion, useFocusTarget and registry run.
// Only native hosts/animation/blur/theme are replaced; no D-pad/layout claim.
async function fixture(isTV: boolean) {
  const theme = createTheme({isTV, width: isTV ? 1920 : 390});
  const react = {...React, default: React}, native = {View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', TextInput: 'TextInput', TVFocusGuideView: 'TVFocusGuideView',
    ActivityIndicator: 'ActivityIndicator', Platform: {OS: 'android', isTV}, findNodeHandle: (host: any) => host?.tag ?? null,
    StyleSheet: {create: (value: any) => value, flatten: (value: any): any => Array.isArray(value) ? Object.assign({}, ...value.map(native.StyleSheet.flatten)) : value ?? {}, absoluteFill: {position: 'absolute', inset: 0}}};
  const themeModule = {useTheme: () => theme, fontFamilies};
  const focus = await screenModule(new URL('../src-next/kit/focus/FocusRegion.tsx', import.meta.url), {
    react, 'react-native': native, '../theme': themeModule, './registry': registryModule, './useHostRef': {useHostRef},
  });
  const focusModule = {...registryModule, ...focus};
  const reanimated = {default: {createAnimatedComponent: (value: any) => value, View: 'AnimatedView'},
    useSharedValue: (value: any) => React.useRef({value}).current, useAnimatedStyle: (run: any) => run(), withTiming: (value: any) => value};
  const {Focusable} = await screenModule(new URL('../src-next/kit/controls/Focusable.tsx', import.meta.url), {
    react, 'react-native': native, 'react-native-reanimated': reanimated, '@portico/design': design, '../theme': themeModule,
    '../useMotion': {useMotion: () => ({transforms: false, timing: () => ({duration: 0})})}, './control-model': controlModel, './useFocusedMenu': {useFocusedMenu() {}}, '../focus': focusModule,
  });
  const shared = {react, 'react-native': native, '@portico/design': design, '../theme': themeModule, '../focus': focusModule,
    '../Icon': {Icon: 'Icon'}, './Focusable': {Focusable}, './control-model': controlModel, './useControlValue': {useControlValue}};
  const {Chip} = await screenModule(new URL('../src-next/kit/controls/Chip.tsx', import.meta.url), shared);
  const {Segmented} = await screenModule(new URL('../src-next/kit/controls/Tabs.tsx', import.meta.url), shared);
  const {TextField} = await screenModule(new URL('../src-next/kit/controls/TextField.tsx', import.meta.url), shared);
  const {Button} = await screenModule(new URL('../src-next/kit/controls/Button.tsx', import.meta.url), {...shared, '../../platform/native-blur': {BlurView: 'BlurView', glassRecipe: () => ({})}});
  const {FilterBuilder} = await screenModule(new URL('../src-next/kit/browse/Filters.tsx', import.meta.url), {
    react, 'react-native': native, '../../../../../packages/i18n/src': {defaultI18n}, '../controls': {Button, Chip, Segmented, TextField, Focusable},
    '../Icon': {Icon: 'Icon'}, '../focus': focusModule, '../theme': themeModule, './presentation': presentation,
  });
  return {FilterBuilder, ...focusModule};
}

function mountTree(root: React.ReactNode) {
  const drivers: ReturnType<typeof createHookHost>[] = [], refs: (() => void)[] = [], native: Node[] = [];
  let nextTag = 0;
  const walk = (node: any): (Node | string | number)[] => {
    if (Array.isArray(node)) return node.flatMap(walk);
    if (node === null || node === undefined || typeof node === 'boolean') return [];
    if (typeof node === 'string' || typeof node === 'number') return [node];
    const {type, props} = node;
    if (type === React.Fragment) return walk(props.children);
    if (type?.$$typeof === Symbol.for('react.context')) {
      const previous = type._currentValue; type._currentValue = props.value;
      try {return walk(props.children);} finally {type._currentValue = previous;}
    }
    if (typeof type === 'function' || type?.$$typeof === Symbol.for('react.forward_ref')) {
      let child: any;
      const driver = createHookHost(() => {child = typeof type === 'function' ? type(props) : type.render(props, props.ref ?? null);});
      drivers.push(driver); driver.mount(); return walk(child);
    }
    assert.equal(typeof type, 'string', 'the test must resolve every actual component');
    const host = {tag: ++nextTag, requestTVFocus() {}, focus() {}, setDestinations() {}};
    if (typeof props.ref === 'function') {const cleanup = props.ref(host); refs.push(typeof cleanup === 'function' ? cleanup : () => props.ref(null));}
    else if (props.ref) {props.ref.current = host; refs.push(() => {props.ref.current = null;});}
    const record: Node = {type, props, children: []}; native.push(record);
    record.children = walk(typeof props.children === 'function' ? props.children({pressed: false, hovered: false}) : props.children);
    return [record];
  };
  try {walk(root);} catch (error) {for (const cleanup of refs.reverse()) cleanup(); for (const driver of drivers.reverse()) driver.unmount(); throw error;}
  return {controls: native.filter(node => node.type === 'Pressable' || node.type === 'TextInput'), dispose() {for (const cleanup of refs.reverse()) cleanup(); for (const driver of drivers.reverse()) driver.unmount();}};
}

function props(prefix?: string, reverse = false) {
  const calls: any[] = [];
  const values = [{value: 'same/value', label: 'Shared value', count: 4}, {value: 'another.value', label: 'Another value', count: 2}];
  const fields: Record<string, any> = {
    genre: {kind: 'values', included: [], excluded: [], mode: 'any', allowAll: true, showMatchMode: true, search: '', showAllLabel: 'All genres', values: reverse ? [...values].reverse() : values},
    tag: {kind: 'values', included: [], excluded: [], mode: 'any', allowAll: false, values: [values[0]]},
    year: {kind: 'range', value: null, presets: [{value: '1980', label: '1980s'}, {value: '1990', label: '1990s'}]},
    rating: {kind: 'choice', value: null, options: [{value: 'same/value', label: 'Same choice'}, {value: 'disabled', label: 'Unavailable choice', disabled: true}]},
    favorite: {kind: 'toggle', value: null}, query: {kind: 'text', value: ''},
    failed: {kind: 'values', included: [], excluded: [], mode: 'any', allowAll: false, status: 'error', values: []},
  };
  const ids = Object.keys(fields);
  return {calls, value: {focusPrefix: prefix, labels: {field: (field: any) => field.id},
    model: {groups: [{id: 'title', fields: (reverse ? ids.reverse() : ids).map(id => ({id}))}]}, fields, openFields: ids,
    more: {title: {fields: ['tag'], summary: 'Tag', open: true, onOpenChange: (value: boolean) => calls.push(['more', value])}},
    onFieldOpenChange: (...args: any[]) => calls.push(['open', ...args]), onFieldChange: (...args: any[]) => calls.push(['change', ...args]),
    onSearchChange: (...args: any[]) => calls.push(['search', ...args]), onShowAll: (id: string) => calls.push(['all', id]), onRetry: (id: string) => calls.push(['retry', id])}};
}

for (const isTV of [true, false]) test(`${isTV ? 'TV' : 'phone'} real FilterBuilder controls register distinct semantic IDs under a real FocusRegion`, async () => {
  const mod = await fixture(isTV), registry = registryModule.createFocusRegistry(), prefix = 'actual-authority/library-id/filters';
  const data = props(prefix), tree = mountTree(React.createElement(mod.FocusProvider, {registry}, React.createElement(mod.FocusRegion, {id: prefix}, React.createElement(mod.FilterBuilder, data.value))));
  let ids: string[];
  try {
    assert.ok(tree.controls.length > 16, 'all field control kinds and nested rare fields must mount');
    ids = tree.controls.map(node => node.props.testID);
    assert.ok(ids.every(id => typeof id === 'string' && id.length > 0)); assert.equal(new Set(ids).size, ids.length);
    assert.equal(registry.order(prefix).length, tree.controls.filter(node => !node.props.disabled).length, 'every enabled actual native host registers exactly once');
    for (const id of registry.order(prefix)) assert.ok(registry.child({regionId: prefix, childId: id}));
    const facet = tree.controls.find(node => node.props.accessibilityRole === 'checkbox' && text(node).startsWith('Shared value'))!;
    facet.props.onPress({defaultPrevented: false});
    assert.deepEqual(data.calls.at(-1), ['change', 'genre', {kind: 'values', mode: 'any', included: ['same/value'], excluded: []}]);
    const yes = tree.controls.find(node => node.props.accessibilityRole === 'radio' && text(node) === 'Yes')!;
    yes.props.onPress({defaultPrevented: false}); assert.deepEqual(data.calls.at(-1), ['change', 'favorite', {kind: 'toggle', value: true}]);
    tree.controls.find(node => text(node) === 'Try again')!.props.onPress({defaultPrevented: false}); assert.deepEqual(data.calls.at(-1), ['retry', 'failed']);
    tree.controls.find(node => text(node) === 'All genres')!.props.onPress({defaultPrevented: false}); assert.deepEqual(data.calls.at(-1), ['all', 'genre']);
    const input = tree.controls.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'query')!;
    input.props.onChangeText('real field value'); assert.deepEqual(data.calls.at(-1), ['change', 'query', {kind: 'text', value: 'real field value'}]);
  } finally {tree.dispose();}
  assert.deepEqual(registry.order(prefix), [], 'actual host/region cleanup removes registrations');
  const reordered = mountTree(React.createElement(mod.FocusProvider, {registry}, React.createElement(mod.FocusRegion, {id: prefix}, React.createElement(mod.FilterBuilder, props(prefix, true).value))));
  try {assert.deepEqual(reordered.controls.map(node => node.props.testID).sort(), ids!.sort(), 'field/facet order changes cannot change the semantic IDs');}
  finally {reordered.dispose();}
});

test('omitting the optional prefix preserves the existing unfocused control geometry and callbacks', async () => {
  const mod = await fixture(false), unscoped = props(), scoped = props('actual-library/filters');
  const before = mountTree(React.createElement(mod.FilterBuilder, unscoped.value)), after = mountTree(React.createElement(mod.FilterBuilder, scoped.value));
  const project = (node: Node) => ({type: node.type, text: text(node), disabled: node.props.disabled, role: node.props.accessibilityRole, state: node.props.accessibilityState,
    style: typeof node.props.style === 'function' ? node.props.style({pressed: false, hovered: false}) : node.props.style});
  try {
    assert.ok(before.controls.every(node => node.props.testID === undefined));
    assert.deepEqual(after.controls.map(project), before.controls.map(project), 'the additive API changes identity only');
    before.controls.find(node => node.props.accessibilityRole === 'checkbox' && text(node).startsWith('Shared value'))!.props.onPress({defaultPrevented: false});
    assert.deepEqual(unscoped.calls.at(-1), ['change', 'genre', {kind: 'values', mode: 'any', included: ['same/value'], excluded: []}]);
  } finally {before.dispose(); after.dispose();}
});

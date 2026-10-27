import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {focusSpec} from '@portico/design';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme, nativeType, fontFamilies} from '../src-next/kit/theme';
import * as registryModule from '../src-next/kit/focus/registry';
import * as hostRef from '../src-next/kit/focus/useHostRef';
import * as destination from '../src-next/kit/focus/destination-entry';
import * as rowState from '../src-next/kit/layout/row-state';
import * as layoutTypes from '../src-next/kit/layout/types';
import * as controlModel from '../src-next/kit/controls/control-model';
import {useTVBusyEntryRevision} from '../src-next/tv/auth/entry-revision';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const flush = async () => {await act(() => {});};
/** Actual region/target/ref/entry/paint hooks; only animation, scrolling and native handles are controlled. */
async function bindings() {
  const contexts: any[] = [], registry = registryModule.createFocusRegistry(), theme = createTheme({isTV: true, width: 1920});
  const react: any = {...React, createContext: (current: any) => {const context = {current, Provider: 'Provider'}; contexts.push(context); return context;}, useContext: (context: any) => context.current}; react.default = react;
  const flatten = (value: any): any => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value ?? {};
  const listeners = new Set<(event: any) => void>();
  const native = {Platform: {OS: 'android', isTV: true}, View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', TVFocusGuideView: 'Guide',
    BackHandler: {addEventListener: () => ({remove() {}})}, useWindowDimensions: () => ({width: 1920, height: 1080}),
    TVEventHandler: {addListener: (listener: (event: any) => void) => {listeners.add(listener); return {remove: () => listeners.delete(listener)};}},
    findNodeHandle: (host: any) => host.nativeTag, StyleSheet: {create: (value: any) => value, flatten, absoluteFill: {position: 'absolute'}}};
  const focus = {...await screenModule(new URL('../src-next/kit/focus/FocusRegion.tsx', import.meta.url), {react, 'react-native': native, '../theme': {useTheme: () => theme}, './registry': registryModule, './useHostRef': hostRef}), focusTestID: registryModule.focusTestID};
  contexts[0].current = registry;
  const paint = await screenModule(new URL('../src-next/kit/overlays/OverlayPaintContext.tsx', import.meta.url), {react});
  const animation = {default: {View: 'AnimatedView', ScrollView: 'AnimatedScrollView', createAnimatedComponent: (component: any) => component},
    useAnimatedStyle: (fn: () => any) => fn(), useSharedValue: (value: any) => React.useRef({value}).current, withTiming: (value: any) => value,
    useAnimatedScrollHandler: (fn: any) => fn, runOnJS: (fn: any) => fn};
  const {Focusable} = await screenModule(new URL('../src-next/kit/controls/Focusable.tsx', import.meta.url), {react, 'react-native': native, 'react-native-reanimated': animation,
    '@portico/design': {focusSpec}, '../theme': {useTheme: () => theme}, '../focus': focus, './control-model': controlModel,
    '../useMotion': {useMotion: () => ({transforms: false, reduce: true, timing: () => ({})})}, './useFocusedMenu': {useFocusedMenu() {}},
    '../overlays/OverlayPaintContext': paint, '../dev-observation': {useNativeObservation: (_: any, ref: any) => ({ref, recordFocus() {}, recordDeclaredStyle() {}})}});
  const entry = await screenModule(new URL('../src-next/kit/focus/useDestinationEntryFocus.ts', import.meta.url), {react, './FocusRegion': focus, './destination-entry': destination});
  const drivers: ReturnType<typeof createHookHost>[] = []; let tag = 1;
  function region(get: () => any) {
    let outer: any, guide: any;
    const a = createHookHost(() => {outer = focus.FocusRegion.render(get(), null);}); a.mount(); drivers.push(a);
    const b = createHookHost(() => {contexts[1].current = undefined; contexts[2].current = undefined; guide = outer.type.render(outer.props, null);}); b.mount(); drivers.push(b);
    guide.props.ref({nativeTag: tag++, requestTVFocus() {}, setDestinations() {}});
    return {get guide() {return guide;}, refresh() {a.rerender(); b.rerender();}};
  }
  function target(regionId: string, get: () => any, item?: any) {
    let pressable: any, calls = 0;
    const driver = createHookHost(() => {
      contexts[1].current = regionId; contexts[2].current = item;
      const bound = Focusable.render(get(), null); pressable = bound.type.render(bound.props, bound.props.ref);
    }); driver.mount(); drivers.push(driver);
    const host = {nativeTag: tag++, requestTVFocus() {calls++;}}; pressable.props.ref(host); driver.flush();
    return {host, get calls() {return calls;}, get props() {return pressable.props;}, refresh() {driver.rerender();}};
  }
  return {react, native, animation, focus, paint, theme, registry, contexts, Focusable, entry, listeners, drivers, region, target,
    dispose() {for (const driver of drivers.splice(0).reverse()) driver.unmount();}};
}

test('DoorTiles original helper enters once, retains Setup host through busy, and INERT wins', async () => {
  const b = await bindings(); let busy = false, tree: any, door: any, joined = 0; const isCurrent = () => true;
  const {TVNoServers} = await screenModule(new URL('../src-next/screens/accounts/TVNoServers.tsx', import.meta.url), {react: b.react, 'react-native': b.native,
    'react-native-qrcode-svg': {default: 'QR'}, '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/focus': b.focus,
    '../search/TVKeyboard': {NativeTVKeyboard: 'Keyboard'}, '../../kit/artwork': {ColourBackdrop: 'Backdrop'},
    '../../kit/controls': {Focusable: b.Focusable, Button: 'Button', TextField: 'TextField'}, '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/theme': {useTheme: () => b.theme, nativeType}, '../destinations/useEntryFocus': b.entry,
    '../../shell/model': {shellLayout: () => ({left: 0, top: 0, width: 1920, height: 1080, scale: 1})}, '../../tv/auth/entry-revision': {useTVBusyEntryRevision}});
  const parent = createHookHost(() => {tree = TVNoServers({busy, isCurrent, onJoin() {}, onFind() {}, onRefresh() {}, onSignOut() {}, onBack() {}});}); parent.mount();
  const original = () => nodes(tree).find(node => node.type?.name === 'DoorTiles');
  let doorDriver = createHookHost(() => {const node = original(); door = node.type({...node.props, onJoin: () => {joined++;}});}); doorDriver.mount();
  const region = b.region(() => door.props), tile = (id: string) => nodes(door).find(node => node.type === b.Focusable && node.props.focusId === id).props;
  const join = b.target('accounts.empty.door', () => tile('join')), setup = b.target('accounts.empty.door', () => tile('setup'));
  try {
    await flush(); assert.equal(join.calls, 1); assert.equal(setup.calls, 0); assert.equal(join.props.hasTVPreferredFocus, undefined);
    const joinRef = join.props.ref, setupRef = setup.props.ref;
    setup.props.onFocus({}); await flush(); assert.equal(b.registry.capture()?.childId, 'setup');
    for (busy of [true, false, true, false]) {
      parent.rerender(); doorDriver.rerender(); region.refresh(); join.refresh(); setup.refresh(); await flush();
      assert.equal(b.registry.child({regionId: 'accounts.empty.door', childId: 'setup'}), setup.host);
      assert.equal(join.props.ref, joinRef); assert.equal(setup.props.ref, setupRef); assert.equal(join.calls, 1, 'busy never requests Join again');
      assert.equal(b.registry.capture()?.childId, 'setup'); assert.equal(setup.props.onPress, undefined, 'Setup never becomes a command');
      assert.equal(join.props.disabled, false); assert.equal(typeof join.props.onPress, busy ? 'undefined' : 'function');
    }
    b.paint.OverlayPaintModeContext.current = b.paint.OVERLAY_PAINT_INERT; join.refresh(); setup.refresh();
    assert.equal(join.props.disabled, true); assert.equal(join.props.onPress, undefined); assert.equal(b.registry.child({regionId: 'accounts.empty.door', childId: 'setup'}), undefined);
    b.paint.OverlayPaintModeContext.current = b.paint.OVERLAY_PAINT_LIVE; join.refresh(); setup.refresh(); await flush();
    assert.equal(b.registry.child({regionId: 'accounts.empty.door', childId: 'setup'}), setup.host); assert.equal(join.calls, 1);
    join.props.onPress(); assert.equal(joined, 1);
    doorDriver.unmount(); b.dispose();
    doorDriver = createHookHost(() => {const node = original(); door = node.type(node.props);}); doorDriver.mount();
    b.region(() => door.props);
    const newJoin = b.target('accounts.empty.door', () => tile('join')); b.target('accounts.empty.door', () => tile('setup')); await flush();
    assert.notEqual(newJoin.host, join.host); assert.equal(newJoin.calls, 1, 'a genuine tile/guide/host remount has its own entry receipt');
    newJoin.props.onFocus({}); assert.equal(b.registry.capture()?.childId, 'join');
  } finally {doorDriver.unmount(); parent.unmount(); b.dispose();}
});

async function rowComposition(b: Awaited<ReturnType<typeof bindings>>) {
  const page = await screenModule(new URL('../src-next/kit/focus/page-boundary.ts', import.meta.url), {react: b.react, 'react-native': b.native});
  const row = await screenModule(new URL('../src-next/kit/layout/Row.tsx', import.meta.url), {react: b.react, 'react-native': b.native,
    'react-native-svg': {default: 'Svg', Defs: 'Defs', LinearGradient: 'Gradient', Rect: 'Rect', Stop: 'Stop'}, 'react-native-reanimated': b.animation,
    '../../../../../packages/i18n/src': {defaultI18n}, '../Icon': {Icon: 'Icon'}, '../theme': {useTheme: () => b.theme}, '../focus': b.focus, './row-state': rowState,
    '../focus/page-boundary': page, './FocusAnchor': {useFocusAnchor: () => ({anchor() {}, repeating: false, offset: {value: 0}, scrollRef: {current: null}, stop() {}, move() {}})},
    './MotionItem': {MotionItem: 'MotionItem'}, './types': layoutTypes});
  const shelf = await screenModule(new URL('../src-next/tv/layout/TVShelf.tsx', import.meta.url), {react: b.react, '../../kit/layout/Row': row});
  const people = await screenModule(new URL('../src-next/screens/watch/TitlePeople.tsx', import.meta.url), {react: b.react, 'react-native': b.native,
    '../../kit/artwork': {Artwork: 'Artwork', PersonCircle: 'PersonCircle'}, '../../tv/layout/TVShelf': shelf, '../../tv/layout/TVArtFocus': {TVArtFocus: 'TVArtFocus'},
    '../../kit/controls': {Focusable: b.Focusable}, '../../kit/theme': {useTheme: () => b.theme, nativeType, fontFamilies}});
  return {row, shelf, people};
}

for (const [name, actionable] of [['leading', [false, true, true]], ['interleaved', [true, false, true]], ['tail', [true, true, false]], ['all-inert', [false, false, false]]] as const) {
  test(`actual TitlePeople/Shelf/Row ${name} preserves paint and binds only actionable native stops`, async () => {
    const b = await bindings(), c = await rowComposition(b); let tree: any; const commands: string[] = [];
    const credits = actionable.map((active, index) => ({id: `credit-${index}`, name: `Name ${index}`, role: 'Actor', ...(active ? {personId: `person-${index}`} : {})}));
    const people = c.people.TitlePeople({credits, artwork: () => undefined, onPerson: (id: string) => commands.push(id), focus: {id: 'cast', edges: {left: 'rail', right: 'next'}}});
    const shelf = people.type(people.props), wrapper = shelf.type({...shelf.props, initialViewportWidth: 1920}), row = wrapper.props.children;
    const driver = createHookHost(() => {tree = row.type(row.props);}); driver.mount();
    const regionNode = nodes(tree).find(node => node.type?.name === 'RowRegion'), declared = regionNode.type(regionNode.props);
    const guide = b.region(() => declared.props), rail = {nativeTag: 900, requestTVFocus() {}}, next = {nativeTag: 901, requestTVFocus() {}};
    b.registry.attachRegion('rail', rail); b.registry.attachRegion('next', next);
    const slots = nodes(tree).filter(node => node.type === b.focus.FocusItem), targets: ReturnType<typeof b.target>[] = [];
    try {
      assert.deepEqual(slots.map(slot => slot.props.focusId), credits.map(credit => credit.id), 'all original paint identities remain');
      for (const slot of slots) if (slot.props.children.type === b.Focusable) targets.push(b.target('cast', () => slot.props.children.props, b.focus.FocusItem(slot.props).props.value));
      await flush(); for (const target of targets) target.refresh();
      const order = credits.filter((_, i) => actionable[i]).map(credit => credit.id);
      assert.deepEqual(b.registry.config('cast')?.order, order); assert.equal(guide.guide.props.focusable, order.length > 0);
      if (!order.length) {assert.equal(b.registry.entryTarget('cast'), undefined); return;}
      assert.equal(b.registry.entryTarget('cast'), targets[0]!.host); assert.equal(targets[0]!.props.nextFocusLeft, 900);
      assert.equal(targets.at(-1)!.props.nextFocusRight, 901);
      if (targets.length > 1) {assert.equal(targets.at(-1)!.props.nextFocusLeft, undefined); assert.equal(targets[0]!.props.nextFocusRight, undefined);}
      targets[0]!.props.onPress(); assert.deepEqual(commands, [credits.find((_, i) => actionable[i])!.personId]);
    } finally {driver.unmount(); b.dispose();}
  });
}

test('Row predicate preserves waiting host while actual page boundary belongs only to usable nonwaiting tail; defaults retain explicit entry', async () => {
  const b = await bindings(), {row} = await rowComposition(b); let tree: any, retries = 0;
  const items = [{id: 'inert', active: false}, {id: 'usable', active: true}, {id: 'tail', active: false}];
  const props: any = {title: '', items, getKey: (item: any) => item.id, isFocusable: (item: any) => item.active, itemWidth: 100, itemHeight: 100, initialViewportWidth: 500,
    selection: {active: false, isSelected: () => false, onToggle() {}, onEnter() {}}, focus: {id: 'paged', entry: 'inert'},
    paging: {waitingId: 'cursor', waitingItem: {id: 'waiting', active: false}, hasMore: true, failed: false, loading: true, requestNext: () => {retries++;}},
    renderItem: (_: any, slot: any) => React.createElement(b.Focusable, {focusId: slot.focusId})};
  const wrapped = row.Row(props), content = wrapped.props.children; let current = content.props;
  const driver = createHookHost(() => {tree = content.type(current);}); driver.mount();
  let regionNode = nodes(tree).find(node => node.type?.name === 'RowRegion'), declared = regionNode.type(regionNode.props);
  const guide = b.region(() => declared.props);
  try {
    assert.deepEqual(b.registry.config('paged')?.order, ['usable', 'cursor']);
    const usable = b.target('paged', () => ({focusId: 'usable'})), waiting = b.target('paged', () => ({focusId: 'cursor'})); await flush();
    assert.equal(b.registry.child({regionId: 'paged', childId: 'cursor'}), waiting.host);
    current = {...current, paging: {...current.paging, failed: true, loading: false}}; driver.rerender();
    regionNode = nodes(tree).find(node => node.type?.name === 'RowRegion'); declared = regionNode.type(regionNode.props); guide.refresh();
    waiting.props.ref(null); assert.equal(b.registry.child({regionId: 'paged', childId: 'cursor'}), undefined);
    assert.deepEqual(b.registry.config('paged')?.order, ['usable']);
    const before = retries;
    for (const target of [waiting, usable]) {
      target.props.onFocus({}); for (const listener of b.listeners) {listener({eventType: 'right', eventKeyAction: 0, tag: target.host.nativeTag}); listener({eventType: 'right', eventKeyAction: 1});}
    }
    assert.equal(retries, before + 1, 'waiting and inert paint tail never own the retry boundary');
    current = {...current, items: items.filter(item => !item.active)}; driver.rerender();
    assert.equal(b.listeners.size, 0, 'no usable nonwaiting slot means no boundary listener');
    current = {...current, isFocusable: undefined, focus: {id: 'paged', entry: 'external-entry'}}; driver.rerender();
    regionNode = nodes(tree).find(node => node.type?.name === 'RowRegion'); declared = regionNode.type(regionNode.props); guide.refresh();
    assert.equal(b.registry.config('paged')?.entry, 'external-entry', 'default entry remains unchanged outside declared paint order');
    assert.deepEqual(b.registry.config('paged')?.order, ['inert', 'tail']);
  } finally {driver.unmount(); b.dispose();}
});

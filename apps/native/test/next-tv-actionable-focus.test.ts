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
  let instance = 0;
  const contexts: any[] = [], registry = registryModule.createFocusRegistry(), theme = createTheme({isTV: true, width: 1920});
  const react: any = {...React, useId: () => React.useRef(`native-instance-${++instance}`).current, createContext: (current: any) => {const context = {current, Provider: 'Provider'}; contexts.push(context); return context;}, useContext: (context: any) => context.current}; react.default = react;
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
    return {get guide() {return guide;}, refresh() {a.rerender(); b.rerender();}, dispose() {b.unmount(); a.unmount();}};
  }
  function target(regionId: string, get: () => any, item?: any) {
    let pressable: any, calls = 0;
    const driver = createHookHost(() => {
      contexts[1].current = regionId; contexts[2].current = item;
      const props = get(), bound = Focusable.render(props, props.ref ?? null); pressable = bound.type.render(bound.props, bound.props.ref);
    }); driver.mount(); drivers.push(driver);
    const host = {nativeTag: tag++, requestTVFocus() {calls++;}}; pressable.props.ref(host); driver.flush();
    return {host, get calls() {return calls;}, get props() {return pressable.props;}, refresh() {driver.rerender();}, dispose() {driver.unmount();}};
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

async function overlayBindings(b: Awaited<ReturnType<typeof bindings>>) {
  const geometry = await import('../src-next/kit/overlays/geometry');
  const stack = await import('../src-next/kit/overlays/overlay-stack');
  const anchored = await import('../src-next/kit/overlays/anchored-menu-geometry');
  const touch = await import('../src-next/kit/browse/touch-menu-geometry');
  const canvas = await import('../src-next/platform/layout/tv-canvas');
  const design = await import('@portico/design');
  const back = new Set<() => boolean>();
  const native = {...b.native, Modal: 'Modal', Keyboard: {addListener: () => ({remove() {}})}, BackHandler: {addEventListener: (_: any, fn: () => boolean) => {back.add(fn); return {remove: () => back.delete(fn)};}}};
  const motion = {useMotion: () => ({transforms: false, reduce: true, timing: () => ({}), spring: () => ({})})};
  const animation = {...b.animation, cancelAnimation() {}, withSpring: (value: any) => value};
  const svg = {default: 'Svg', Defs: 'Defs', LinearGradient: 'Gradient', RadialGradient: 'Gradient', Rect: 'Rect', Stop: 'Stop'};
  const host = await screenModule(new URL('../src-next/kit/overlays/OverlayHost.tsx', import.meta.url), {
    react: b.react, 'react-native': native, '../../platform/overlay-keys': {registerOverlayKeys: () => () => {}}, '../../platform/tv-menu': {captureTVMenuKey: () => () => {}},
    './OverlayPaintContext': b.paint, '../theme': {useTheme: () => b.theme}, '../focus': {...b.focus, requestNativeFocus: registryModule.requestNativeFocus}, './geometry': geometry, './overlay-stack': stack});
  const {Button} = await screenModule(new URL('../src-next/kit/controls/Button.tsx', import.meta.url), {react: b.react, 'react-native': native,
    '@portico/design': design, '../../platform/native-blur': {glassRecipe: () => ({nativeBlur: false}), BlurView: 'Blur'}, '../Icon': {Icon: 'Icon'},
    '../theme': {useTheme: () => b.theme}, './Focusable': {Focusable: b.Focusable}, './control-model': controlModel,
    '../dev-observation': {useNativeObservation: (_: any, ref: any) => ({ref, textProps: {}, recordFocus() {}, recordDeclaredStyle() {}})}});
  const common = {react: b.react, 'react-native': native, 'react-native-reanimated': animation, 'react-native-svg': svg,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, left: 0, right: 0, bottom: 0})},
    '../../../../../packages/i18n/src/index': {defaultI18n}, '../controls/Button': {Button}, '../controls/Focusable': {Focusable: b.Focusable},
    '../focus': b.focus, '../Icon': {Icon: 'Icon'}, '../theme': {useTheme: () => b.theme, nativeType}, '../useMotion': motion,
    './OverlayHost': host, './OverlayPaintContext': b.paint, './TVDesignCanvas': {TVDesignCanvas: 'DesignCanvas'}};
  const surface = await screenModule(new URL('../src-next/kit/overlays/surface.tsx', import.meta.url), {...common, '../../platform/layout/tv-canvas': canvas, './BottomSheet': {BottomSheet: 'UnusedTouchSheet'}});
  const pan: any = new Proxy({}, {get: () => () => pan});
  const sheet = await screenModule(new URL('../src-next/kit/overlays/BottomSheet.tsx', import.meta.url), {...common, './surface': surface, './geometry': geometry,
    'react-native-gesture-handler': {Gesture: {Pan: () => pan}, GestureDetector: 'Gesture'}});
  const menu = await screenModule(new URL('../src-next/kit/overlays/Menu.tsx', import.meta.url), {...common, './surface': surface, './BottomSheet': sheet, './geometry': geometry,
    '../../platform/native-blur': {glassRecipe: () => ({nativeBlur: false}), BlurView: 'Blur'}, './anchored-menu-geometry': anchored, '../browse/touch-menu-geometry': touch});
  return {menu, surface, sheet, host, Button, back};
}

for (const kind of ['library', 'home'] as const) test(`${kind} actual sort overlay scopes real rows and returns to its original opener`, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const b = await bindings(), o = await overlayBindings(b);
  const presentation = await import('../src-next/kit/browse/presentation');
  const direction = await import('../../../packages/client-core/src/presentation/browse-toolbar');
  const controls = {Button: o.Button, Focusable: b.Focusable, Chip: 'UnusedChip', Segmented: 'Segmented'};
  const modules = {react: b.react, 'react-native': {...b.native, useWindowDimensions: () => ({width: 1920, height: 1080})},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/browse-toolbar': direction,
    '../controls': controls, '../../kit/controls': controls, '../overlays': o.menu, '../../kit/overlays': o.menu,
    '../Icon': {Icon: 'Icon'}, '../../kit/Icon': {Icon: 'Icon'}, '../theme': {useTheme: () => b.theme}, '../../kit/theme': {useTheme: () => b.theme},
    './presentation': presentation, '../../kit/browse/presentation': presentation};
  const file = kind === 'library' ? '../src-next/screens/library/LibrarySortMenu.tsx' : '../src-next/kit/browse/Toolbar.tsx';
  const mod = await screenModule(new URL(file, import.meta.url), modules), component = kind === 'library' ? mod.LibrarySortMenu : mod.SortMenu;
  let tree: any, overlay: any, changes = 0;
  const scope = `${kind}:original-authority:original-route`, props: any = {scope, focusScope: scope,
    sorts: [{id: 'title', directions: ['asc', 'desc'], defaultDirection: 'asc'}, {id: 'added', directions: ['desc'], defaultDirection: 'desc'}],
    value: {field: 'title', direction: 'asc', flippable: true}, label: (value: any) => value.id, onValueChange: () => {changes++;}, onReshuffle() {}};
  const source = createHookHost(() => {tree = component(props);}); source.mount();
  const anchor = nodes(tree).find(node => node.type === b.Focusable).props.ref;
  let restored = 0; anchor.current = {nativeTag: 800, requestTVFocus() {restored++;}, measureInWindow: (fn: any) => fn(0, 0, 40, 40)};
  nodes(tree).find(node => node.type === b.Focusable).props.onPress(); source.rerender();
  let popover = nodes(tree).find(node => node.type === o.menu.Popover);
  const renderer = createHookHost(() => {overlay = o.menu.Popover(popover.props);}); renderer.mount(); renderer.flush();
  const boundary = nodes(overlay).find(node => node.type === o.surface.FocusBoundary), actual = boundary.type(boundary.props);
  const guide = b.region(() => actual.props);
  const rows = nodes(tree).filter(node => node.type === o.menu.MenuRow);
  // These are the actual MenuRow→Focusable hosts, not declarations copied into a registry.
  const targets = rows.map(row => b.target(actual.props.id, () => row.type.render(row.props, row.props.ref).props));
  try {
    assert.equal(guide.guide.props.testID, `portico.region.${encodeURIComponent(scope + '.sort-menu')}`);
    assert.deepEqual(rows.map(row => row.props.focusId), ['sort:title', 'sort:added']);
    const segmented = nodes(tree).find(node => node.type === 'Segmented');
    assert.deepEqual(['asc', 'desc'].map(value => segmented.props.itemProps({value}).focusId), ['order:asc', 'order:desc']);
    assert.equal(new Set(targets.map(target => target.props.testID)).size, 2);
    targets[1]!.props.onPress(); source.rerender(); assert.equal(changes, 1);
    popover = nodes(tree).find(node => node.type === o.menu.Popover); renderer.rerender();
    t.mock.timers.tick(500); renderer.rerender(); assert.equal(restored, 1, 'actual lifecycle restores the captured original anchor');
    props.focusScope = props.scope = scope + ':retained-second'; source.rerender();
    assert.notEqual(nodes(tree).find(node => node.type === o.menu.Popover).props.testID, actual.props.id);
  } finally {renderer.unmount(); source.unmount(); b.dispose(); t.mock.timers.reset();}
});

async function mountActualMenu(b: Awaited<ReturnType<typeof bindings>>, o: Awaited<ReturnType<typeof overlayBindings>>, get: () => any) {
  let menuTree: any, sheetTree: any;
  const menuDriver = createHookHost(() => {menuTree = o.menu.Menu(get());}); menuDriver.mount();
  const sheetDriver = createHookHost(() => {sheetTree = menuTree.type(menuTree.props);}); sheetDriver.mount();
  const boundary = nodes(sheetTree).find(node => node.type === o.surface.FocusBoundary), declaration = boundary.type(boundary.props);
  const guide = b.region(() => declaration.props);
  const rows = nodes(menuTree).filter(node => node.type === o.menu.MenuRow);
  const targets = rows.map(row => b.target(declaration.props.id, () => row.type.render(row.props, row.props.ref).props));
  return {guide, rows, targets, refresh() {menuDriver.rerender(); sheetDriver.rerender();}, dispose() {sheetDriver.unmount(); menuDriver.unmount();}};
}

test('season caller supplies its actual section root to the real Menu and Back restores the season host', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const b = await bindings(), o = await overlayBindings(b);
  const labels = await import('../../../packages/client-core/src/presentation/kit-model');
  const words = await import('../../../packages/client-core/src/presentation/kit-model/text');
  const regionMap = await import('../src-next/screens/watch/tv-title-focus');
  const presentation = await import('../src-next/kit/browse/presentation');
  const {TVEpisodeBrowser} = await screenModule(new URL('../src-next/screens/watch/TVEpisodeBrowser.tsx', import.meta.url), {react: b.react, 'react-native': b.native,
    '../../../../../packages/client-core/src/presentation/kit-model': labels, '../../../../../packages/client-core/src/presentation/kit-model/text': words,
    '../../../../../packages/i18n/src': {defaultI18n}, './tv-title-focus': regionMap, '../../kit/focus': b.focus,
    '../../tv/layout/TVShelf': {TVShelf: 'Shelf', tvItemKey: (entry: any) => entry.id}, '../../kit/controls': {Focusable: b.Focusable},
    '../../kit/cards': {EpisodeTile: 'EpisodeTile'}, '../../kit/overlays': o.menu, '../../kit/browse/presentation': presentation, '../../kit/theme': {useTheme: () => b.theme}});
  let tree: any, section = {id: 'original-show.episodes'}, commands = 0;
  const props: any = {seasons: [{id: 'season', showId: 'show', number: 1, episodeCount: 3, watchedCount: 1}], selectedSeasonId: 'season', episodes: [], show: {title: 'Show'},
    open: {phase: 'idle'}, text: {t: defaultI18n.t}, artwork: () => undefined, more() {}, onSeasonFocus() {}, onEpisodeFocus() {}, onSelectSeason() {},
    onPlayEpisode() {}, onPlaySeason() {commands++;}, onMarkSeason() {}, onMoreSeasons() {}, onMoreEpisodes() {}, onRetryEpisode() {}, renderError: () => null};
  const source = createHookHost(() => {tree = TVEpisodeBrowser({...props, focus: section});}); source.mount();
  const season = () => nodes(tree).find(node => node.type === b.Focusable && node.props.testID === 'tv-season-season');
  const seasonRegion = nodes(tree).find(node => node.type === b.focus.FocusRegion && node.props.id.endsWith('.seasons'));
  b.region(() => seasonRegion.props); const opener = b.target(seasonRegion.props.id, () => season().props); opener.props.onFocus({});
  season().props.onLongPressAction(); source.rerender();
  const menu = () => nodes(tree).find(node => node.type === o.menu.Menu).props;
  const mounted = await mountActualMenu(b, o, menu);
  try {
    assert.equal(menu().testID, 'original-show.episodes.season-menu');
    t.mock.timers.tick(160); assert.equal(mounted.targets[0]!.calls, 1, 'actual safe initial ref requests its real native host');
    assert.equal(new Set(mounted.targets.map(target => target.props.testID)).size, 2);
    assert.equal([...o.back][0]!(), true); source.rerender(); mounted.refresh(); t.mock.timers.tick(500); mounted.refresh();
    assert.equal(opener.calls, 1, 'actual lifecycle restores the original season address'); assert.equal(commands, 0);
    section = {id: 'retained-other-show.episodes'}; source.rerender();
    assert.equal(menu().testID, 'retained-other-show.episodes.season-menu');
  } finally {mounted.dispose(); source.unmount(); b.dispose(); t.mock.timers.reset();}
});

test('TV Saved caller passes original grid sort/filter roots through actual Menu and real host identities', async () => {
  const b = await bindings(), o = await overlayBindings(b);
  const buckets = await import('../../../packages/client-core/src/browse-buckets');
  const saved = await import('../../../packages/client-core/src/saved');
  const {TVSavedScreen} = await screenModule(new URL('../src-next/screens/destinations/saved/TVSavedScreen.tsx', import.meta.url), {
    react: b.react, 'react-native': b.native, '../../../../../../packages/i18n/src': {defaultI18n}, '../../../../../../packages/client-core/src/browse-buckets': buckets,
    '../../../../../../packages/client-core/src/saved': saved, '../../../tv/layout/TVFocusGrid': {TVFocusGrid: 'Grid'}, '../../saved/SavedForms': {SavedConfirmSheet: 'Confirm'},
    '../../library/LibraryJumpSheet': {LibraryJumpSheet: 'Jump'}, '../useTVPageBack': {useTVPageBack() {}}, '../useEntryFocus': {useDestinationEntryFocus() {}},
    '../../../shell/model': {sameAuthority: () => true}, '../../../../../../packages/client-core/src/presentation/kit-model/text': {durationText: String},
    '../../../kit/artwork': {Artwork: 'Artwork'}, '../../../kit/controls': {Button: o.Button, Chip: 'Chip', Focusable: b.Focusable},
    '../../../kit/cards': {PosterCard: 'Poster', SquareCard: 'Square'}, '../../../kit/overlays': {...o.menu, Dialog: 'Dialog'}, '../../../kit/states': {StateView: 'State'},
    '../../../kit/focus': b.focus, '../../../kit/browse/presentation': {browseType: () => ({})}, '../../../kit/theme': {useTheme: () => b.theme},
    '../focus': {nativeDestinationFocusIds: (authority: any) => ({savedTabs: 'tabs', savedGrid: authority.grid, savedToolbar: 'toolbar', rail: 'rail'})},
    '../../saved/SavedTVTabs': {SavedTVTabs: 'Tabs'}, '../../saved/SavedTVDirectory': {SavedTVDirectory: 'Directory'}});
  let tree: any, scope = 'original.saved'; const selected: any[] = [];
  const snapshot = {phase: 'ready', entries: [], resources: [], posters: {sections: []}, squares: {sections: []}};
  const props: any = {controller: {subscribe: () => () => {}, getSnapshot: () => snapshot, source: () => ({}), summary: async () => {}, select: async (...value: any[]) => {selected.push(value);}},
    activation: {subscribe: () => () => {}, getSnapshot: () => ({visible: true})},
    runtime: {reportError() {}, text: {}, artwork: () => undefined, getSnapshot: () => ({libraries: []})}, actions: {isMenuOpen: () => false}, initialTab: 'watchlist',
    openSaved() {}, openEntry() {}, browseHome() {}};
  const source = createHookHost(() => {tree = TVSavedScreen({...props, authority: {grid: scope}});}); source.mount(); selected.length = 0;
  try {
    const menus = () => nodes(tree).filter(node => node.type === o.menu.Menu);
    assert.deepEqual(menus().map(node => node.props.testID), ['original.saved.sort-menu', 'original.saved.filter-menu']);
    for (const node of menus()) {
      let tree: any; const driver = createHookHost(() => {tree = o.menu.Menu({...node.props, open: true});}); driver.mount();
      const actualRows = nodes(tree).filter(node => node.type === o.menu.MenuRow);
      b.region(() => ({id: node.props.testID}));
      const hosts = actualRows.map(row => b.target(node.props.testID, () => row.type.render(row.props, row.props.ref).props));
      assert.ok(hosts.length); assert.equal(new Set(hosts.map(host => host.props.testID)).size, hosts.length);
      hosts[0]!.props.onPress(); driver.unmount();
    }
    assert.equal(selected.length, 2); scope = 'retained.saved'; source.rerender();
    assert.deepEqual(menus().map(node => node.props.testID), ['retained.saved.sort-menu', 'retained.saved.filter-menu']);
  } finally {source.unmount(); b.dispose();}
});

for (const kind of ['person', 'collection'] as const) test(`${kind} actual entity menu retains its original scoped root and command`, async () => {
  const b = await bindings(), o = await overlayBindings(b), presentation = await import('../src-next/kit/browse/presentation');
  const modules = {react: b.react, 'react-native': b.native, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0})},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/artwork': {PersonCircle: 'Person', AmbientArt: 'Ambient', Artwork: 'Artwork'},
    '../../kit/cards': {PosterCard: 'Poster'}, '../../kit/controls': {Button: o.Button, Chip: 'Chip', Focusable: b.Focusable},
    '../../kit/overlays': o.menu, '../../tv/layout/TVShelf': {TVShelf: 'Shelf'}, '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/states': {StateView: 'State'}, '../../kit/browse/presentation': presentation, '../../kit/theme': {useTheme: () => b.theme}};
  const mod = await screenModule(new URL(kind === 'person' ? '../src-next/screens/people/PersonScreen.tsx' : '../src-next/screens/collections/CollectionScreen.tsx', import.meta.url), modules);
  const component = kind === 'person' ? mod.TVPerson : mod.NativeCollectionScreen;
  let tree: any, scope = `${kind}:original-authority:original-entity`, commands = 0;
  const person = {page: {person: {id: 'person', name: 'Person', roles: [], knownFor: []}, pageInfo: {total: 0}}, role: 'all',
    collection: {pageOf: () => 0, subscribe: () => () => {}, subscribePage: () => () => {}, getSnapshot: () => ({generation: 1, total: 0, status: 'ready'}), getPageVersion: () => 0, ensureRange() {}},
    actions: {}, onRole: () => {commands++;}};
  const collection = {state: {phase: 'ready', title: 'Collection', entries: [], totalCount: 0,
    sorts: [{id: 'title', labelKey: 'next.browse.native.sort', directions: ['asc']}, {id: 'added', labelKey: 'next.browse.native.sort', directions: ['desc']}], sort: 'title'},
    onPlay() {}, onShuffle() {}, onSort: () => {commands++;}, onOpen() {}, onRetry() {}, onMore() {}};
  const props = {...(kind === 'person' ? person : collection), runtime: {ambient: () => undefined, artwork: () => undefined}, onBack() {}};
  const source = createHookHost(() => {tree = component({...props, focusScope: scope});}); source.mount();
  try {
    const menu = nodes(tree).find(node => node.type === o.menu.Menu), expected = `${scope}.${kind === 'person' ? 'role-filter' : 'sort-menu'}`;
    assert.equal(menu.props.testID, expected);
    b.region(() => ({id: expected})); let real: any;
    const menuDriver = createHookHost(() => {real = o.menu.Menu({...menu.props, open: true});}); menuDriver.mount();
    const rows = nodes(real).filter(node => node.type === o.menu.MenuRow);
    const hosts = rows.map(row => b.target(expected, () => row.type.render(row.props, row.props.ref).props));
    assert.equal(new Set(hosts.map(host => host.props.testID)).size, rows.length); assert.ok(hosts.length > 1);
    hosts[1]!.props.onPress(); assert.equal(commands, 1); menuDriver.unmount();
    scope += ':retained-other-entity'; source.rerender(); assert.notEqual(nodes(tree).find(node => node.type === o.menu.Menu).props.testID, expected);
  } finally {source.unmount(); b.dispose();}
});

test('MusicMixes actual original caller scope names its panel through failed busy work without enabling commands', async () => {
  const b = await bindings(), o = await overlayBindings(b), presentation = await import('../src-next/kit/browse/presentation');
  const {MusicMixesRow} = await screenModule(new URL('../src-next/screens/destinations/music/MusicMixesRow.tsx', import.meta.url), {
    react: b.react, 'react-native': b.native, 'react-native-svg': {default: 'Svg', Defs: 'Defs', RadialGradient: 'Gradient', Rect: 'Rect', Stop: 'Stop'},
    '../../../../../../packages/i18n/src': {defaultI18n}, '../../../kit/artwork': {Artwork: 'Artwork'}, '../../../kit/controls': {Focusable: b.Focusable},
    '../../../kit/focus': b.focus, '../../../kit/overlays': {...o.menu, SidePanel: o.surface.SidePanel}, '../../../kit/theme': {useTheme: () => b.theme, nativeType},
    '../../../kit/browse/presentation': presentation});
  const row = {id: 'original-mix', name: 'Mix', tint: '#123456', artists: [], more: false, songCount: 20, covers: []};
  const snapshot = {phase: 'ready', rows: [row]}, lifetime = {isCurrent: () => true};
  let reject!: (error: Error) => void, calls = 0, tree: any, mixScope = 'original-library-scope';
  const port = {subscribe: () => () => {}, getSnapshot: () => snapshot, subscribeRevision: () => () => {}, getRevision: () => 1,
    captureCaller: () => ({lifetime, dispose() {}}), load: async () => {}, play: async (_row: any, actual: any) => {assert.equal(actual, lifetime); calls++; await new Promise<void>((_, no) => {reject = no;});}};
  const source = createHookHost(() => {tree = MusicMixesRow({port, artwork: () => undefined, reportError() {}, focusScope: mixScope});}); source.mount(); source.flush();
  const tile = nodes(tree).find(node => node.type?.name === 'MusicMixTile'), opener = {current: {nativeTag: 700, requestTVFocus() {}}};
  tile.props.onMenu(opener); source.rerender();
  const panel = () => nodes(tree).find(node => node.type === o.surface.SidePanel);
  b.region(() => ({id: panel().props.testID}));
  const rows = () => nodes(panel()).filter(node => node.type === o.menu.MenuRow);
  const target = b.target(panel().props.testID, () => rows()[0]!.type.render(rows()[0]!.props, rows()[0]!.props.ref).props);
  try {
    assert.equal(panel().props.testID, 'original-library-scope.original-mix.menu'); assert.equal(panel().props.returnFocusRef, opener);
    target.props.onPress(); mixScope = 'successor-scope'; source.rerender(); target.refresh();
    assert.equal(calls, 1); assert.equal(target.props.onPress, undefined); assert.equal(panel().props.dismissOnBack, false);
    reject(new Error('fixture failure')); await flush(); target.refresh();
    assert.equal(panel().props.testID, 'original-library-scope.original-mix.menu'); assert.equal(typeof target.props.onPress, 'function');
    assert.equal(panel().props.returnFocusRef, opener); assert.equal(calls, 1, 're-enabling the same menu sends no request');
  } finally {source.unmount(); b.dispose();}
});

test('ViewToggle caller binds both actual hosts independently with semantic IDs', async () => {
  const b = await bindings(), o = await overlayBindings(b), presentation = await import('../src-next/kit/browse/presentation');
  const direction = await import('../../../packages/client-core/src/presentation/browse-toolbar');
  const mod = await screenModule(new URL('../src-next/kit/browse/Toolbar.tsx', import.meta.url), {react: b.react, 'react-native': b.native,
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/browse-toolbar': direction,
    '../controls': {Button: o.Button, Focusable: b.Focusable}, '../overlays': o.menu, '../Icon': {Icon: 'Icon'}, '../theme': {useTheme: () => b.theme}, './presentation': presentation});
  const selected: string[] = []; const tree = mod.ViewToggle({value: 'grid', onValueChange: (value: string) => selected.push(value), itemProps: (value: string) => ({focusId: `view:${value}`})});
  b.region(() => ({id: 'actual-toolbar'}));
  const targets = nodes(tree).filter(node => node.type === b.Focusable).map(node => b.target('actual-toolbar', () => node.props));
  try {
    assert.equal(targets.length, 2); assert.notEqual(targets[0]!.props.testID, targets[1]!.props.testID);
    assert.equal(b.registry.child({regionId: 'actual-toolbar', childId: 'view:grid'}), targets[0]!.host);
    assert.equal(b.registry.child({regionId: 'actual-toolbar', childId: 'view:list'}), targets[1]!.host);
    targets[1]!.props.onPress(); assert.deepEqual(selected, ['list']);
  } finally {b.dispose();}
});

test('TV Now Playing names More and Lyrics from the actual mounted instance and restores original More host', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const b = await bindings(), o = await overlayBindings(b), dock = await import('../src-next/kit/dock/model');
  const text = await import('../../../packages/client-core/src/presentation/kit-model/text');
  const {TVNowPlayingScreen} = await screenModule(new URL('../src-next/screens/destinations/music/TVNowPlayingScreen.tsx', import.meta.url), {
    react: b.react, 'react-native': b.native, '../../../../../../packages/i18n/src': {defaultI18n}, '../../../../../../packages/client-core/src/presentation/kit-model/text': text,
    '../../../../../../packages/player-core/src': {sameFence: (a: any, c: any) => a === c}, '../../../kit/artwork': {AmbientArt: 'Ambient', Artwork: 'Artwork'},
    '../../../kit/controls': {Button: o.Button}, '../../../kit/Icon': {Icon: 'Icon'}, '../../../kit/overlays': {...o.menu, SidePanel: o.surface.SidePanel},
    '../../../kit/theme': {useTheme: () => b.theme, nativeType}, '../../../kit/dock/model': dock,
    '../../../shell/model': {shellLayout: () => ({width: 1920, height: 1080, left: 0, top: 0, scale: 1})},
    '../../../platform/playback/equalizer': {nativeEqualizer: {subscribe: () => () => {}, getSnapshot: () => ({supported: true})}},
    '../../../platform/overlay-keys': {registerOverlayKeys: () => () => {}}, '../../watch/Equalizer': {NativeWatchEqualizer: 'Equalizer'},
    './MusicSignal': {MusicSignalLine: 'Signal', MusicSignalSheet: 'SignalSheet'}, './ListeningNotice': {NativeListeningNotice: 'Notice'},
    './NowPlayingQueue': {NowPlayingQueue: 'Queue', nowPlayingQueueRows: () => [], nowPlayingQueueFocusScope: () => '', nowPlayingQueueEditPort: () => undefined},
    './TVMusicFocus': {MusicFocusRegion: b.focus.FocusRegion, TVMusicFocus: 'MusicFocus', TVMusicSeek: 'Seek'}, './TVQueuePolicy': {useTVQueuePolicy: () => ({})},
    '../../../tv/layout/TVPageMotion': {TVPageGroup: 'PageGroup', TVPageTransition: 'Transition', useTVPageMotion: () => ({open: true, ready: true})}});
  const props: any = {occupant: {mode: 'music', playback: {fence: {}, kind: 'music', queue: null, positionSeconds: 5, playing: true},
    presentation: {identity: {title: 'Song', subtitle: []}, durationSeconds: 100, capabilities: {play: true, pause: true, previous: false, next: true}}},
    width: 1920, height: 1080, artwork: () => undefined, onAction() {}, onQueuePlay() {}, onClose() {}, lyrics: React.createElement('Lyrics'), equalizerCopy: {}};
  const wrap = TVNowPlayingScreen(props).props.children; let tree: any, second: any;
  const source = createHookHost(() => {tree = wrap.type(wrap.props);}); source.mount();
  const another = createHookHost(() => {second = wrap.type(wrap.props);}); another.mount();
  const button = (name: string) => nodes(tree).find(node => node.type === o.Button && node.props.testID === `now-playing-${name}`);
  const ref = button('more').props.ref; let restored = 0; ref.current = {nativeTag: 701, requestTVFocus() {restored++;}};
  button('more').props.onPress(); source.rerender();
  const menu = () => nodes(tree).find(node => node.type === o.menu.Menu).props;
  const mounted = await mountActualMenu(b, o, menu);
  try {
    assert.ok(menu().testID.endsWith('.more')); assert.notEqual(menu().testID, nodes(second).find(node => node.type === o.menu.Menu).props.testID);
    assert.equal(menu().returnFocusRef, ref); t.mock.timers.tick(160); assert.equal(mounted.targets[0]!.calls, 1);
    assert.equal([...o.back][0]!(), true); source.rerender(); mounted.refresh(); t.mock.timers.tick(500); mounted.refresh(); assert.equal(restored, 1);
    button('lyrics').props.onPress(); source.rerender();
    const lyrics = nodes(tree).find(node => node.type === o.surface.SidePanel);
    assert.equal(lyrics.props.testID, menu().testID.replace(/\.more$/, '.lyrics'));
    let panel: any; const driver = createHookHost(() => {panel = o.surface.SidePanel(lyrics.props);}); driver.mount();
    const boundary = nodes(panel).find(node => node.type === o.surface.FocusBoundary), actual = boundary.type(boundary.props); b.region(() => actual.props);
    assert.equal(actual.props.id, lyrics.props.testID); driver.unmount();
  } finally {mounted.dispose(); source.unmount(); another.unmount(); b.dispose(); t.mock.timers.reset();}
});

test('Home See all actual toolbar binds sort/filter/kind/quick leaves without changing its captured open callbacks', async () => {
  const b = await bindings(), o = await overlayBindings(b), design = await import('@portico/design');
  const presentation = await import('../src-next/kit/browse/presentation');
  const direction = await import('../../../packages/client-core/src/presentation/browse-toolbar');
  const value = await import('../src-next/kit/controls/useControlValue');
  const model = await import('../src-next/screens/home/see-all-model');
  const {authorityKey} = await import('../src-next/shell/model');
  const {Chip} = await screenModule(new URL('../src-next/kit/controls/Chip.tsx', import.meta.url), {react: b.react, 'react-native': b.native, '@portico/design': design,
    '../Icon': {Icon: 'Icon'}, '../theme': {useTheme: () => b.theme, fontFamilies}, './Focusable': {Focusable: b.Focusable}, './control-model': controlModel, './useControlValue': value});
  const browse = await screenModule(new URL('../src-next/kit/browse/Toolbar.tsx', import.meta.url), {react: b.react, 'react-native': b.native,
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/browse-toolbar': direction,
    '../controls': {Button: o.Button, Chip, Focusable: b.Focusable, Segmented: 'Segmented'}, '../overlays': o.menu, '../Icon': {Icon: 'Icon'}, '../theme': {useTheme: () => b.theme}, './presentation': presentation});
  const sort = {field: 'title', direction: 'asc'}, quick = [{id: 'unwatched', active: false, query: {field: 'watched', operator: 'equals', value: false}}];
  const toolbar = {sorts: [{id: 'title', directions: ['asc', 'desc'], defaultDirection: 'asc'}], sort, quick};
  const {HomeSeeAll} = await screenModule(new URL('../src-next/screens/home/HomeSeeAll.tsx', import.meta.url), {
    react: b.react, 'react-native': b.native, '../../../../../packages/i18n/src': {defaultI18n},
    '../../../../../packages/client-core/src/presentation/kit-model': {browseToolbarModel: () => toolbar},
    '../../../../../packages/client-core/src/presentation/server-text': {serverTextLabel: () => ''}, '../../../../../packages/client-core/src/home-selection': {},
    '../../kit/controls': {Button: o.Button, Chip, Focusable: b.Focusable}, '../../kit/browse': browse, '../../kit/cards/primitives': {CardFrame: 'Card', Parts: 'Parts'},
    '../../kit/artwork': {MediaArt: 'Art', AmbientArt: 'Ambient'}, '../../kit/browse/presentation': presentation, '../../kit/cards': {PosterCard: 'Poster'},
    '../../kit/focus': b.focus, '../../kit/layout': {WindowedGrid: 'Grid'}, '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/states': {LoadingBoundary: 'Boundary', LoadingPaint: 'Paint', SkeletonBlock: 'Skeleton', StateView: 'State'},
    '../../kit/theme': {useTheme: () => b.theme, nativeType}, '../../shell/model': {authorityKey}, './browse-label': {homeBrowseLabel: (value: any) => value.id},
    './see-all-model': model, './model': {}, './row-controller': {}});
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'};
  const state = {phase: 'ready', row: {id: 'original-row', title: 'Row', entries: []}, capabilities: {}, sort, filters: [], counts: [], selectedKind: undefined};
  const calls: any[] = [], open = () => {}, playEntry = () => {};
  const controller = {rowId: 'original-row', subscribe: () => () => {}, getSnapshot: () => state, collection: {subscribe: () => () => {}, getSnapshot: () => ({total: 0})},
    kinds: [{id: 'movies'}], load: async () => {}, selectKind: (id: string) => calls.push(id), setFilters: (filters: any) => calls.push(filters), setSort() {}};
  const runtime = {getSnapshot: () => ({authority, account: {viewerRole: 'member'}}), text: {t: defaultI18n.t, locale: 'en-US'}};
  let wrapper: any, tree: any; const props = {controller, runtime, active: true, onBack() {}, onPlay() {}, onOpen: open, onPlayEntry: playEntry, onFilters: () => calls.push('filters'), kindLabel: (id: string) => id, onReshuffle() {}};
  const parent = createHookHost(() => {wrapper = HomeSeeAll(props);}); parent.mount();
  const child = nodes(wrapper).find(node => node.type?.name === 'HomeSeeAllReady');
  const source = createHookHost(() => {tree = child.type(child.props);}); source.mount();
  const region = nodes(tree).find(node => node.type === b.focus.FocusRegion); b.region(() => region.props);
  const slots = nodes(tree).filter(node => node.type === b.focus.FocusItem);
  const leaf = (element: any): any => {
    if (element.type === b.Focusable) return element.props;
    const rendered = typeof element.type === 'function' ? element.type(element.props) : element.type.render(element.props, element.props.ref);
    const direct = nodes(rendered).find(node => node.type === b.Focusable);
    if (direct) return direct.props;
    const next = nodes(rendered).find(node => node.type === Chip || node.type === o.Button); return leaf(next);
  };
  const targets = slots.map(slot => b.target(region.props.id, () => leaf(slot.props.children), b.focus.FocusItem(slot.props).props.value));
  try {
    assert.deepEqual(slots.map(slot => slot.props.focusId), ['sort', 'filters', 'kind:all', 'kind:movies', 'quick:unwatched']);
    assert.equal(new Set(targets.map(target => target.props.testID)).size, slots.length);
    assert.equal(child.props.onOpen, open); assert.equal(child.props.onPlayEntry, playEntry);
    const sortSlot = slots[0]!.props.children; assert.equal(sortSlot.props.scope, `home-see-all:${authorityKey(authority)}:original-row`);
    targets[1]!.props.onPress({}); targets[3]!.props.onPress({defaultPrevented: false}); assert.deepEqual(calls, ['filters', 'movies']);
  } finally {source.unmount(); parent.unmount(); b.dispose();}
});

test('retained Home recommendation menu names the original controller row and runtime authority', async () => {
  const b = await bindings(), o = await overlayBindings(b), {authorityKey} = await import('../src-next/shell/model');
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'};
  const route = {kind: 'home-see-all', destination: {type: 'row', rowId: 'original-recommendations'}};
  class Controller {
    rowId: string; constructor(options: any) {this.rowId = options.rowId;}
    subscribe = () => () => {}; getSnapshot = () => ({row: {id: this.rowId, kind: 'recommendation'}}); dispose() {}
  }
  const mod = await screenModule(new URL('../src-next/screens/home/SeeAllRoute.tsx', import.meta.url), {react: b.react, 'react-native': b.native, '../../kit/focus': b.focus,
    '../../../../../packages/client-core/src/recommendation-feedback': {isRecommendationRow: () => true}, '../../kit/overlays': o.menu, '../../kit/controls': {Button: o.Button},
    '../../../../../packages/i18n/src': {defaultI18n}, './HomeSeeAll': {HomeSeeAll: 'HomeSeeAll'}, './HomeRowFilters': {HomeRowFilters: 'Filters'}, './row-controller': {NativeHomeRowController: Controller},
    '../../platform/server-connections': {}, '../../shell/routes': {}, '../../shell/route-registry': {nativeShellRoutes: {registerRoute() {}}}, '../../shell/model': {shellLayout() {}, authorityKey},
    '../../kit/theme': {useTheme: () => b.theme}, '../read/platform': {hiddenReadingLibraryOnTV: () => false}, '../read/reading-books-open': {}, './entry-lifetime': {}});
  const context: any = {current: () => true, authority: () => authority, libraries: () => [], api: {}, navigation: {retainedRoutes: () => [], getSnapshot: () => ({route})}};
  const rows = mod.createNativeHomeRows(context, () => {}); rows.reconcile();
  const runtime = {getSnapshot: () => ({authority})}, retained = nodes(rows.render(runtime))[0]; let tree: any;
  const source = createHookHost(() => {tree = retained.type(retained.props);}); source.mount();
  const home = nodes(tree).find(node => node.type === 'HomeSeeAll'), opener = {current: {nativeTag: 730, requestTVFocus() {}}};
  home.props.onMenu({id: 'entry', kind: 'movie'}, opener); source.rerender();
  try {
    const menu = nodes(tree).find(node => node.type === o.menu.Menu);
    assert.equal(menu.props.testID, `home-see-all:${authorityKey(authority)}:original-recommendations.recommendation-menu`);
    assert.equal(menu.props.anchorRef, opener);
    const mounted = await mountActualMenu(b, o, () => menu.props); assert.ok(mounted.targets[0]!.props.testID); mounted.dispose();
  } finally {source.unmount(); rows.dispose(); b.dispose();}
});

test('Home filters footer has an actual named Button host and preserves apply-then-close', async () => {
  const b = await bindings(), o = await overlayBindings(b), filters = await import('../../../packages/client-core/src/presentation/browse-toolbar');
  const {HomeRowFilters} = await screenModule(new URL('../src-next/screens/home/HomeRowFilters.tsx', import.meta.url), {react: b.react, 'react-native': b.native,
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/browse-toolbar': filters,
    '../../../../../packages/client-core/src/presentation/kit-model': {browseToolbarModel: () => ({groups: []})}, '../../kit/browse': {FilterBuilder: 'Builder'},
    '../../kit/controls': {Button: o.Button}, '../../kit/overlays': {SidePanel: o.surface.SidePanel, BottomSheet: o.sheet.BottomSheet}, '../../kit/theme': {useTheme: () => b.theme},
    './row-controller': {}, './row-filters': {}, './browse-label': {homeBrowseLabel: () => ''}});
  const state = {filters: [], capabilities: {fields: []}, sort: {field: 'title', direction: 'asc'}};
  const calls: string[] = []; let tree: any;
  const controller = {rowId: 'row', subscribe: () => () => {}, getSnapshot: () => state, previewCounts: async () => [{id: 'all', total: 4, totalIsLowerBound: false}],
    setFilters: () => {calls.push('apply'); return true;}};
  const runtime = {text: {t: defaultI18n.t}, getSnapshot: () => ({account: {viewerRole: 'member'}}), reportError() {}};
  const source = createHookHost(() => {tree = HomeRowFilters({controller, runtime, onClose: () => calls.push('close')});}); source.mount(); await flush();
  const footer = nodes(tree.props.footer).find(node => node.type === o.Button);
  b.region(() => ({id: tree.props.testID}));
  const target = b.target(tree.props.testID, () => {const outer = o.Button.render(footer.props, null); return outer.type.render(outer.props, outer.props.ref).props;});
  try {
    assert.equal(b.registry.child({regionId: 'home-row-filters', childId: 'show-results'}), target.host);
    target.props.onPress(); assert.deepEqual(calls, ['apply', 'close']);
  } finally {source.unmount(); b.dispose();}
});

test('actual Search registration keeps equal-value retained genre R1/R2 sort roots, openers and commands distinct', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const b = await bindings(), o = await overlayBindings(b), direction = await import('../../../packages/client-core/src/presentation/browse-toolbar');
  const presentation = await import('../src-next/kit/browse/presentation'), {authorityKey} = await import('../src-next/shell/model');
  const genres = await import('../../../packages/client-core/src/search-genres');
  const sorts = [{id: 'title', labelKey: 'next.browse.native.sort', directions: ['asc', 'desc'], defaultDirection: 'asc'}, {id: 'added', labelKey: 'next.browse.native.sort', directions: ['desc'], defaultDirection: 'desc'}];
  const sort = {field: 'title', direction: 'asc', flippable: true}, toolbar = {sorts, sort, applied: [], quick: []};
  const sortModule = await screenModule(new URL('../src-next/screens/library/LibrarySortMenu.tsx', import.meta.url), {react: b.react, 'react-native': b.native,
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/browse-toolbar': direction,
    '../../kit/controls': {Focusable: b.Focusable, Segmented: 'Segmented'}, '../../kit/overlays': o.menu, '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/theme': {useTheme: () => b.theme}, '../../kit/browse/presentation': presentation});
  const genreModule = await screenModule(new URL('../src-next/screens/search/GenreBrowseScreen.tsx', import.meta.url), {react: b.react, 'react-native': b.native,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0})}, '../../../../../packages/i18n/src': {defaultI18n},
    '../../../../../packages/client-core/src/presentation/browse-toolbar': direction, '../../../../../packages/client-core/src/presentation/kit-model': {browseToolbarModel: () => toolbar},
    '../../../../../packages/client-core/src/search-genres': genres, '../../kit/browse': {FiltersButton: 'Filters'}, '../../kit/controls': {Focusable: b.Focusable},
    '../../kit/Icon': {Icon: 'Icon'}, '../../kit/layout': {WindowedGrid: 'Grid'}, '../../kit/states': {GridSkeleton: 'Skeleton', StateView: 'State'},
    '../../kit/browse/presentation': presentation, '../../kit/theme': {useTheme: () => b.theme}, '../library/LibrarySortMenu': sortModule,
    '../library/model': {nativeLibraryEntryKey: (entry: any) => entry.id}, '../home/model': {}, '../../kit/cards': {PosterCard: 'Poster'}, './GenreFilters': {GenreFilters: 'GenreFilters'}});
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'};
  const r1 = {kind: 'search-genre', label: 'Drama', value: 'Drama'}, r2 = {...r1}; let showing = r2;
  const commands: {route: unknown; sort: unknown}[] = [], collection = {subscribe: () => () => {}, subscribePage: () => () => {}, getSnapshot: () => ({status: 'ready', total: 0}), pageOf: () => 0, getPageVersion: () => 0};
  const register = await screenModule(new URL('../src-next/screens/search/register.tsx', import.meta.url), {react: b.react, 'react-native': b.native,
    '../../shell/route-registry': {nativeShellRoutes: {registerRoute() {}, registerDestination() {}}}, '../destinations/lifetime': {nativeDestinationLifetime: () => ({current: () => true})},
    '../destinations/entry-actions': {createNativeEntryActions: () => ({dispose() {}, menuState: {subscribe: () => () => {}, getSnapshot: () => 0}})},
    './controller': {}, './actions': {}, './explore': {}, './selection': {}, './SearchScreen': {}, './AllGenresScreen': {}, './reading-register': {},
    './navigation': {createNativeSearchGenreController: (_: any, route: any) => {
      const snapshot = {phase: 'ready', capabilities: {library: {kind: 'movie'}, sorts}, sort, predicates: [], collection, queryRevision: 0};
      return {source: {subscribe: () => () => {}, getSnapshot: () => snapshot, getMemory: () => ({firstVisibleIndex: 0, offset: 0}), contains: () => false,
        setQuery: (_: any, sort: any) => commands.push({route, sort})}, activation: {subscribe: () => () => {}, getSnapshot: () => ({visible: showing === route})}, dispose() {}};
    }}, './GenreBrowseScreen': genreModule, '../../shell/model': {authorityKey}});
  const context = {authority: () => authority, subscribeAuthority: () => () => {}, session: () => ({viewer: {role: 'member'}}), navigation: {
    subscribe: () => () => {}, retainedRoutes: () => [r1], getSnapshot: () => ({route: showing}), back() {} }};
  let latestReads = 0;
  const controller = register.createNativeSearchModule(context), runtime = {text: {t: defaultI18n.t, locale: 'en-US'}, getSnapshot() {latestReads++; return {authority};}};
  const elements = nodes(controller.renderRetained(runtime)).filter(node => node.type === genreModule.GenreBrowseScreen);
  const drivers: ReturnType<typeof createHookHost>[] = [], menus: any[] = [], scopes: string[] = [];
  try {
    assert.equal(elements.length, 2); assert.notEqual(elements[0]!.key, elements[1]!.key);
    for (const element of elements) {
      let parentTree: any, gridTree: any, sortTree: any;
      const parent = createHookHost(() => {parentTree = element.type(element.props);}); parent.mount(); drivers.push(parent);
      const grid = () => nodes(parentTree).find(node => node.type?.name === 'GenreGrid');
      const gridDriver = createHookHost(() => {gridTree = grid().type(grid().props);}); gridDriver.mount(); drivers.push(gridDriver);
      const leaf = () => nodes(gridTree).find(node => node.type === sortModule.LibrarySortMenu);
      const sortDriver = createHookHost(() => {sortTree = leaf().type(leaf().props);}); sortDriver.mount(); drivers.push(sortDriver);
      nodes(sortTree).find(node => node.type === b.Focusable).props.onPress(); sortDriver.rerender();
      const pop = nodes(sortTree).find(node => node.type === o.menu.Popover); scopes.push(pop.props.testID);
      let restored = 0; const anchor = pop.props.anchorRef, original = {nativeTag: 900 + menus.length, requestTVFocus() {restored++;}, measureInWindow: (fn: any) => fn(0, 0, 40, 40)}; anchor.current = original;
      let surfaceTree: any, popProps = pop.props; const overlay = createHookHost(() => {surfaceTree = o.menu.Popover(popProps);}); overlay.mount(); overlay.flush(); drivers.push(overlay);
      const boundary = nodes(surfaceTree).find(node => node.type === o.surface.FocusBoundary), actual = boundary.type(boundary.props); b.region(() => actual.props);
      const row = nodes(sortTree).find(node => node.type === o.menu.MenuRow && node.props.focusId === 'sort:added');
      const target = b.target(actual.props.id, () => row.type.render(row.props, row.props.ref).props); target.props.onPress(); sortDriver.rerender();
      popProps = nodes(sortTree).find(node => node.type === o.menu.Popover).props; overlay.rerender(); t.mock.timers.tick(500); overlay.rerender();
      assert.equal(restored, 1); assert.equal(anchor.current, original);
      menus.push({element, parent, gridDriver, sortDriver, getScope: () => nodes(sortTree).find(node => node.type === o.menu.Popover).props.testID});
    }
    assert.notEqual(scopes[0], scopes[1], 'same genre value/authority has two distinct actual retained occurrence roots');
    assert.ok(scopes.every(scope => scope.startsWith(`genre:${authorityKey(authority)}:"Drama":`)));
    assert.deepEqual(commands.map(command => command.route), [r1, r2], 'each real sort callback retains its original controller');
    showing = r1; controller.renderRetained(runtime);
    for (const menu of menus) {menu.parent.rerender(); menu.gridDriver.rerender(); menu.sortDriver.rerender();}
    assert.deepEqual(menus.map(menu => menu.getScope()), scopes, 'Back/retained visibility never renames either occurrence');
    assert.equal(latestReads, 0, 'scope uses the original registration authority, never a latest runtime lookup');
  } finally {for (const driver of drivers.reverse()) driver.unmount(); controller.dispose(); b.dispose(); t.mock.timers.reset();}
});

function actualButtonProps(o: Awaited<ReturnType<typeof overlayBindings>>, props: any) {
  const outer = o.Button.render(props, props.ref ?? null);
  return outer.type.render(outer.props, outer.props.ref).props;
}

test('Join caller binds Find/Sign out to its real field region and preserves commands through busy and Back', async () => {
  const b = await bindings(), o = await overlayBindings(b), backs = new Set<() => boolean>();
  const native = {...b.native, BackHandler: {addEventListener: (_: string, fn: () => boolean) => {backs.add(fn); return {remove: () => backs.delete(fn)};}}};
  const {TVNoServers} = await screenModule(new URL('../src-next/screens/accounts/TVNoServers.tsx', import.meta.url), {
    react: b.react, 'react-native': native, 'react-native-qrcode-svg': {default: 'QR'}, '../../../../../packages/i18n/src': {defaultI18n},
    '../../kit/focus': b.focus, '../search/TVKeyboard': {NativeTVKeyboard: 'Keyboard'}, '../../kit/artwork': {ColourBackdrop: 'Backdrop'},
    '../../kit/controls': {Button: o.Button, Focusable: b.Focusable, TextField: 'TextField'}, '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/theme': {useTheme: () => b.theme, nativeType}, '../destinations/useEntryFocus': b.entry,
    '../../shell/model': {shellLayout: () => ({left: 0, top: 0, width: 1920, height: 1080, scale: 1})}, '../../tv/auth/entry-revision': {useTVBusyEntryRevision}});
  let tree: any, busy = false, current = true; const calls: unknown[] = [];
  const props = {isCurrent: () => current, onJoin: (...value: string[]) => calls.push(value), onFind: () => calls.push('find'),
    onSignOut: () => calls.push('sign-out'), onRefresh() {}, onBack: () => calls.push('back')};
  const source = createHookHost(() => {tree = TVNoServers({...props, busy});}); source.mount(); await flush();
  nodes(tree).find(node => node.type?.name === 'DoorTiles').props.onJoin(); await flush();
  const region = () => nodes(tree).find(node => node.type === b.focus.FocusRegion && node.props.id === 'accounts.empty.fields');
  const field = (id: string) => nodes(tree).find(node => node.type === 'TextField' && node.props.focusId === id);
  await act(() => {field('address').props.onChangeText('https://original.example'); field('invitation').props.onChangeText('ORIGINAL-CODE');});
  const guide = b.region(() => region().props), button = (id: string) => nodes(tree).find(node => node.type === o.Button && node.props.focusId === id);
  const find = b.target('accounts.empty.fields', () => actualButtonProps(o, button('find').props));
  const signOut = b.target('accounts.empty.fields', () => actualButtonProps(o, button('sign-out').props));
  const join = b.target('accounts.empty.fields', () => actualButtonProps(o, button('join').props));
  try {
    assert.deepEqual(b.registry.order('accounts.empty.fields'), ['address', 'invitation', 'join', 'find', 'sign-out']);
    assert.equal(b.registry.config('accounts.empty.fields')?.entry, 'address');
    assert.equal(find.props.testID, registryModule.focusTestID('accounts.empty.fields', 'find'));
    assert.equal(signOut.props.testID, registryModule.focusTestID('accounts.empty.fields', 'sign-out'));
    const refs = [find.props.ref, signOut.props.ref];
    busy = true; source.rerender(); guide.refresh(); find.refresh(); signOut.refresh(); join.refresh();
    for (const target of [find, signOut, join]) {assert.equal(target.props.disabled, true); assert.equal(target.props.onPress, undefined);}
    assert.deepEqual(calls, []);
    busy = false; source.rerender(); guide.refresh(); find.refresh(); signOut.refresh(); join.refresh();
    assert.equal(find.props.ref, refs[0]); assert.equal(signOut.props.ref, refs[1]);
    assert.equal(b.registry.child({regionId: 'accounts.empty.fields', childId: 'find'}), find.host);
    assert.equal(b.registry.child({regionId: 'accounts.empty.fields', childId: 'sign-out'}), signOut.host);
    find.props.onPress(); signOut.props.onPress(); join.props.onPress(); await flush();
    assert.deepEqual(calls, ['find', 'sign-out', ['ORIGINAL-CODE', 'https://original.example']]);
    current = false; find.props.onPress(); signOut.props.onPress(); assert.equal(calls.length, 3, 'original current predicate still refuses stale callers');
    current = true; assert.equal([...backs][0]!(), true); await flush();
    assert.ok(nodes(tree).find(node => node.type?.name === 'DoorTiles')); assert.equal(calls.length, 3, 'Back retains the original in-page return');
  } finally {source.unmount(); b.dispose();}
});

for (const kind of ['trusted', 'identity'] as const) for (const closeBy of ['cancel', 'back'] as const) test(`${kind} Forget caller binds safe Cancel and distinct real footer hosts, re-enables after failure, then returns by ${closeBy}`, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const b = await bindings(), o = await overlayBindings(b);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'require');
  Object.defineProperty(globalThis, 'require', {configurable: true, writable: true, value: (path: string) => {assert.equal(path, '../../../assets/wordmark.png'); return 1;}});
  let tree: any, reject!: (error: Error) => void, operations = 0, errors = 0;
  const certificate = {address: 'https://original.example', fingerprint: 'sha256:original', serverId: 'original-server'};
  const forgotten: any[] = [], failure = new Promise<void>((_resolve, refuse) => {reject = refuse;});
  const common = {react: b.react, 'react-native': b.native, '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/controls': {Button: o.Button},
    '../../kit/overlays': {...o.surface, OverlaysProvider: o.host.OverlaysProvider}, '../../kit/theme': {useTheme: () => b.theme, nativeType},
    '../../kit/artwork': {ColourBackdrop: 'Backdrop'}, '../../kit/Icon': {Icon: 'Icon'},
    '../../shell/model': {shellLayout: () => ({left: 0, top: 0, width: 1920, height: 1080, scale: 1})},
    'react-native-svg': {default: 'Svg', Circle: 'Circle', Path: 'Path'}};
  const mod = await screenModule(new URL(kind === 'trusted' ? '../src-next/screens/accounts/TVTrustedCertificates.tsx' : '../src-next/screens/accounts/ServerIdentityFailure.tsx', import.meta.url), {
    ...common, '../../../../../packages/client-core/src/presentation/errors': {presentError: () => ({body: 'Refused'})},
    '../../platform/server-connections': {savedCertificates: async () => [certificate], forgetCapturedCertificate: async (value: any) => {operations++; forgotten.push(value); await failure;}}});
  const source = createHookHost(() => {tree = kind === 'trusted' ? mod.TVTrustedCertificates({}) : mod.ServerIdentityFailure({
    failure: {changed: true, server: {name: 'Original server'}}, onRetry() {}, onChoose() {}, onForget: async () => {operations++; await failure;}, onError: () => {errors++;}});});
  let renderer: ReturnType<typeof createHookHost> | undefined;
  try {
    source.mount(); await flush();
    const openerNode = () => nodes(tree).find(node => node.type === o.Button && (kind === 'trusted'
      ? node.props.children === defaultI18n.t('connection.certificates.forget')
      : node.props.children === defaultI18n.t('connection.identity.forget', {server: 'Original server'})));
    // The outer account focus receipt is a controlled native boundary. The identity
    // caller additionally supplies its actual captured returnFocusRef.
    b.region(() => ({id: 'original.account.page', order: ['original-opener']}));
    const original = b.target('original.account.page', () => ({focusId: 'original-opener'})); original.props.onFocus({});
    const opener = b.target(undefined as any, () => actualButtonProps(o, openerNode().props));
    opener.props.onPress(); await flush();
    const dialog = () => nodes(tree).find(node => node.type === o.surface.Dialog).props;
    const expected = kind === 'trusted' ? 'tv-trusted-certificate-forget' : 'identity-forget';
    assert.equal(dialog().testID, expected);
    let overlay: any;
    renderer = createHookHost(() => {const node = o.surface.Dialog(dialog()); overlay = node.type(node.props);}); renderer.mount();
    const boundary = () => {const node = nodes(overlay).find(node => node.type === o.surface.FocusBoundary); return node.type(node.props);};
    const guide = b.region(() => boundary().props);
    const footer = (id: string) => nodes(dialog().footer).find(node => node.type === o.Button && node.props.focusId === id).props;
    const cancel = b.target(expected, () => actualButtonProps(o, footer('cancel'))), forget = b.target(expected, () => actualButtonProps(o, footer('forget')));
    const refresh = () => {
      source.rerender(); renderer!.rerender();
      if (!overlay) {cancel.dispose(); forget.dispose(); guide.dispose(); return;}
      guide.refresh(); cancel.refresh(); forget.refresh();
    };
    assert.deepEqual(nodes(dialog().footer).filter(node => node.type === o.Button).map(node => node.props.focusId), kind === 'trusted' ? ['cancel', 'forget'] : ['forget', 'cancel']);
    assert.equal(cancel.props.testID, registryModule.focusTestID(expected, 'cancel')); assert.equal(forget.props.testID, registryModule.focusTestID(expected, 'forget'));
    t.mock.timers.tick(180); assert.equal(cancel.calls, 1, 'actual Dialog initial ref enters safe Cancel'); assert.equal(forget.calls, 0); assert.equal(operations, 0);
    const refs = [cancel.props.ref, forget.props.ref];
    forget.props.onPress(); refresh();
    assert.equal(operations, 1); assert.equal(cancel.props.disabled, true); assert.equal(forget.props.disabled, true);
    assert.equal(cancel.props.onPress, undefined); assert.equal(forget.props.onPress, undefined);
    assert.equal([...o.back][0]!(), true); refresh(); assert.equal(dialog().open, true, 'original busy Back refusal is preserved');
    reject(new Error('original operation refused')); await flush(); refresh();
    assert.equal(dialog().open, true); assert.equal(!!cancel.props.disabled, false); assert.equal(!!forget.props.disabled, false);
    assert.equal(typeof cancel.props.onPress, 'function'); assert.equal(typeof forget.props.onPress, 'function');
    assert.equal(cancel.props.ref, refs[0]); assert.equal(forget.props.ref, refs[1]);
    assert.equal(b.registry.child({regionId: expected, childId: 'cancel'}), cancel.host); assert.equal(b.registry.child({regionId: expected, childId: 'forget'}), forget.host);
    assert.equal(operations, 1, 'failure/re-enable never invokes another command');
    if (kind === 'trusted') {assert.deepEqual(forgotten, [certificate]); assert.notEqual(forgotten[0], certificate); assert.equal(Object.isFrozen(forgotten[0]), true);}
    else assert.equal(errors, 1);
    if (closeBy === 'cancel') cancel.props.onPress(); else assert.equal([...o.back][0]!(), true);
    refresh(); assert.equal(dialog().open, false); t.mock.timers.tick(500); refresh();
    assert.equal(overlay, null); assert.equal(b.registry.child({regionId: expected, childId: 'cancel'}), undefined);
    assert.equal(b.registry.child({regionId: expected, childId: 'forget'}), undefined);
    assert.equal(kind === 'identity' ? opener.calls : original.calls, 1, 'actual Dialog lifecycle restores its original explicit ref or captured registry receipt');
    assert.equal(operations, 1);
  } finally {
    renderer?.unmount(); source.unmount(); b.dispose(); t.mock.timers.reset();
    if (descriptor) Object.defineProperty(globalThis, 'require', descriptor); else delete (globalThis as any).require;
  }
});

for (const kind of ['sort', 'filter'] as const) test(`actual Saved directory supplies retained toolbar scopes to the real ${kind} Popover and keyed rows`, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const b = await bindings(), o = await overlayBindings(b), direction = await import('../../../packages/client-core/src/presentation/browse-toolbar');
  const presentation = await import('../src-next/kit/browse/presentation'), savedText = await import('../src-next/screens/saved/presentation');
  const react: any = {...b.react, useImperativeHandle() {}}; react.default = react; // Scroll-page handle is outside this caller-ID vector.
  const toolbar = await screenModule(new URL('../src-next/screens/saved/PlaylistToolbar.tsx', import.meta.url), {
    react, 'react-native': b.native, '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/browse-toolbar': direction,
    '../../kit/controls': {Focusable: b.Focusable, Segmented: 'Segmented'}, '../../kit/overlays': o.menu, '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/browse/presentation': presentation, '../../kit/theme': {useTheme: () => b.theme}});
  const {SavedTVDirectory} = await screenModule(new URL('../src-next/screens/saved/SavedTVDirectory.tsx', import.meta.url), {
    react, 'react-native': b.native, '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/controls': {Focusable: b.Focusable},
    '../../kit/artwork': {}, '../../kit/cards/primitives': {}, '../../kit/focus': b.focus, '../../kit/Icon': {Icon: 'Icon'}, '../../kit/states': {StateView: 'State'},
    '../../kit/browse/presentation': presentation, '../../kit/theme': {useTheme: () => b.theme}, './PlaylistToolbar': toolbar, './presentation': savedText});
  const snapshot = {phase: 'ready', saved: {projection: {sections: [], query: {sort: 'title', direction: 'asc', category: 'all'},
    sorts: [{id: 'title', directions: ['asc', 'desc']}], filters: [{id: 'ownership', options: [{id: 'all', count: 4}]}, {id: 'visibility', options: [{id: 'all', count: 3}]}]}, pagination: {next: []}}};
  const routes: any[][] = [[], []], trees: any[] = [], tools: any[] = [], source: ReturnType<typeof createHookHost>[] = [], drivers: ReturnType<typeof createHookHost>[] = [];
  const destinations = [0, 1].map(() => ({subscribe: () => () => {}, getSnapshot: () => snapshot}));
  const selects = [0, 1].map(index => (value: any) => routes[index]!.push(value));
  let enabled = true, overlay: any, renderer: ReturnType<typeof createHookHost> | undefined;
  const directoryProps = (index: number) => ({view: 'playlists', destination: destinations[index], runtime: {}, libraries: [], enabled: index ? true : enabled,
    regionId: `saved.original-${index}`, select: selects[index], openPlaylist() {}, openResource() {}});
  try {
    for (const index of [0, 1]) {
      source[index] = createHookHost(() => {trees[index] = SavedTVDirectory(directoryProps(index));}); source[index]!.mount();
      drivers[index] = createHookHost(() => {const node = nodes(trees[index]).find(node => node.type === toolbar.PlaylistToolbar); tools[index] = node.type(node.props);}); drivers[index]!.mount();
    }
    const menu = (index = 0) => nodes(tools[index]).find(node => node.type === o.menu.Popover && node.props.testID.endsWith(`.${kind}-menu`)).props;
    assert.equal(menu().testID, `saved.original-0.toolbar.${kind}-menu`); assert.equal(menu(1).testID, `saved.original-1.toolbar.${kind}-menu`);
    const declared = () => nodes(trees[0]).find(node => node.type === b.focus.FocusRegion && node.props.id === 'saved.original-0.toolbar');
    const parent = b.region(() => declared().props), openerNode = () => nodes(tools[0]).find(node => node.type === b.Focusable && node.props.focusId === `tv-saved-${kind}`);
    const opener = b.target('saved.original-0.toolbar', () => openerNode().props), originalRef = opener.props.ref;
    (opener.host as any).measureInWindow = (callback: any) => callback(10, 10, 100, 50);
    enabled = false; source[0]!.rerender(); drivers[0]!.rerender(); parent.refresh(); opener.refresh();
    assert.equal(opener.props.disabled, true); assert.equal(opener.props.onPress, undefined); assert.deepEqual(routes, [[], []]);
    enabled = true; source[0]!.rerender(); drivers[0]!.rerender(); parent.refresh(); opener.refresh();
    assert.equal(opener.props.ref, originalRef); opener.props.onFocus({}); opener.props.onPress(); drivers[0]!.rerender();
    renderer = createHookHost(() => {overlay = o.menu.Popover(menu());}); renderer.mount(); renderer.flush();
    const boundary = nodes(overlay).find(node => node.type === o.surface.FocusBoundary), declaration = boundary.type(boundary.props);
    const guide = b.region(() => declaration.props), rows = nodes(menu().children).filter(node => node.type === o.menu.MenuRow);
    const targets = rows.map(row => b.target(menu().testID, () => row.type.render(row.props, row.props.ref).props));
    assert.equal(guide.guide.props.testID, `portico.region.${encodeURIComponent(menu().testID)}`);
    assert.equal(b.registry.entryTarget(menu().testID), targets[0]!.host, 'the actual guide entry resolves to its first real row');
    assert.equal(new Set(targets.map(target => target.props.testID)).size, rows.length);
    if (kind === 'filter') {
      assert.deepEqual(rows.map(row => row.props.focusId), ['tv-saved-show:ownership:all', 'tv-saved-show:visibility:all']);
      targets[1]!.props.onPress(); assert.deepEqual(routes[0], [{view: 'playlists', filter: 'all'}]);
    } else {
      assert.deepEqual(rows.map(row => row.props.focusId), ['tv-saved-sort:title']);
      const segmented = nodes(menu().children).find(node => node.type === 'Segmented');
      assert.deepEqual(['asc', 'desc'].map(value => segmented.props.itemProps({value}).focusId), ['tv-saved-order:asc', 'tv-saved-order:desc']);
      assert.equal([...o.back][0]!(), true); assert.deepEqual(routes[0], []);
    }
    assert.deepEqual(routes[1], [], 'the other retained directory receives no command');
    drivers[0]!.rerender(); renderer.rerender(); t.mock.timers.tick(500); renderer.rerender();
    assert.equal(opener.calls, 1, 'actual Popover lifecycle restores the original directory chip');
    targets.forEach(target => target.dispose()); guide.dispose();
  } finally {renderer?.unmount(); drivers.forEach(driver => driver.unmount()); source.forEach(driver => driver.unmount()); b.dispose(); t.mock.timers.reset();}
});

test('actual Lyrics read-error Retry keeps its original prefix, native host and reader command through snapshot changes', async () => {
  const b = await bindings(), o = await overlayBindings(b), lyrics = await import('../../../packages/client-core/src/lyrics');
  const committed = await screenModule(new URL('../src-next/kit/overlays/CommittedPaint.tsx', import.meta.url), {react: b.react, './OverlayPaintContext': b.paint});
  const {NowPlayingLyrics} = await screenModule(new URL('../src-next/screens/destinations/music/NowPlayingLyrics.tsx', import.meta.url), {
    react: b.react, 'react-native': b.native, '../../../../../../packages/client-core/src/lyrics': lyrics, '../../../../../../packages/i18n/src': {defaultI18n},
    '../../../kit/controls': {Button: o.Button, Focusable: b.Focusable}, '../../../kit/theme': {useTheme: () => b.theme},
    '../../../kit/browse/presentation': await import('../src-next/kit/browse/presentation'), '../../../kit/overlays/CommittedPaint': committed});
  let snapshot: any = {data: null, candidates: [], warnings: [], preview: null, busy: false, error: 'Read refused', generation: 1}, tree: any, reads = 0, refreshes = 0, disposed = 0;
  const original = {subscribe: () => () => {}, getSnapshot: () => snapshot, async refresh() {refreshes++;}, dispose() {disposed++;}};
  const target = Object.freeze({libraryId: 'music', itemId: 'original-song', sessionId: 'original-session', sessionGeneration: 1, sourceId: 'original-source'});
  const read = (received: unknown) => {assert.equal(received, target); reads++; return {enabled: true, service: original};};
  const source = createHookHost(() => {tree = NowPlayingLyrics({read, target, positionSeconds: 0, playing: false, onSeek() {assert.fail('Retry never seeks');}, testID: 'original-lyrics'});}); source.mount();
  const region = b.region(() => ({id: 'original.lyrics.panel'})), button = () => nodes(tree).find(node => node.type === o.Button);
  const retry = b.target('original.lyrics.panel', () => actualButtonProps(o, button().props));
  try {
    assert.equal(reads, 1); assert.equal(refreshes, 1, 'existing mount read is unchanged');
    assert.equal(retry.props.testID, 'original-lyrics-retry'); assert.equal(b.registry.child({regionId: 'original.lyrics.panel', childId: 'retry'}), retry.host);
    const ref = retry.props.ref;
    for (const busy of [true, false]) {snapshot = {...snapshot, busy}; source.rerender(); region.refresh(); retry.refresh(); assert.equal(retry.props.ref, ref); assert.equal(reads, 1); assert.equal(refreshes, 1);}
    b.paint.OverlayPaintModeContext.current = b.paint.OVERLAY_PAINT_INERT; retry.refresh();
    assert.equal(retry.props.onPress, undefined); assert.equal(b.registry.child({regionId: 'original.lyrics.panel', childId: 'retry'}), undefined);
    b.paint.OverlayPaintModeContext.current = b.paint.OVERLAY_PAINT_LIVE; retry.refresh(); retry.props.onPress();
    assert.equal(refreshes, 2); assert.equal(reads, 1, 'explicit Retry keeps the original reader');
    source.unmount(); assert.equal(disposed, 1);
  } finally {source.unmount(); b.dispose();}
});

for (const failed of [false, true]) test(`actual Library selection result footer binds Done/Retry to the named TV panel (${failed ? 'failed' : 'saved'})`, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const b = await bindings(), o = await overlayBindings(b), selection = await import('../../../packages/client-core/src/selection-model');
  const scope = await import('../src-next/screens/destinations/lifetime'), display = await import('../src-next/shell/selection-display');
  const module = await screenModule(new URL('../src-next/screens/library/selection.tsx', import.meta.url), {
    react: b.react, 'react-native': b.native, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 0})},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/errors': await import('../../../packages/client-core/src/presentation/errors'),
    '../../../../../packages/client-core/src/catalogue-query-selection': await import('../../../packages/client-core/src/catalogue-query-selection'),
    '../../../../../packages/client-core/src/selection-model': selection, '../../../../../packages/client-core/src/media-selection': await import('../../../packages/client-core/src/media-selection'),
    '../../shell/selection-display': display, '../../kit/selection': {SelectionBar: 'SelectionBar', SelectionPhoneActionBar: 'PhoneBar', BulkEditor: 'Bulk', DeleteMediaDialog: 'Delete'},
    '../../kit/theme': {useTheme: () => b.theme}, '../../kit/overlays': o.surface, '../../kit/controls': {Button: o.Button},
    '../destinations/lifetime': scope, '../native-screen-services': {nativeScreenServices: () => ({})}, '../destinations/DestinationPicker': {NativeDestinationPicker: 'Picker'},
    '../search/loaded-destinations': {NativeLoadedDestinations: class {}}, '../destinations/bulk-media': {NativeBulkMedia: class {}}, './model': {},
    './play-selection': {createNativeLibraryPlaySelection() {throw new Error('footer vector must not create a producer');}}});
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'original', viewerFence: 'viewer'};
  const context = {session: () => ({viewer: {...authority, authority: 'local'}}), authority: () => authority, current: () => true, subscribeAuthority: () => () => {}};
  const port = module.createNativeLibrarySelection(context, {}, {subscribe: () => () => {}, getSnapshot: () => ({visible: true})});
  const element = port.render(); // Obtain the real private presenter through its public factory.
  let busy = false, token = 1, active = true, clears = 0, retries = 0, tree: any, panel: any;
  const view = {active: true, selectedKeys: ['original'], target: {mode: 'explicit'}, summary: {count: 1, types: [{kind: 'movie', count: 1}], every: {}}};
  // The selection operation port is controlled; all presenter guards and kit bindings are real.
  const store = {subscribe: () => () => {}, getSnapshot: () => 1, snapshot: () => view, active: () => active, personal: () => ({results: [{key: 'original', title: 'Original', status: failed ? 'failed' : 'saved'}]}),
    personalBusy: () => busy, busy: () => busy, resultsToken: () => token, whole: () => undefined, destination: () => undefined, destinationKind: () => undefined, bulk: () => undefined,
    queueControl: () => false, loadedCount: () => 1, entries: () => [], clear() {clears++; active = false;}, async retryPersonal() {retries++;}};
  const source = createHookHost(() => {tree = element.type({...element.props, store});});
  let renderer: ReturnType<typeof createHookHost> | undefined;
  try {
    b.region(() => ({id: 'original.library', order: ['opener']})); const opener = b.target('original.library', () => ({focusId: 'opener'})); opener.props.onFocus({});
    source.mount(); const props = () => nodes(tree).find(node => node.type === o.surface.SidePanel).props;
    assert.equal(props().testID, 'library-selection-results');
    renderer = createHookHost(() => {panel = o.surface.SidePanel(props());}); renderer.mount();
    const boundary = nodes(panel).find(node => node.type === o.surface.FocusBoundary), declaration = boundary.type(boundary.props), guide = b.region(() => declaration.props);
    const footer = (id: string) => nodes(props().footer).find(node => node.type === o.Button && node.props.focusId === id).props;
    const done = b.target('library-selection-results', () => actualButtonProps(o, footer('done')));
    const retry = failed ? b.target('library-selection-results', () => actualButtonProps(o, footer('retry'))) : undefined;
    const targets = [done, ...(retry ? [retry] : [])], oldDone = footer('done').onPress, oldRetry = retry ? footer('retry').onPress : undefined;
    const refs = targets.map(target => target.props.ref);
    t.mock.timers.tick(180); assert.equal((retry ?? done).calls, 1, 'the existing initial ref chooses Retry only for actual failed results');
    assert.deepEqual(targets.map(target => target.props.testID), ['done', ...(failed ? ['retry'] : [])].map(id => registryModule.focusTestID('library-selection-results', id)));
    busy = true; source.rerender(); renderer.rerender(); targets.forEach(target => target.refresh());
    targets.forEach(target => {assert.equal(target.props.disabled, true); assert.equal(target.props.onPress, undefined);});
    assert.equal([...o.back][0]!(), true); assert.equal(clears, 0, 'busy results still own Back');
    oldDone(); oldRetry?.(); assert.equal(clears, 0); assert.equal(retries, 0);
    busy = false; token++; source.rerender(); renderer.rerender(); targets.forEach(target => target.refresh());
    targets.forEach((target, index) => {
      assert.equal(target.props.ref, refs[index]);
      assert.equal(b.registry.child({regionId: 'library-selection-results', childId: index ? 'retry' : 'done'}), target.host);
    });
    oldDone(); oldRetry?.(); assert.equal(clears, 0); assert.equal(retries, 0, 'retained old result callbacks still refuse a successor token');
    if (retry) {retry.props.onPress(); assert.equal(retries, 1); assert.equal([...o.back][0]!(), true);}
    else done.props.onPress();
    source.rerender(); assert.equal(tree, null); renderer.unmount(); targets.forEach(target => target.dispose()); guide.dispose();
    assert.equal(clears, 1); assert.equal(opener.calls, 1, 'actual panel teardown restores the original captured library opener');
  } finally {renderer?.unmount(); source.unmount(); port.dispose(); b.dispose(); t.mock.timers.reset();}
});

import {createTVKeyAdapter} from '../src-next/platform/tv-key-adapter.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import * as hostRefModule from '../src-next/kit/focus/useHostRef.ts';
import * as registryModule from '../src-next/kit/focus/registry.ts';
import {createHookHost} from './hook-driver.ts';
import {screenModule} from './helpers/screen-harness.mjs';

type Host = {nativeTag: number; requestTVFocus(): void};
async function focusModule() {
  const contexts: {current: unknown}[] = [];
  const controlledReact = {...React, default: React,
    createContext: (current: unknown) => {const context = {current}; contexts.push(context); return context;},
    useContext: (context: {current: unknown}) => context.current,
  };
  const mod = await screenModule(new URL('../src-next/kit/focus/FocusRegion.tsx', import.meta.url), {
    react: controlledReact,
    'react-native': {findNodeHandle: (host: Host) => host.nativeTag, TVFocusGuideView: 'TVFocusGuideView', View: 'View'},
    '../theme': {useTheme: () => ({isTV: true})}, './registry': registryModule, './useHostRef': hostRefModule,
  });
  return {mod, contexts};
}
test('real target hook installs native edges only on boundary children and preserves caller host refs', async () => {
  const {mod, contexts} = await focusModule(), registry = registryModule.createFocusRegistry();
  contexts[0]!.current = registry; contexts[1]!.current = 'row';
  registry.configure({id: 'row', orientation: 'horizontal', order: ['a', 'b', 'c'], edges: {left: 'rail', up: 'spotlight', down: 'below'}});
  registry.attachRegion('rail', {nativeTag: 201, requestTVFocus() {}} as Host);
  registry.attachRegion('spotlight', {nativeTag: 202, requestTVFocus() {}} as Host);
  registry.attachRegion('below', {nativeTag: 203, requestTVFocus() {}} as Host);
  let focusId = 'a', disabled = false, bound: any;
  const actual = {nativeTag: 101, requestTVFocus() {}};
  const forwarded = {current: null as Host | null};
  const driver = createHookHost(() => {bound = mod.useFocusTarget({focusId, disabled, ref: forwarded});});
  driver.mount();
  try {
    bound.ref(actual); driver.flush();
    assert.equal(forwarded.current, actual); assert.equal(registry.child({regionId: 'row', childId: 'a'}), actual);
    assert.equal(bound.testID, registryModule.focusTestID('row', 'a'));
    assert.equal(bound.nextFocusLeft, 201); assert.equal(bound.nextFocusUp, 202); assert.equal(bound.nextFocusDown, 203);
    bound.onFocus(); driver.flush(); assert.equal(registry.capture()?.childId, 'a');
    focusId = 'b'; driver.rerender();
    assert.equal(bound.nextFocusLeft, undefined, 'left from middle child stays under native intra-row search');
    assert.equal(bound.nextFocusDown, 203); assert.equal(registry.child({regionId: 'row', childId: 'a'}), undefined);
    assert.equal(registry.child({regionId: 'row', childId: 'b'}), actual);
    disabled = true; driver.rerender();
    assert.equal(registry.child({regionId: 'row', childId: 'b'}), undefined);
    bound.ref(null); assert.equal(forwarded.current, null);
  } finally {driver.unmount();}
});
test('real target hook retains supplied IDs, cursor identity and callback refs when waiting fills', async () => {
  const {mod, contexts} = await focusModule(), registry = registryModule.createFocusRegistry();
  contexts[0]!.current = registry; contexts[1]!.current = 'row';
  contexts[2]!.current = {focusId: 'source-cursor', testID: 'actual-resource-id', waiting: true};
  registry.configure({id: 'row', order: ['source-cursor']});
  const refs: unknown[] = [], callback = (host: unknown) => refs.push(host);
  let bound: any;
  const driver = createHookHost(() => {bound = mod.useFocusTarget({ref: callback});});
  driver.mount();
  try {
    const host = {nativeTag: 10, requestTVFocus() {}};
    bound.ref(host); bound.onFocus(); driver.flush();
    const ref = bound.ref; assert.equal(bound.waiting, true); assert.equal(bound.testID, 'actual-resource-id');
    contexts[2]!.current = {focusId: 'source-cursor', testID: 'actual-resource-id', waiting: false}; driver.rerender();
    assert.equal(bound.ref, ref); assert.equal(bound.waiting, false); assert.equal(bound.testID, 'actual-resource-id');
    assert.equal(registry.child({regionId: 'row', childId: 'source-cursor'}), host);
    assert.deepEqual(refs, [host], 'data arriving neither detaches nor replaces native host');
  } finally {driver.unmount();}
});
test('native guide composition uses one shared primitive with native holds and no directional handlers', async () => {
  const {mod, contexts} = await focusModule(), registry = registryModule.createFocusRegistry();
  contexts[0]!.current = registry;
  let outer: any;
  const driver = createHookHost(() => {outer = mod.FocusRegion.render({id: 'actual-menu', hold: true, children: null}, null);});
  driver.mount();
  let native: any;
  const guideDriver = createHookHost(() => {native = outer.type.render(outer.props, null);});
  guideDriver.mount();
  try {
    assert.equal(native.type, 'TVFocusGuideView'); assert.equal(native.props.autoFocus, true);
    for (const edge of ['Up', 'Down', 'Left', 'Right']) assert.equal(native.props[`trapFocus${edge}`], true);
    assert.equal(native.props.testID, 'portico.region.actual-menu');
    assert.equal(native.props.onKeyDown, undefined); assert.equal(native.props.onTVEvent, undefined);
  } finally {guideDriver.unmount(); driver.unmount();}
});

test('a guide sends native destinations only when the remembered host or guide changes', async () => {
  const {mod, contexts} = await focusModule(), registry = registryModule.createFocusRegistry();
  contexts[0]!.current = registry;
  const first = {nativeTag: 101, requestTVFocus() {}}, second = {nativeTag: 102, requestTVFocus() {}};
  registry.attach({regionId: 'row', childId: 'a'}, first);
  registry.attach({regionId: 'row', childId: 'b'}, second);
  let outer: any, native: any;
  const root = createHookHost(() => {outer = mod.FocusRegion.render({id: 'row', order: ['a', 'b'], children: null}, null);}); root.mount();
  const host = createHookHost(() => {native = outer.type.render(outer.props, null);}); host.mount();
  const sent: number[][] = [], replacementSent: number[][] = [];
  const guide = {nativeTag: 201, requestTVFocus() {}, setDestinations: (handles: number[]) => sent.push(handles)};
  try {
    native.props.ref(guide); host.flush();
    assert.deepEqual(sent, [[101]]);
    registry.didFocus({regionId: 'row', childId: 'a'}); host.flush();
    registry.didFocus({regionId: 'row', childId: 'a'}); host.flush();
    registry.configure({id: 'unrelated', order: ['other']}); host.flush();
    assert.deepEqual(sent, [[101]], 'unchanged entry and unrelated commits do not cross the native bridge');
    registry.didFocus({regionId: 'row', childId: 'b'}); host.flush();
    assert.deepEqual(sent, [[101], [102]]);
    native.props.ref(null); host.flush();
    native.props.ref({nativeTag: 202, requestTVFocus() {}, setDestinations: (handles: number[]) => replacementSent.push(handles)}); host.flush();
    assert.deepEqual(replacementSent, [[102]], 'a newly attached guide receives its remembered destination');
  } finally {native.props.ref(null); host.unmount(); root.unmount();}
});

test('F-RAIL-5 and F-RAIL-8 declare native vertical end stops while leaving Right open', async () => {
  const {mod, contexts} = await focusModule(), registry = registryModule.createFocusRegistry();
  contexts[0]!.current = registry;
  let outer: any, native: any;
  const driver = createHookHost(() => {outer = mod.FocusRegion.render({id: 'rail', orientation: 'vertical',
    order: ['search', 'home', 'settings', 'profile'], edges: {right: 'home-row'}, children: null}, null);});
  driver.mount();
  const guideDriver = createHookHost(() => {native = outer.type.render(outer.props, null);});
  guideDriver.mount();
  try {
    assert.equal(native.props.trapFocusUp, true, 'Search cannot leave the rail through its top edge');
    assert.equal(native.props.trapFocusDown, true, 'profile cannot leave the rail through its bottom edge');
    assert.equal(native.props.trapFocusRight, false, 'Right can return to the page opener');
    assert.equal(native.props.onKeyDown, undefined); assert.equal(native.props.onTVEvent, undefined);
  } finally {guideDriver.unmount(); driver.unmount();}
});

test('vertical native end stops preserve each declared handoff and held sheets still trap every edge', async () => {
  const {mod, contexts} = await focusModule(), registry = registryModule.createFocusRegistry();
  contexts[0]!.current = registry;
  let props = {id: 'column', orientation: 'vertical', edges: {} as {up?: string; down?: string}, hold: false, children: null};
  let outer: any, native: any;
  const driver = createHookHost(() => {outer = mod.FocusRegion.render(props, null);}); driver.mount();
  const guideDriver = createHookHost(() => {native = outer.type.render(outer.props, null);}); guideDriver.mount();
  try {
    for (const edges of [{up: 'toolbar'}, {down: 'next-row'}, {up: 'toolbar', down: 'next-row'}]) {
      props = {...props, edges}; driver.rerender(); guideDriver.rerender();
      assert.equal(native.props.trapFocusUp, !('up' in edges));
      assert.equal(native.props.trapFocusDown, !('down' in edges));
    }
    props = {...props, hold: true}; driver.rerender(); guideDriver.rerender();
    for (const edge of ['Up', 'Down', 'Left', 'Right']) assert.equal(native.props[`trapFocus${edge}`], true);
  } finally {guideDriver.unmount(); driver.unmount();}
});

test('F07 committed region configuration publishes a revision to reused target hooks without render-time mutation', async () => {
  const {mod, contexts} = await focusModule(), registry = registryModule.createFocusRegistry();
  contexts[0]!.current = registry; contexts[1]!.current = 'row';
  registry.attachRegion('rail', {nativeTag: 200, requestTVFocus() {}} as Host);
  let props = {id: 'row', orientation: 'horizontal', order: ['a', 'b'], edges: {left: 'rail'}};
  let outer: any, guide: any, bound: any, duringRender: unknown;
  const outerDriver = createHookHost(() => {outer = mod.FocusRegion.render(props, null);}); outerDriver.mount();
  const regionDriver = createHookHost(() => {guide = outer.type.render(outer.props, null); duringRender = registry.config('row')?.order;}); regionDriver.mount();
  const targetDriver = createHookHost(() => {bound = mod.useFocusTarget({focusId: 'a'});}); targetDriver.mount();
  try {
    assert.equal(bound.nextFocusLeft, 200);
    const revision = registry.getSnapshot();
    props = {...props, order: ['b', 'a']}; outerDriver.rerender(); regionDriver.rerender(); targetDriver.flush();
    assert.deepEqual(duringRender, ['a', 'b'], 'speculative rendering sees last committed config');
    assert.deepEqual(registry.config('row')?.order, ['b', 'a']); assert.equal(bound.nextFocusLeft, undefined);
    assert.equal(registry.getSnapshot(), revision + 1);
    regionDriver.rerender(); assert.equal(registry.getSnapshot(), revision + 1, 'equal config does not emit a render loop');
    assert.equal(guide.props.onKeyDown, undefined);
  } finally {targetDriver.unmount(); regionDriver.unmount(); outerDriver.unmount();}
});

test('F11 actual target ref keeps one native callback while replacing and cleaning React 19 caller refs', async () => {
  const {mod, contexts} = await focusModule(), registry = registryModule.createFocusRegistry();
  contexts[0]!.current = registry; contexts[1]!.current = 'row';
  const host = {nativeTag: 1, requestTVFocus() {}}, calls: string[] = [];
  let ref: React.ForwardedRef<Host> = value => {assert.equal(value, host); calls.push('attach-a'); return () => {calls.push('cleanup-a');};};
  let bound: any;
  const driver = createHookHost(() => {bound = mod.useFocusTarget({focusId: 'a', ref});}); driver.mount();
  const nativeRef = bound.ref, cleanup = nativeRef(host);
  try {
    ref = value => {assert.equal(value, host); calls.push('attach-b'); return () => {calls.push('cleanup-b');};}; driver.rerender();
    assert.equal(bound.ref, nativeRef, 'Reanimated sees a stable native ref across consumer replacements');
    assert.deepEqual(calls, ['attach-a', 'cleanup-a', 'attach-b']);
    cleanup(); assert.deepEqual(calls, ['attach-a', 'cleanup-a', 'attach-b', 'cleanup-b']);
    assert.equal(registry.child({regionId: 'row', childId: 'a'}), undefined);
  } finally {driver.unmount();}
  assert.deepEqual(calls, ['attach-a', 'cleanup-a', 'attach-b', 'cleanup-b']);
});

test('F11 guide forwards its real host and honors ref cleanup on replacement and unmount', async () => {
  const {mod, contexts} = await focusModule(), registry = registryModule.createFocusRegistry(); contexts[0]!.current = registry;
  const calls: string[] = [], host = {nativeTag: 2, requestTVFocus() {}, setDestinations() {}};
  let ref: React.ForwardedRef<any> = value => {assert.equal(value, host); calls.push('attach'); return () => {calls.push('cleanup');};};
  let outer: any, guide: any;
  const outerDriver = createHookHost(() => {outer = mod.FocusRegion.render({id: 'menu', children: null}, ref);}); outerDriver.mount();
  const driver = createHookHost(() => {guide = outer.type.render(outer.props, outer.props.ref);}); driver.mount();
  guide.props.ref(host);
  try {
    ref = {current: null}; outerDriver.rerender(); driver.rerender(); assert.deepEqual(calls, ['attach', 'cleanup']); assert.equal(ref.current, host);
  } finally {driver.unmount(); outerDriver.unmount();}
  assert.equal(ref.current, null); assert.equal(registry.host('menu'), undefined);
});

test('F-HOME-63 shared native boundary retries data once per Right stroke only on actual failed tail', async () => {
  const registry = registryModule.createFocusRegistry(); let listener: ((event: any) => void) | undefined, removed = 0, retries = 0;
  registry.configure({id: 'row', order: ['a', 'b']});
  registry.attach({regionId: 'row', childId: 'b'}, {nativeTag: 17, requestTVFocus() {throw new Error('Retry must not select a target');}} as Host);
  const mod = await screenModule(new URL('../src-next/kit/focus/page-boundary.ts', import.meta.url), {
    '../../platform/tv-key-adapter': {createTVKeyAdapter}, '../../platform/tv-key-source': {tvKeySource: 'native'},
    react: {...React, default: React}, 'react-native': {findNodeHandle: (host: Host) => host.nativeTag,
      TVEventHandler: {addListener: (value: typeof listener) => {listener = value; return {remove() {listener = undefined; removed++;}};}}},
  });
  let page = {waitingId: 'cursor', hasMore: true, failed: true, loading: false, requestNext: () => {retries++;}};
  const driver = createHookHost(() => {mod.useRowPageBoundary(true, registry, 'row', 'b', page);}); driver.mount();
  try {
    registry.didFocus({regionId: 'row', childId: 'a'}); listener!({eventType: 'right', eventKeyAction: 0}); listener!({eventType: 'right', eventKeyAction: 1}); assert.equal(retries, 0);
    registry.didFocus({regionId: 'row', childId: 'b'});
    listener!({eventType: 'right', eventKeyAction: 0, tag: 18}); listener!({eventType: 'right', eventKeyAction: 1}); assert.equal(retries, 0);
    listener!({eventType: 'right', eventKeyAction: 0, tag: 17}); listener!({eventType: 'right', eventKeyAction: 0, tag: 17}); listener!({eventType: 'right', eventKeyAction: 1}); assert.equal(retries, 1);
    listener!({eventType: 'right', eventKeyAction: 0, tag: 17}); listener!({eventType: 'right', eventKeyAction: 1}); assert.equal(retries, 2);
    page = {...page, loading: true}; driver.rerender(); assert.equal(listener, undefined); assert.equal(removed, 1);
    page = {...page, loading: false}; driver.rerender(); listener!({eventType: 'right', eventKeyAction: 0, tag: 17}); assert.equal(retries, 3, 'same failed cursor can be retried after another failure');
  } finally {driver.unmount();}
  assert.equal(removed, 2);
});

test('opted-in cell bindings resolve semantic first-column and short-row destinations on real native hosts', async () => {
  const {mod, contexts} = await focusModule(), registry = registryModule.createFocusRegistry();
  contexts[0]!.current = registry; contexts[1]!.current = 'grid';
  contexts[2]!.current = {focusId: 'last', cell: {index: 10}};
  registry.configure({id: 'grid', grid: {columns: 4, count: 11}, edges: {left: 'keyboard'}});
  registry.attachRegion('keyboard', {nativeTag: 20, requestTVFocus() {}} as Host);
  const previous = {nativeTag: 7, requestTVFocus() {}} as Host;
  registry.attach({regionId: 'grid', childId: 'previous'}, previous, {}, {index: 7});
  registry.didFocus({regionId: 'grid', childId: 'previous'});
  let bound: any;
  const driver = createHookHost(() => {bound = mod.useFocusTarget({});}); driver.mount();
  try {
    bound.ref({nativeTag: 10, requestTVFocus() {}}); driver.flush(); bound.onFocus(); driver.flush();
    assert.equal(bound.nextFocusUp, 7, 'native Up restores the column before the short row');
    assert.equal(bound.nextFocusRight, 10, 'the native host owns the true-end stop');
    contexts[2]!.current = {focusId: 'first-column', cell: {index: 8}}; driver.rerender();
    assert.equal(bound.nextFocusLeft, 20, 'Left on a later first-column cell reaches the keyboard region');
    const before = registry.getSnapshot();
    contexts[2]!.current = {focusId: 'first-column', cell: {index: 8}}; driver.rerender();
    assert.equal(registry.getSnapshot(), before, 'equal inline descriptors do not detach or republish the native host');
  } finally {driver.unmount();}
});

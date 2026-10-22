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

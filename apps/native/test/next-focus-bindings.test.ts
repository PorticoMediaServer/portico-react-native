import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
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
    '../theme': {useTheme: () => ({isTV: true})}, './registry': registryModule,
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

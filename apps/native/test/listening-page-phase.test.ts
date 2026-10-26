/** Authored UNRUN actual-hook/UI-worklet source vectors with controlled shared
 * values. No reconciler, native image, display timing, input or device proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {createHookHost, act} from './hook-driver.ts';
import {screenModule} from './helpers/screen-harness.mjs';
import {sameFence} from '../../../packages/player-core/src/index.ts';
import {validRect} from '../src-next/kit/dock/model.ts';
const fence = {kind: 'local', playId: 'original', sessionId: 'session', itemId: 'item', generation: 1};
function cell(initial: any) {
  let value = initial;
  const node: any = {get value() {return value;}, set value(next: any) {
    if (node.running) node.running.stopped = true;
    if (next?.animation || next?.delayed) {
      const animation = next.delayed ? next.inner : next;
      const handle: any = {from: value, to: animation.to, config: animation.config, delay: next.delayed ? next.delay : 0, stopped: false,
        tick(at: number) {assert.equal(handle.stopped, false); value = at;}, finish() {assert.equal(handle.stopped, false); value = handle.to;}};
      node.running = handle;
    } else {value = next; node.running = undefined;}
  }};
  return node;
}
async function rig() {
  let tree: any, reduce = false, current = true;
  const reactions: any[] = [], listeners = new Set<() => void>();
  const controller = {progress: cell(1), dragging: cell(false), presentationGoal: cell(1)};
  const scope = {}, opening = {};
  const binding = {fence, scope, opening, controller, current: () => current,
    subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};}};
  const {ListeningCoverProvider, useListeningPageStyle} = await screenModule(new URL('../src-next/kit/dock/ListeningCoverBridge.tsx', import.meta.url), {
    react: {...React, default: React, createContext: () => ({Provider: 'Provider'}), useContext: () => tree.props.value},
    'react-native': {View: 'View'},
    'react-native-reanimated': {default: {View: 'AnimatedView'},
      useSharedValue(initial: any) {const ref = React.useRef<any>(null); if (!ref.current) ref.current = cell(initial); return ref.current;},
      useAnimatedReaction(read: any, apply: any) {const ref = React.useRef<any>(null); if (!ref.current) {ref.current = {};reactions.push(ref.current);}Object.assign(ref.current, {read, apply});},
      useAnimatedStyle: (read: any) => ({read}), cancelAnimation: (node: any) => {if (node.running) node.running.stopped = true;},
      withTiming: (to: any, config: any) => ({animation: true, to, config}), withDelay: (delay: number, inner: any) => ({delayed: true, delay, inner})},
    '../../../../../packages/player-core/src': {sameFence}, './model': {validRect},
    '../theme': {useTheme: () => ({layers: {player: 30}})},
    '../useMotion': {useMotion: () => ({reduce, transforms: !reduce, timing: (kind: string) => ({duration: reduce ? 160 : kind === 'quick' ? 120 : 180, easing: reduce ? 'linear' : 'out'})})},
    '../overlays/OverlayPaintContext': {useOverlayPaintMode: () => ({interactive: true})}, './ListeningCoverPaint': {ListeningCoverPaint: 'ListeningCoverPaint'},
  });
  const provider = createHookHost(() => {tree = ListeningCoverProvider({children: null});});provider.mount();
  const step = () => {for (const reaction of reactions) {const now = reaction.read();reaction.apply(now, reaction.previous);reaction.previous = now;}};
  await act(() => tree.props.value.publish(binding)); tree.props.value.reportPageHeight(690);step();
  let pageStyle: any; const page = createHookHost(() => {pageStyle = useListeningPageStyle(fence as any, 690);}); page.mount();
  return {controller, context: () => tree.props.value, step,
    async publishSame() {await act(() => tree.props.value.publish({...binding, opening: {}}));step();},
    async reduce() {reduce = true; provider.rerender();await act(() => {});step();page.rerender();},
    async retire() {current = false;await act(() => {for (const listener of [...listeners]) listener();});step();page.rerender();},
    pageStyle: () => pageStyle.read(), close() {page.unmount();provider.unmount();}};
}

test('first mini drag starts one260/320/380 group clock and the admitted body handoff does not restart it', async () => {
  const r = await rig();
  try {
    r.controller.dragging.value = true; r.controller.progress.value = .8; r.step();
    const handles = r.context().groups.map((value: any) => value.running);
    assert.deepEqual(handles.map((value: any) => value.delay), [260, 320, 380]);
    assert.deepEqual(handles.map((value: any) => value.config.duration), [180, 180, 180]);
    assert.ok(Math.abs(r.context().pageAlpha.value - .5) < .0001);
    r.controller.dragging.value = false; r.controller.presentationGoal.value = 0; r.step();
    await r.publishSame();
    assert.deepEqual(r.context().groups.map((value: any) => value.running), handles);
    assert.equal(handles[0].stopped, false);
    r.controller.presentationGoal.value = 1; r.step();
    assert.deepEqual(r.context().groups.map((value: any) => value.running.config.duration), [120, 120, 120]);
    assert.equal(handles[0].stopped, true);
  } finally {r.close();}
});

test('reduction retargets partial page/group opacity160linear while removing autonomous page travel', async () => {
  const r = await rig();
  try {
    r.controller.presentationGoal.value = 0; r.controller.progress.value = .832; r.step();
    r.context().groups[0].running.tick(.3);
    assert.ok(Math.abs(r.context().pageAlpha.value - .42) < .0001);
    await r.reduce();
    assert.ok(Math.abs(r.context().pageAlpha.running.from - .42) < .0001);
    assert.equal(r.context().pageAlpha.running.config.duration, 160);
    assert.equal(r.context().pageAlpha.running.config.easing, 'linear');
    assert.equal(r.context().groups[0].running.from, .3);
    assert.equal(r.context().groups[0].running.config.duration, 160);
    assert.deepEqual(r.pageStyle().transform, [{translateY: 0}]);
    r.controller.dragging.value = true; r.step();
    assert.equal(r.pageStyle().transform[0].translateY, 690 * .832, 'direct finger progress remains direct under reduction');
  } finally {r.close();}
});

test('artless admitted paint still gets a page clock and original retirement cancels it', async () => {
  const r = await rig();
  try {
    assert.equal(r.context().binding.source, undefined, 'a synthetic cover is never required');
    r.controller.presentationGoal.value = 0; r.controller.progress.value = .4;r.step();
    assert.equal(r.context().pageAlpha.value, 1);
    const old = r.context().groups[0].running;
    await r.retire();
    assert.equal(old.stopped, true);
    assert.equal(r.context().pageAlpha.value, 0);
    assert.deepEqual(r.context().groups.map((value: any) => value.value), [0, 0, 0]);
    assert.equal(r.pageStyle().opacity, 0);
  } finally {r.close();}
});

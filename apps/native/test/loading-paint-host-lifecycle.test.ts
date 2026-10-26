/**
 * Component lifecycle source for the approved non-gating LoadingPaint.
 *
 * This drives the real presenter through the repo's existing element/hook
 * harness (`createHookHost` + `act` from hook-driver, the same seam as
 * next-selection-render). Only the native host, the animation driver and a
 * controlled timer queue are replaced, so the presenter's own hooks, effects
 * and cleanup order run unchanged.
 *
 * It intentionally makes no claim about native child mount preservation: the
 * element/hook harness describes elements and never mounts a host, so that
 * assertion needs a reconciler (see SB8-MOBILE_SAVED-01 handback).
 */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {transformSync} from 'rolldown/utils';
import {act, createHookHost} from './hook-driver.ts';

type Element = {type: unknown; props: Record<string, any>};
type PaintValue = {value: number};
type Timing = {
  config: {toValue: number; duration: number; easing: unknown};
  value: PaintValue; stopped: boolean; started: boolean; completed: boolean;
  /** Move the painted value without completing the animation. */
  tick: (to: number) => void;
  /** Complete to the configured target; the only path that calls the callback. */
  finish: () => void;
  /** Invoke the retired callback without touching the painted value. */
  retire: () => void;
};

const stateKey = '__porticoLoadingPaintHostTest';
const baseline = {reduce: false, duration: (name: string) => (name === 'standard' ? 180 : 0)};
const state = {
  setValues: [] as number[],
  timings: [] as Timing[],
  motion: baseline,
};
Object.assign(globalThis, {[stateKey]: state});

const dataModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const native = dataModule(`
export const View = 'View', Text = 'Text';
export const Easing = {linear: 'linear', bezier: (...points) => ({bezier: points})};
export class Value {
  constructor(value) {this.value = value;}
  setValue(value) {this.value = value; globalThis.${stateKey}.setValues.push(value);}
}
export const Animated = {
  View: 'AnimatedView', createAnimatedComponent: component => component, Value,
  timing: (value, config) => {
    const record = {config, value, stopped: false, started: false, completed: false};
    record.tick = to => {value.value = to;};
    record.finish = () => {record.completed = true; value.value = config.toValue; if (record.callback) record.callback({finished: !record.stopped});};
    record.retire = () => {if (record.callback) record.callback({finished: false});};
    globalThis.${stateKey}.timings.push(record);
    return {
      start(callback) {record.started = true; record.callback = callback;},
      stop() {record.stopped = true;},
    };
  },
};
export const StyleSheet = {create: value => value, flatten: value => value};
export {Animated as default};
`);
const motion = dataModule(`export const useMotion = () => globalThis.${stateKey}.motion;`);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react-native') return {url: native, shortCircuit: true};
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && /\/kit\/useMotion(?:\.ts)?$/.test(new URL(specifier, context.parentURL).pathname)) return {url: motion, shortCircuit: true};
    try {return next(specifier, context);} catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw error;
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try {return next(specifier + suffix, context);} catch (retry) {if ((retry as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw retry;}
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (!url.endsWith('.tsx')) return next(url, context);
    const filename = fileURLToPath(url);
    const result = transformSync(filename, readFileSync(filename, 'utf8'), {lang: 'tsx', jsx: {runtime: 'automatic'}, target: 'es2022'});
    if (result.errors.length) throw new AggregateError(result.errors, `Cannot transform ${filename}`);
    return {format: 'module', source: result.code, shortCircuit: true};
  },
});

const {LoadingPaint} = await import('../src-next/kit/states/LoadingPaint.tsx');

/** Controlled timer queue: the callback is captured so a retired one can be invoked late. */
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
const timers = new Map<number, {fn: () => void; delay: number}>(); let nextTimer = 1;
globalThis.setTimeout = ((fn: () => void, delay = 0) => {const id = nextTimer++; timers.set(id, {fn, delay}); return id;}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id?: number) => {if (id !== undefined) timers.delete(id);}) as unknown as typeof clearTimeout;
after(() => {globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;});

const live = () => [...timers.entries()];
const liveTimer = () => live().at(-1)![0];
const invoke = (id: number) => {const timer = timers.get(id); assert.ok(timer, `timer ${id} must exist before invoking it`); timers.delete(id); timer.fn();};

function mountPaint(props: any) {
  let tree: any;
  const host = createHookHost(() => {tree = LoadingPaint(props);});
  host.mount();
  return {host, get tree() {return tree as Element;}, update(next: any) {props = next; host.rerender();}};
}
const shape = {type: 'Shape', props: {}} as unknown as Element;
const child = {type: 'ChildHost', props: {}} as unknown as Element;
/** Only real rendered element nodes count; `cond && <X/>` leaves false in the array. */
function rendered(tree: Element): Element[] {
  return (tree.props.children as unknown[]).filter((node): node is Element => !!node && typeof node === 'object' && 'type' in (node as Element) && !!(node as Element).type);
}
function contentView(tree: Element): Element {
  return rendered(tree).filter(node => node.type === 'AnimatedView')[0]!;
}
function overlay(tree: Element): Element | undefined {
  return rendered(tree).filter(node => node.type === 'AnimatedView')[1];
}
/** The Value actually rendered as the content opacity, not a discarded render-local one. */
function paintValue(tree: Element): PaintValue {
  return contentView(tree).props.style.opacity as PaintValue;
}

test('a cached initial ready mount paints immediately with no quiet timer', async () => {
  const paint = mountPaint({ready: true, immediate: true, skeleton: shape, children: child});
  try {
    assert.equal(live().length, 0, 'cached ready queues no quiet timer');
    assert.equal(state.timings.length, 0, 'cached ready starts no fade');
    assert.equal(paintValue(paint.tree).value, 1, 'cached ready paints at full opacity');
    assert.equal(overlay(paint.tree), undefined);

    paint.update({ready: false, immediate: true, skeleton: shape, children: child});
    await act(() => {});
    assert.equal(live().length, 1, 'the next loading cycle starts its own quiet window');
    assert.equal(overlay(paint.tree), undefined, 'quiet hides the shape until the window elapses');
    await act(() => {invoke(liveTimer());});
    assert.ok(overlay(paint.tree), 'the later loading cycle paints the shape');

    paint.update({ready: true, immediate: true, skeleton: shape, children: child});
    await act(() => {});
    assert.equal(overlay(paint.tree), undefined);
    const fade = state.timings.at(-1)!;
    assert.equal(fade.config.duration, 180, 'cached is not sticky: later content fades');
    assert.equal(fade.started, true);
    assert.equal(fade.value, paintValue(paint.tree), 'the fade drives the rendered opacity Value');
    fade.finish();
    assert.equal(paintValue(paint.tree).value, 1);
  } finally {paint.host.unmount();}
});

test('a retired quiet completion cannot paint in the next cycle, cannot hide the current shape, and is inert after unmount', async () => {
  const paint = mountPaint({ready: false, skeleton: shape, children: child});
  const retired = timers.get(liveTimer())!.fn;
  try {
    paint.update({ready: true, skeleton: shape, children: child});
    await act(() => {});
    paint.update({ready: false, skeleton: shape, children: child});
    const current = liveTimer();
    await act(() => {});
    assert.equal(overlay(paint.tree), undefined, 'still quiet in the new cycle');
    await act(() => {retired();});
    assert.equal(overlay(paint.tree), undefined, 'the retired completion reveals nothing');
    await act(() => {invoke(current);});
    assert.ok(overlay(paint.tree), 'only the current cycle completion paints');
    // Known red against current LoadingPaint: a retired timer writes its own cycle
    // token back through setDoneCycle, hiding the newer cycle's shape.
    await act(() => {retired();});
    assert.ok(overlay(paint.tree), 'a late retired timer leaves the current shape visible');
  } finally {
    paint.host.unmount();
    const timings = state.timings.length, queued = live().length;
    assert.doesNotThrow(() => {retired();}, 'the captured retired callback is inert after unmount');
    assert.equal(state.timings.length, timings, 'a late retired callback starts no animation');
    assert.equal(live().length, queued, 'a late retired callback queues no timer');
  }
});

test('changing the motion policy during quiet never restarts the 300 ms window', async () => {
  const paint = mountPaint({ready: false, skeleton: shape, children: child});
  try {
    const [timerId, timer] = live()[0]!;
    assert.equal(timer.delay, 300);
    state.motion = {reduce: true, duration: (name: string) => (name === 'standard' ? 160 : 0)};
    paint.update({ready: false, skeleton: shape, children: child});
    await act(() => {});
    assert.equal(live().length, 1, 'no second quiet timer');
    assert.equal(live()[0]![0], timerId, 'the original timer is still the live one');
    await act(() => {invoke(timerId);});
    assert.ok(overlay(paint.tree), 'the original window still reveals the shape');
  } finally {paint.host.unmount(); state.motion = baseline;}
});

test('a policy change retargets the painted value, and a retired completion leaves its successor live', async () => {
  const paint = mountPaint({ready: false, skeleton: shape, children: child});
  try {
    paint.update({ready: true, skeleton: shape, children: child});
    await act(() => {});
    const first = state.timings.at(-1)!;
    assert.equal(first.config.duration, 180);
    assert.deepEqual(first.config.easing, {bezier: [0.2, 0.8, 0.2, 1]}, 'default motion uses the out curve');
    assert.equal(first.value, paintValue(paint.tree));
    first.tick(0.42);
    assert.equal(paintValue(paint.tree).value, 0.42, 'partial paint is the value the retarget must see');
    const resets = state.setValues.length;

    state.motion = {reduce: true, duration: (name: string) => (name === 'standard' ? 160 : 0)};
    paint.update({ready: true, skeleton: shape, children: child});
    await act(() => {});
    const second = state.timings.at(-1)!;
    assert.equal(second.config.duration, 160, 'reduced motion retargets at 160');
    assert.equal(second.config.easing, 'linear');
    assert.equal(second.value, paintValue(paint.tree), 'the retarget drives the same rendered Value');
    assert.equal(paintValue(paint.tree).value, 0.42, 'the retarget starts from the painted value');
    assert.equal(state.setValues.length, resets, 'no reset to zero on a policy change');
    assert.equal(first.stopped, true);

    // The retired completion runs despite its stop and writes no value; the
    // component's own handle check must keep the successor authoritative.
    first.retire();
    assert.equal(second.stopped, false, 'the successor is still the live fade');
    assert.equal(paintValue(paint.tree).value, 0.42, 'a retired callback writes no paint');
    second.tick(0.9);
    assert.equal(paintValue(paint.tree).value, 0.9, 'the successor holds its own partial paint');

    state.motion = baseline;
    paint.update({ready: true, skeleton: shape, children: child});
    await act(() => {});
    const third = state.timings.at(-1)!;
    assert.equal(third.config.duration, 180, 'a later retarget still owns the fade');
    assert.deepEqual(third.config.easing, {bezier: [0.2, 0.8, 0.2, 1]});
    assert.equal(second.stopped, true, 'the retarget stops the previous live fade');
    assert.equal(paintValue(paint.tree).value, 0.9, 'the retarget starts from the painted value');
    third.finish();
    assert.equal(paintValue(paint.tree).value, 1, 'the live successor reaches full opacity');
  } finally {paint.host.unmount(); state.motion = baseline;}
});

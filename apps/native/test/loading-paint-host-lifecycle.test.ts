/**
 * Component/render lifecycle source for the approved non-gating LoadingPaint.
 *
 * This drives the real presenter through the existing element/hook harness
 * (`createHookHost` + `act` from hook-driver, the same seam as
 * next-selection-render). Only the native host and the animation driver are
 * replaced, plus a controlled timer queue, so the presenter's own hooks,
 * effects and cleanup order run unchanged. It is source preparation, not a
 * runtime or device acceptance.
 */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {transformSync} from 'rolldown/utils';
import {act, createHookHost} from './hook-driver.ts';

type Element = {type: unknown; props: Record<string, any>};

const stateKey = '__porticoLoadingPaintHostTest';
const state = {
  values: [] as {value: number}[],
  setValues: [] as number[],
  timings: [] as {config: {toValue: number; duration: number; easing: unknown; useNativeDriver?: boolean}; stopped: boolean; started: boolean; completed: boolean; finish?: () => void}[],
  motion: {reduce: false, duration: (name: string) => (name === 'standard' ? 180 : 0)},
};
Object.assign(globalThis, {[stateKey]: state});

const dataModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const native = dataModule(`
export const View = 'View', Text = 'Text';
export const Easing = {linear: 'linear', bezier: (...points) => ({bezier: points})};
export class Value {
  constructor(value) {this.value = value; globalThis.${stateKey}.values.push(this);}
  setValue(value) {this.value = value; globalThis.${stateKey}.setValues.push(value);}
}
export const Animated = {
  View: 'AnimatedView', createAnimatedComponent: component => component, Value,
  timing: (value, config) => {
    const record = {config, stopped: false, started: false, completed: false};
    globalThis.${stateKey}.timings.push(record);
    return {
      start(callback) {record.started = true; record.finish = () => {if (record.stopped) return; record.completed = true; callback && callback({finished: true});};},
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

/** Controlled timer queue: no wall sleeps, and a retired callback can be fired late. */
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
const timers = new Map<number, {fn: () => void; delay: number}>(); let nextTimer = 1;
globalThis.setTimeout = ((fn: () => void, delay = 0) => {const id = nextTimer++; timers.set(id, {fn, delay}); return id;}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id?: number) => {if (id !== undefined) timers.delete(id);}) as unknown as typeof clearTimeout;
after(() => {globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;});

const fire = (id: number) => {const timer = timers.get(id); if (!timer) return false; timers.delete(id); timer.fn(); return true;};
const pending = () => [...timers.entries()];

function makeChild(marker: {mounts: number}) {
  marker.mounts++;
  return {type: 'ChildHost', props: {marker}, key: null} as unknown as Element;
}
function mountPaint(props: any) {
  let tree: any;
  const host = createHookHost(() => {tree = LoadingPaint(props);});
  host.mount();
  return {host, get tree() {return tree as Element;}, update(next: any) {props = next; host.rerender();}};
}
function contentChild(tree: Element): unknown {
  // The presenter always wraps the same supplied child in its content view.
  return (tree.props.children as any[])[0].props.children;
}
function overlay(tree: Element): Element | undefined {
  const children = tree.props.children as any[];
  return children.length > 1 ? children[1] as Element : undefined;
}

test('the supplied child element stays inside the content view across quiet, shape and ready, then a later cycle', async () => {
  const marker = {mounts: 0}, child = makeChild(marker);
  const paint = mountPaint({ready: false, skeleton: {type: 'Shape', props: {}}, children: child});
  try {
    assert.equal(contentChild(paint.tree), child, 'a quiet render already holds the real child');
    const [id] = pending()[0]!;
    await act(() => {fire(id);});
    assert.ok(overlay(paint.tree), 'the shape paints after the quiet window');
    assert.equal(contentChild(paint.tree), child, 'the shape never replaces the child');

    paint.update({ready: true, skeleton: {type: 'Shape', props: {}}, children: child});
    await act(() => {});
    assert.equal(overlay(paint.tree), undefined, 'ready removes the shape');
    assert.equal(contentChild(paint.tree), child);

    paint.update({ready: false, skeleton: {type: 'Shape', props: {}}, children: child});
    const [again] = pending().sort((a, b) => a[1].delay - b[1].delay).at(-1)!;
    await act(() => {fire(again);});
    paint.update({ready: true, skeleton: {type: 'Shape', props: {}}, children: child});
    await act(() => {});
    assert.equal(contentChild(paint.tree), child, 'a later ready->loading->ready keeps the same child element');
    assert.equal(marker.mounts, 1);
  } finally {paint.host.unmount();}
});

test('a quiet completion from a retired cycle cannot paint in the next cycle or after unmount', async () => {
  const child = makeChild({mounts: 0});
  const paint = mountPaint({ready: false, skeleton: {type: 'Shape', props: {}}, children: child});
  const first = pending()[0]![0];
  paint.update({ready: true, skeleton: {type: 'Shape', props: {}}, children: child});
  await act(() => {});
  paint.update({ready: false, skeleton: {type: 'Shape', props: {}}, children: child});
  const second = pending().at(-1)![0];
  assert.notEqual(first, second, 'a new loading cycle owns a new timer');
  await act(() => {fire(first);});
  assert.equal(overlay(paint.tree), undefined, 'the retired cycle completion reveals nothing');
  await act(() => {fire(second);});
  assert.ok(overlay(paint.tree), 'only the current cycle completion paints the shape');
  paint.host.unmount();
  assert.doesNotThrow(() => {fire(second);});
});

test('changing the motion policy during quiet does not restart the original 300 ms window', async () => {
  const child = makeChild({mounts: 0});
  const paint = mountPaint({ready: false, skeleton: {type: 'Shape', props: {}}, children: child});
  try {
    const [timerId, timer] = pending()[0]!;
    assert.equal(timer.delay, 300);
    state.motion = {reduce: true, duration: (name: string) => (name === 'standard' ? 160 : 0)};
    paint.update({ready: false, skeleton: {type: 'Shape', props: {}}, children: child});
    await act(() => {});
    assert.equal(pending().length, 1, 'no new quiet timer was queued by the policy change');
    assert.equal(pending()[0]![0], timerId, 'the original timer is still the live one');
    await act(() => {fire(timerId);});
    assert.ok(overlay(paint.tree), 'the original quiet window still reveals the shape');
  } finally {paint.host.unmount(); state.motion = {reduce: false, duration: (name: string) => (name === 'standard' ? 180 : 0)};}
});

test('a policy change on painted content retargets the current opacity and a stopped completion cannot clear its successor', async () => {
  const child = makeChild({mounts: 0});
  const paint = mountPaint({ready: false, skeleton: {type: 'Shape', props: {}}, children: child});
  try {
    paint.update({ready: true, skeleton: {type: 'Shape', props: {}}, children: child});
    await act(() => {});
    const first = state.timings.at(-1)!;
    assert.equal(first.config.duration, 180, 'default motion fades over 180');
    assert.equal(first.started, true);
    const setValuesAfterEntry = state.setValues.length;

    state.motion = {reduce: true, duration: (name: string) => (name === 'standard' ? 160 : 0)};
    paint.update({ready: true, skeleton: {type: 'Shape', props: {}}, children: child});
    await act(() => {});
    const second = state.timings.at(-1)!;
    assert.equal(second.config.duration, 160, 'reduced motion retargets at 160');
    assert.deepEqual(second.config.easing, 'linear');
    assert.equal(state.setValues.length, setValuesAfterEntry, 'a policy change never resets paint to zero');
    assert.equal(first.stopped, true, 'the superseded fade is stopped');

    // Complete the superseded fade late: its stopped record must not clear or stop the successor.
    (first as any).finish?.();
    assert.equal(second.stopped, false, 'the successor fade is untouched by the retired completion');
    state.motion = {reduce: false, duration: (name: string) => (name === 'standard' ? 180 : 0)};
    paint.update({ready: true, skeleton: {type: 'Shape', props: {}}, children: child});
    await act(() => {});
    assert.equal(state.timings.at(-1)!.config.duration, 180, 'a third retarget still owns the fade after the old completion');
  } finally {paint.host.unmount(); state.motion = {reduce: false, duration: (name: string) => (name === 'standard' ? 180 : 0)};}
});

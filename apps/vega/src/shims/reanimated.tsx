import * as Vega from '@amazon-devices/react-native-kepler';
import React, {forwardRef, useRef, useState} from 'react';
import {Cell, inTurn, isMotion, timed, useComputed, type Curve, type Motion} from './motion';

/**
 * `react-native-reanimated`, as far as the shared screens use it, without the library (see
 * `motion.ts` for why it is not in this app). The names and their meaning are the library's:
 *
 * - `useSharedValue`: a value to read, set, or send somewhere with `withTiming`, `withSpring` or
 *   `withSequence`.
 * - `useAnimatedStyle`: a style computed from such values. Given to an `Animated` component, it
 *   is computed again, and that component alone is rendered again, each time a value it read
 *   changes: once per frame while something moves.
 * - `Animated.View` and its relatives, `Animated.createAnimatedComponent`: components that take
 *   those styles.
 * - `interpolateColor`, `runOnJS`, `Easing`.
 *
 * Anything else the library has is not here; shared code that starts using more of it fails to
 * compile for this app until it is added.
 */
export type SharedValue<Value = number> = {value: Value};

export function useSharedValue<Value>(initial: Value): SharedValue<Value> {
  return useState(() => new Cell(initial))[0];
}

/** The SDK's easing curves (the same functions, by the same names, as the library's). */
export const Easing = Vega.Easing;

type TimingConfig = {duration?: number; easing?: Curve};
type Callback = (finished?: boolean) => void;
// The library types these as the value they arrive at, so `shared.value = withTiming(1)` reads
// as an assignment of a number. What is assigned is a `Motion`, which the value then follows.
const asValue = <Value,>(motion: Motion): Value => motion as unknown as Value;

const standard: Curve = Vega.Easing.inOut(Vega.Easing.quad);

export function withTiming<Value extends number>(toValue: Value, config?: TimingConfig, callback?: Callback): Value {
  return asValue(timed(toValue, config?.duration ?? 300, config?.easing ?? standard, callback));
}

const settle: Curve = Vega.Easing.out(Vega.Easing.cubic);

/**
 * The library solves a spring; here a value sent with `withSpring` eases out to its target over
 * 350 ms. The shared code springs only a sheet released from a drag (touch).
 */
export function withSpring<Value extends number>(toValue: Value, _config?: object, callback?: Callback): Value {
  return asValue(timed(toValue, 350, settle, callback));
}

export function withSequence<Value extends number>(...steps: Value[]): Value {
  return asValue(inTurn(steps.map(step => (isMotion(step) ? step : (step as number)))));
}

/** Everything here already runs on the JavaScript thread; the call is made after the current one returns, as the library's is. */
export function runOnJS<Args extends unknown[]>(target: (...args: Args) => unknown): (...args: Args) => void {
  return (...args) => { void Promise.resolve().then(() => target(...args)); };
}

const channels = (color: string | number): [number, number, number, number] | undefined => {
  const packed = Vega.processColor(color);
  if (typeof packed !== 'number') return undefined;
  const bits = packed >>> 0;
  return [(bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255, (bits >>> 24) / 255];
};

/** The color at `value` along `outputRange`, mixed channel by channel. */
export function interpolateColor(value: number, inputRange: readonly number[], outputRange: readonly (string | number)[]): string {
  let upper = 1;
  while (upper < inputRange.length - 1 && value > inputRange[upper]) upper++;
  const span = inputRange[upper] - inputRange[upper - 1];
  const along = span === 0 ? 1 : Math.min(1, Math.max(0, (value - inputRange[upper - 1]) / span));
  const from = channels(outputRange[upper - 1]), to = channels(outputRange[upper]);
  if (!from || !to) return String(outputRange[along < 0.5 ? upper - 1 : upper]);
  const mix = (index: number) => from[index] + (to[index] - from[index]) * along;
  return `rgba(${Math.round(mix(0))}, ${Math.round(mix(1))}, ${Math.round(mix(2))}, ${Math.round(mix(3) * 1000) / 1000})`;
}

/** A style still to be computed: what `useAnimatedStyle` returns. */
class Computed {
  constructor(public compute: () => object) {}
}

export function useAnimatedStyle<Style extends object>(updater: () => Style, _dependencies?: readonly unknown[]): Style {
  // One object for the life of the component, always holding the latest updater.
  const computed = useRef<Computed | null>(null);
  if (computed.current) computed.current.compute = updater;
  else computed.current = new Computed(updater);
  return computed.current as unknown as Style;
}

const hasComputed = (style: unknown): boolean => (Array.isArray(style) ? style.some(hasComputed) : style instanceof Computed);
const resolve = (style: unknown): unknown => (Array.isArray(style) ? style.map(resolve) : style instanceof Computed ? style.compute() : style);

function animated<Props extends {style?: unknown}>(Base: React.ComponentType<any>): React.ComponentType<Props> {
  const Moving: React.ComponentType<any> = forwardRef<unknown, Props>(function Moving({style, ...props}, ref) {
    const resolved = useComputed(() => resolve(style));
    return <Base ref={ref} {...props} style={resolved} />;
  });
  // A component given no computed style is the component itself, with nothing to follow.
  return forwardRef<unknown, Props>(function Animated(props, ref) {
    return hasComputed(props.style) ? <Moving ref={ref} {...props} /> : <Base ref={ref} {...props} />;
  }) as unknown as React.ComponentType<Props>;
}

const made = new Map<unknown, React.ComponentType<any>>();

function createAnimatedComponent<Component extends React.ComponentType<any>>(component: Component): Component {
  let wrapped = made.get(component);
  if (!wrapped) made.set(component, (wrapped = animated(component)));
  return wrapped as Component;
}

const Animated = {
  View: createAnimatedComponent(Vega.View),
  Text: createAnimatedComponent(Vega.Text),
  Image: createAnimatedComponent(Vega.Image),
  ScrollView: createAnimatedComponent(Vega.ScrollView),
  createAnimatedComponent,
};
export default Animated;

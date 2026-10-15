/**
 * `react-native`, as the app and the shared screens (`apps/native/src`) see it on Vega.
 *
 * Everything is the Vega SDK's React Native except the exports below, which the shared code uses
 * with the names and behavior of the Apple TV build (react-native-tvos):
 *
 * - `NativeModules`: Portico's modules (`src/bridge`) by their Apple names, then the SDK's
 *   TurboModules. (The SDK's own `NativeModules` is the legacy bridge's, which this runtime does
 *   not have: reading it throws.)
 * - `NativeEventEmitter`: listens to a Portico module's events when given one.
 * - `requireNativeComponent`, `UIManager.hasViewManagerConfig`: Portico's views.
 * - `useTVEventHandler`: the remote's keys in the Apple TV's vocabulary.
 * - `TVEventControl`: the Apple TV's Menu-key switch, which has nothing to switch here.
 * - `Pressable`: `hasTVPreferredFocus` as a preference read once (see `pressable.tsx`).
 * - `TVFocusGuideView`: `focusable={false}` puts everything inside it out of the remote's reach
 *   (see `focus.tsx`).
 * - `TextInput`: `enablesReturnKeyAutomatically` without the SDK's failure, and a field's hidden
 *   input that exists only while it is typed into (see `text-input.tsx`).
 * - `ScrollView`, `FlatList`, `View`: rows and pages that follow focus, as `snapToAlignment="item"`
 *   and the `scrollSnap…` marks do on the Apple TV (see `snap.tsx`).
 * - `useWindowDimensions`, `Dimensions`, `PixelRatio`, `StyleSheet.hairlineWidth`, `Modal`: the
 *   1920×1080 design canvas the app is drawn on (see `canvas.tsx`).
 *
 * Metro resolves `react-native` to this file for everything outside node_modules
 * (metro.config.js); `src/bridge` and this folder import the SDK's package by its own name.
 */
import * as Vega from '@amazon-devices/react-native-kepler';
import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {porticoModules, porticoViewConfigs, porticoViews} from '../bridge';
import {eventsOf, type ModuleEvents} from '../bridge/events';
import {Canvas, canvasFor, currentCanvas} from './canvas';
import {keyboardHasBack} from './typing';
import {DebugConsole, debugConsole, trace} from '../debug';

export * from '@amazon-devices/react-native-kepler';
export {Pressable} from './pressable';
export {FlatList, ScrollView, View} from './snap';
export {TextInput} from './text-input';
export {TVFocusGuideView} from './focus';

const own = porticoModules as Record<string, unknown>;
const sdkModule = (name: string): unknown => {
  try { return Vega.TurboModuleRegistry.get(name) ?? undefined; } catch { return undefined; }
};
export const NativeModules: Record<string, any> = new Proxy(own, {
  get: (modules, name) => (typeof name !== 'string' ? undefined : name in modules ? modules[name] : sdkModule(name)),
  has: (modules, name) => typeof name === 'string' && (name in modules || sdkModule(name) !== undefined),
});

type Subscription = {remove(): void};

/** `new NativeEventEmitter(module)`: a Portico module's own events, or the SDK's emitter. */
export class NativeEventEmitter {
  private readonly events: ModuleEvents | undefined;
  private readonly native: InstanceType<typeof Vega.NativeEventEmitter> | undefined;

  constructor(module?: unknown) {
    this.events = eventsOf(module);
    if (!this.events) this.native = new Vega.NativeEventEmitter(module as never);
  }

  addListener(eventType: string, listener: (event: any) => void, context?: object): Subscription {
    if (this.events) return this.events.addListener(eventType, context ? listener.bind(context) : listener);
    return this.native!.addListener(eventType, listener, context);
  }

  removeAllListeners(eventType: string): void {
    if (this.events) this.events.removeAll(eventType);
    else this.native!.removeAllListeners(eventType);
  }

  listenerCount(eventType: string): number {
    return this.events ? this.events.count(eventType) : this.native!.listenerCount(eventType);
  }

  emit(eventType: string, ...params: unknown[]): void {
    if (this.events) this.events.emit(eventType, params[0]);
    else this.native!.emit(eventType, ...params);
  }
}

export function requireNativeComponent<T>(viewName: string): React.ComponentType<T> {
  return (porticoViews[viewName] ?? Vega.requireNativeComponent<T>(viewName)) as React.ComponentType<T>;
}

const sdkUIManager = Vega.UIManager as unknown as Record<string | symbol, unknown> & {hasViewManagerConfig?: (name: string) => boolean};
export const UIManager: typeof Vega.UIManager & {hasViewManagerConfig(name: string): boolean} = new Proxy(sdkUIManager, {
  get(target, name) {
    if (name === 'hasViewManagerConfig') return (view: string) => (view.startsWith('Portico') ? porticoViewConfigs.has(view) : target.hasViewManagerConfig?.(view) ?? false);
    return target[name];
  },
}) as never;

/**
 * On an Apple TV this decides whether Menu reaches the app or leaves it. Here Back always
 * reaches the app first (`BackHandler`), and leaves it when no screen takes it.
 */
export const TVEventControl = {
  enableTVMenuKey(): void {},
  disableTVMenuKey(): void {},
  enableTVPanGesture(): void {},
  disableTVPanGesture(): void {},
  enableGestureHandlersCancelTouches(): void {},
  disableGestureHandlersCancelTouches(): void {},
};

/** A remote event as the Apple TV build reports it. */
export type TVRemoteEvent = {eventType: string; eventKeyAction?: number; tag?: number; body?: unknown};

// The SDK names keys its own way and reports each press twice (down, then up). The Apple TV
// reports one event for a press and a `long…` pair for a key held down.
// (While something plays, the same keys arrive under other names: `play`, `forward`, `enter`.)
const appleNames: Record<string, string> = {
  playpause: 'playPause', play: 'playPause', pause: 'playPause',
  skip_backward: 'rewind', backward: 'rewind', rewind: 'rewind',
  skip_forward: 'fastForward', forward: 'fastForward', fastforward: 'fastForward',
  enter: 'select', back: 'menu',
};
const HOLD_MS = 500;
const longName = (name: string) => 'long' + name.charAt(0).toUpperCase() + name.slice(1);

export function useTVEventHandler(handler: (event: TVRemoteEvent) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  const held = useRef(new Map<string, {timer: ReturnType<typeof setTimeout>; long: boolean}>());
  useEffect(() => {
    const keys = held.current;
    return () => { for (const key of keys.values()) clearTimeout(key.timer); keys.clear(); };
  }, []);
  const translate = useCallback((raw: {eventType?: string; eventKeyAction?: number}) => {
    if (!raw || typeof raw.eventType !== 'string') return;
    // Back that closed the keyboard is not Back for the screen (see `typing.ts`).
    if (raw.eventType === 'back' && keyboardHasBack()) return;
    const name = appleNames[raw.eventType] ?? raw.eventType;
    trace(`key ${name}${raw.eventKeyAction === undefined ? '' : ' ' + raw.eventKeyAction}`);
    const keys = held.current;
    if (raw.eventKeyAction === 0) {
      // A held key repeats its "down"; only the first one starts the hold.
      if (keys.has(name)) return;
      const key = {long: false, timer: setTimeout(() => { key.long = true; latest.current({eventType: longName(name), eventKeyAction: 0}); }, HOLD_MS)};
      keys.set(name, key);
      return;
    }
    if (raw.eventKeyAction === 1) {
      const key = keys.get(name);
      keys.delete(name);
      if (key) clearTimeout(key.timer);
      latest.current(key?.long ? {eventType: longName(name), eventKeyAction: 1} : {eventType: name});
      return;
    }
    latest.current({eventType: name});
  }, []);
  Vega.useTVEventHandler(translate as never);
}

type Window = {width: number; height: number; scale: number; fontScale: number};
const asWindow = ({width, height, scale, fontScale}: Window): Window => ({width, height, scale, fontScale});

/** The design canvas, in place of the window. */
export function useWindowDimensions(): Window {
  const {width, height, scale, fontScale} = Vega.useWindowDimensions();
  return useMemo(() => asWindow(canvasFor({width, height, scale, fontScale})), [width, height, scale, fontScale]);
}

const sdkDimensions = Vega.Dimensions;
export const Dimensions: typeof Vega.Dimensions = new Proxy(sdkDimensions, {
  get(target, name) {
    if (name === 'get') return (_dimension: 'window' | 'screen') => asWindow(currentCanvas());
    if (name === 'addEventListener') {
      return (type: 'change', handler: (sizes: {window: Window; screen: Window}) => void) =>
        target.addEventListener(type, sizes => handler({window: asWindow(canvasFor(sizes.window)), screen: asWindow(canvasFor(sizes.screen))}));
    }
    return (target as unknown as Record<string | symbol, unknown>)[name];
  },
});

/** Pixels per canvas point: 1 on a 1080p screen. */
export const PixelRatio: typeof Vega.PixelRatio = new Proxy(Vega.PixelRatio, {
  get(target, name) {
    if (name === 'get') return () => currentCanvas().scale;
    if (name === 'getPixelSizeForLayoutSize') return (size: number) => Math.round(size * currentCanvas().scale);
    if (name === 'roundToNearestPixel') return (size: number) => { const ratio = currentCanvas().scale; return Math.round(size * ratio) / ratio; };
    return (target as unknown as Record<string | symbol, unknown>)[name];
  },
});

/** A hairline is one pixel: on the canvas, one over its pixel ratio. */
export const StyleSheet: typeof Vega.StyleSheet = new Proxy(Vega.StyleSheet, {
  get(target, name) {
    if (name === 'hairlineWidth') return 1 / Math.max(1, Math.round(currentCanvas().scale));
    return (target as unknown as Record<string | symbol, unknown>)[name];
  },
});

/** A modal is a window of its own, so its contents get the canvas too. */
export function Modal({children, ...props}: React.ComponentProps<typeof Vega.Modal>): React.ReactElement {
  return React.createElement(Vega.Modal, props, React.createElement(Canvas, null, children, debugConsole ? React.createElement(DebugConsole) : null));
}

/** Import/require this module only in DEV branches. It reads no auth, props or asset state. */
import {collectNativeScreen, type NativeViewport} from './collect.ts';
import {createNativeMeasurementRegistry, type HostFacts} from './registry.ts';
export type {HostFacts, HostRegistration, NativeTextLine, ResolvedStyle} from './registry.ts';
export type {NativeViewport} from './collect.ts';

const registry = createNativeMeasurementRegistry();
const dev = () => typeof __DEV__ !== 'undefined' && __DEV__;
export type NativeLayoutDumpOptions = Readonly<{
  root: () => object | null;
  viewport: () => NativeViewport;
  platform: 'android' | 'ios' | 'tvos';
  anchors?: Readonly<Record<string, string>>;
}>;
export type NativeLayoutDump = Readonly<{
  capture(options?: Readonly<{signal?: AbortSignal; timeoutMs?: number}>): Promise<Awaited<ReturnType<typeof collectNativeScreen>>>;
  dispose(): void;
}>;
let installed: NativeLayoutDump | undefined;

export function registerNativeHost(host: object, facts: HostFacts) {
  return dev() ? registry.register(host, facts) : undefined;
}

/** A single App owner installs a real full-screen ref; targeted primitives own registrations. */
export function installNativeLayoutDump(options: NativeLayoutDumpOptions): NativeLayoutDump | undefined {
  if (!dev()) return undefined;
  if (installed) throw new Error('A native layout dump owner is already installed.');
  const pending = new Set<AbortController>();
  let disposed = false;
  const api: NativeLayoutDump = {
    async capture(optionsForCapture: Readonly<{signal?: AbortSignal; timeoutMs?: number}> = {}) {
      if (disposed) throw new Error('Native layout dump owner was disposed.');
      const root = options.root();
      if (!root) throw new Error('A mounted whole-screen native root is required.');
      const timeoutMs = optionsForCapture.timeoutMs ?? 5000;
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000) throw new Error('Invalid native capture deadline.');
      const controller = new AbortController();
      const abort = () => controller.abort();
      optionsForCapture.signal?.addEventListener('abort', abort, {once: true});
      if (optionsForCapture.signal?.aborted) controller.abort();
      const timer = setTimeout(abort, timeoutMs);
      pending.add(controller);
      try {
        const measured = await collectNativeScreen({root, viewport: options.viewport(), platform: options.platform,
          anchors: options.anchors, registry, signal: controller.signal});
        if (controller.signal.aborted) throw new Error('Native layout capture was cancelled or reached its deadline.');
        if (disposed || options.root() !== root) throw new Error('Native root changed before capture completed.');
        return measured;
      } finally {
        clearTimeout(timer);
        pending.delete(controller);
        optionsForCapture.signal?.removeEventListener('abort', abort);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of pending) controller.abort();
      pending.clear();
      registry.retireEpoch();
      if (installed === api) installed = undefined;
    },
  };
  installed = api;
  return api;
}

/** No global payload logging or command endpoint is installed by the collector. */
export function captureNativeLayoutDump(options?: Readonly<{signal?: AbortSignal; timeoutMs?: number}>) {
  if (!dev() || !installed) throw new Error('Native layout dump is not installed in DEV.');
  return installed.capture(options);
}

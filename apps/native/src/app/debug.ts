import {useSyncExternalStore} from 'react';
import {redact} from './error-journal';

/** Tiny in-app trace for simulator debugging. DEV only; never ships output. */
const lines: string[] = [];
const listeners = new Set<() => void>();
export function trace(message: string) {
  if (!__DEV__) return;
  lines.push(`${new Date().toISOString().slice(11, 19)} ${redact(message)}`);
  if (lines.length > 12) lines.shift();
  for (const l of listeners) l();
}
export function useTrace(): readonly string[] {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => lines,
  );
}
/** Wrap a native module's promise methods with tracing. */
export function traceModule(name: string, module: Record<string, unknown> | undefined, methods: string[]) {
  if (!__DEV__ || !module) return;
  for (const method of methods) {
    const original = module[method];
    if (typeof original !== 'function' || (original as {traced?: boolean}).traced) continue;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const started = Date.now();
      trace(`${name}.${method}(${args.map(a => (typeof a === 'string' ? `<text ${a.length}>` : typeof a)).join(',')})`);
      try {
        const result = (original as (...a: unknown[]) => unknown).apply(this, args);
        if (result && typeof (result as Promise<unknown>).then === 'function')
          (result as Promise<unknown>).then(
            v => trace(`  ✓ ${name}.${method} ${Date.now() - started}ms ${typeof v === 'string' ? `<text ${v.length}>` : ''}`),
            e => trace(`  ✗ ${name}.${method} ${e instanceof Error ? e.message : String(e)}`),
          );
        return result;
      } catch (e) {
        trace(`  ✗ ${name}.${method} threw ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      }
    };
    (wrapped as {traced?: boolean}).traced = true;
    module[method] = wrapped;
  }
}

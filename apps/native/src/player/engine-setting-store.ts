import {defaultEngineSetting, type EngineSetting} from './engine-choice';

/**
 * The viewer's Player setting, where code outside React can read it: the capability publisher
 * sends it with the device's capability document (`engineSetting`), so the server plans for the
 * engine the viewer chose, and sends it again when it changes. The preferences provider is the
 * only writer.
 */
let current: EngineSetting = defaultEngineSetting;
const listeners = new Set<() => void>();
let waiting: (() => void)[] = [];

export const engineSettingStore = Object.freeze({
  get: (): EngineSetting => current,
  set(value: EngineSetting): void {
    if (value === current) return;
    current = value;
    listeners.forEach(listener => listener());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** The publisher has sent (or failed to send) the document that carries the current setting. */
  settled(): void {
    const done = waiting;
    waiting = [];
    done.forEach(resolve => resolve());
  },
  /** Resolves once the current setting has reached the server, or after `timeoutMs` at the latest. */
  whenSettled(timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, timeoutMs);
      waiting.push(() => { clearTimeout(timer); resolve(); });
    });
  },
});

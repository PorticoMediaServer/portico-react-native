import {defaultEngineSetting, type EngineSetting} from './engine-choice';

/**
 * The viewer's Player setting, where code outside React can read it: the capability publisher
 * sends it with the device's capability document (`engineSetting`), so the server plans for the
 * engine the viewer chose, and sends it again when it changes. The preferences provider is the
 * only writer.
 */
let current: EngineSetting = defaultEngineSetting;
const listeners = new Set<() => void>();
let revision = 0, settledRevision = -1;
const waiting = new Set<{revision: number; done: () => void}>();

export const engineSettingStore = Object.freeze({
  get: (): EngineSetting => current,
  set(value: EngineSetting): void {
    if (value === current) return;
    current = value;
    revision++;
    listeners.forEach(listener => listener());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  version: (): number => revision,
  /** Only the publication for this exact setting revision may release its waiting re-plan. */
  settled(publishedRevision: number): void {
    if (publishedRevision !== revision) return;
    settledRevision = publishedRevision;
    for (const waiter of [...waiting]) if (waiter.revision === publishedRevision) waiter.done();
  },
  /** Resolve once the wanted setting is published, or at the deadline. React may run the
   * player's effect before the preferences provider has mirrored its new value here. */
  whenSettled(timeoutMs: number, setting: EngineSetting = current): Promise<void> {
    const wanted = setting === current ? revision : revision + 1;
    if (settledRevision === wanted) return Promise.resolve();
    return new Promise(resolve => {
      const waiter = {revision: wanted, done: () => { clearTimeout(timer); waiting.delete(waiter); resolve(); }};
      const timer = setTimeout(waiter.done, timeoutMs);
      waiting.add(waiter);
    });
  },
});

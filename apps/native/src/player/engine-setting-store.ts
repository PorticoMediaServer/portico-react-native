import {defaultEngineSetting, type EngineSetting} from './engine-choice';

/** The viewer's "if something looks or sounds wrong" switches, kept by this device. */
export type PlaybackOverrides = Readonly<{forceStereo: boolean; disablePassthrough: boolean; disableHdr: boolean}>;
export const noOverrides: PlaybackOverrides = Object.freeze({forceStereo: false, disablePassthrough: false, disableHdr: false});

/** What the last capability probe found that Settings needs: whether there is a receiver to pass
 * sound through to, and whether this device shows or decodes HDR at all. Null until probed. */
export type ProbedDevice = Readonly<{audioPassthrough: boolean; hdr: boolean}>;

/**
 * The viewer's playback settings that this device keeps and the server plans from, where code
 * outside React can read them: the Player setting (`engineSetting`) and the three overrides. The
 * capability publisher sends them with the device's capability document and sends it again when
 * one changes. The preferences provider is the only writer.
 */
let current: EngineSetting = defaultEngineSetting;
let overrides: PlaybackOverrides = noOverrides;
let probed: ProbedDevice | null = null;
const listeners = new Set<() => void>();
const probeListeners = new Set<() => void>();
let revision = 0, settledRevision = -1;
const waiting = new Set<{revision: number; done: () => void}>();

function changed(): void {
  revision++;
  listeners.forEach(listener => listener());
}

export const engineSettingStore = Object.freeze({
  get: (): EngineSetting => current,
  set(value: EngineSetting): void {
    if (value === current) return;
    current = value;
    changed();
  },
  overrides: (): PlaybackOverrides => overrides,
  setOverrides(value: Partial<PlaybackOverrides>): void {
    const next = {forceStereo: value.forceStereo === true, disablePassthrough: value.disablePassthrough === true, disableHdr: value.disableHdr === true};
    if (next.forceStereo === overrides.forceStereo && next.disablePassthrough === overrides.disablePassthrough && next.disableHdr === overrides.disableHdr) return;
    overrides = Object.freeze(next);
    changed();
  },
  /** Called when the Player setting or an override changes. */
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
  /** Resolve once the settings as they stand now are published, or at the deadline. */
  whenCurrentSettled(timeoutMs: number): Promise<void> {
    const wanted = revision;
    if (settledRevision === wanted) return Promise.resolve();
    return new Promise(resolve => {
      const waiter = {revision: wanted, done: () => { clearTimeout(timer); waiting.delete(waiter); resolve(); }};
      const timer = setTimeout(waiter.done, timeoutMs);
      waiting.add(waiter);
    });
  },
  probed: (): ProbedDevice | null => probed,
  setProbed(value: ProbedDevice): void {
    if (probed && probed.audioPassthrough === value.audioPassthrough && probed.hdr === value.hdr) return;
    probed = Object.freeze({...value});
    probeListeners.forEach(listener => listener());
  },
  subscribeProbed(listener: () => void): () => void {
    probeListeners.add(listener);
    return () => { probeListeners.delete(listener); };
  },
});

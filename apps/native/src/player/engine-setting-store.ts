import {defaultEngineSetting, type EngineSetting} from './engine-choice';

/** The viewer's "if something looks or sounds wrong" switches, kept by this device. */
export type PlaybackOverrides = Readonly<{forceStereo: boolean; disablePassthrough: boolean; disableHdr: boolean}>;
export const noOverrides: PlaybackOverrides = Object.freeze({forceStereo: false, disablePassthrough: false, disableHdr: false});

/** What the viewer says the TV shows and plays, where the device cannot tell (Vega). Off: a
 * standard-range screen and two-channel sound. */
export type DeclaredOutputs = Readonly<{hdr: boolean; surround: boolean}>;
export const noDeclaredOutputs: DeclaredOutputs = Object.freeze({hdr: false, surround: false});

/** What the last capability probe found that Settings needs: whether there is a receiver to pass
 * sound through to, and whether this device shows or decodes HDR at all. Null until probed. */
export type ProbedDevice = Readonly<{audioPassthrough: boolean; hdr: boolean}>;

/**
 * The viewer's playback settings that this device keeps and the server plans from, where code
 * outside React can read them: the Player setting (`engineSetting`) and the three overrides. The
 * capability publisher sends them with the device's capability document and sends it again when
 * one changes. The preferences provider writes the Settings value; a player chosen inside the
 * player (`setSession`) stands in for it during that playback only, and is dropped before the
 * next playback starts.
 */
let device: EngineSetting = defaultEngineSetting;
let session: EngineSetting | null = null;
let current: EngineSetting = defaultEngineSetting;
let overrides: PlaybackOverrides = noOverrides;
let declared: DeclaredOutputs = noDeclaredOutputs;
let probed: ProbedDevice | null = null;
const listeners = new Set<() => void>();
const probeListeners = new Set<() => void>();
let revision = 0, settledRevision = -1;
// The Player setting in the last document the server holds (null until the first is published).
let settledSetting: EngineSetting | null = null;
const waiting = new Set<{revision: number; done: () => void}>();
// The device's saved values are read from its store when the app starts. Until they are in hand
// the values here are only the defaults, and publishing those would tell the server the viewer
// chose Automatic and no fixes, whatever they really chose.
let loaded = false;
const loadWaiters = new Set<() => void>();

function changed(): void {
  revision++;
  listeners.forEach(listener => listener());
}

function sync(): void {
  const next = session ?? device;
  if (next === current) return;
  current = next;
  changed();
}

export const engineSettingStore = Object.freeze({
  /** The setting in force: the one chosen in the player for this playback, else the Settings'. */
  get: (): EngineSetting => current,
  /** The Settings' value (the preferences provider). */
  set(value: EngineSetting): void {
    device = value;
    sync();
  },
  /** A player chosen in the player, for this playback; null goes back to the Settings. */
  setSession(value: EngineSetting | null): void {
    session = value;
    sync();
  },
  hasSession: (): boolean => session !== null,
  overrides: (): PlaybackOverrides => overrides,
  setOverrides(value: Partial<PlaybackOverrides>): void {
    const next = {forceStereo: value.forceStereo === true, disablePassthrough: value.disablePassthrough === true, disableHdr: value.disableHdr === true};
    if (next.forceStereo === overrides.forceStereo && next.disablePassthrough === overrides.disablePassthrough && next.disableHdr === overrides.disableHdr) return;
    overrides = Object.freeze(next);
    changed();
  },
  declared: (): DeclaredOutputs => declared,
  setDeclared(value: Partial<DeclaredOutputs>): void {
    const next = {hdr: value.hdr === true, surround: value.surround === true};
    if (next.hdr === declared.hdr && next.surround === declared.surround) return;
    declared = Object.freeze(next);
    changed();
  },
  /** Called when the Player setting, an override or a declared output changes. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  version: (): number => revision,
  /** Only the publication for this exact setting revision may release its waiting re-plan. */
  settled(publishedRevision: number): void {
    if (publishedRevision !== revision) return;
    settledRevision = publishedRevision;
    settledSetting = current;
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
  /** The device's saved values have been read (or it has none): what is here is the viewer's. */
  markLoaded(): void {
    if (loaded) return;
    loaded = true;
    for (const done of [...loadWaiters]) done();
    loadWaiters.clear();
  },
  /** The Player setting the server last received, which is what it plans a new session from;
   * null until the first document is published. */
  published: (): EngineSetting | null => settledSetting,
  /** Resolve once the saved values are in hand, or at the deadline (a store that never answers). */
  whenLoaded(timeoutMs: number): Promise<void> {
    if (loaded) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); loadWaiters.delete(done); resolve(); };
      const timer = setTimeout(done, timeoutMs);
      loadWaiters.add(done);
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

import type {CompositeId} from '../../../../packages/client-core/src/presentation/settings-structure';
import {engineSettings, parseEngineSetting} from './playback/engine-choice';
import type {NativeQueueStore} from './queue-storage';

export type NativePlaybackDeviceSetting = 'playerEngine' | 'forceStereo' | 'disablePassthrough' | 'disableHdr';
type Owner = Readonly<{current: () => boolean; subscribePreferences: (listener: () => void) => () => void}>;
type Ports = Readonly<{storage: Pick<NativeQueueStore, 'change'>; readRecord: () => unknown; acceptRecord: (raw: unknown) => void}>;
const sources = new WeakMap<Owner, NativeDeviceSettings>();
const object = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw);
const ended = () => Object.assign(new Error('native_device_settings_retired'), {name: 'AbortError'});
export function nativeDeviceSettingSupported(id: CompositeId): id is NativePlaybackDeviceSetting {
  return id === 'playerEngine' || id === 'forceStereo' || id === 'disablePassthrough' || id === 'disableHdr';
}

/** The four installation fields consumed by the actual playback runtime. The
 * bootstrap's committed record is the only snapshot; registry rows are not local shadows. */
export class NativeDeviceSettings {
  private readonly owner: Owner;
  private readonly ports: Ports;
  constructor(owner: Owner, ports: Ports) {this.owner = owner; this.ports = ports;}
  private assert() {if (!this.owner.current()) throw ended();}
  supports = nativeDeviceSettingSupported;
  read = (id: CompositeId): string | boolean | undefined => {
    this.assert(); if (!nativeDeviceSettingSupported(id)) return;
    const raw = this.ports.readRecord(), record = object(raw) ? raw : {};
    if (id === 'playerEngine') return parseEngineSetting(record.playerEngine);
    return record[id] === true;
  };
  subscribe = (listener: () => void): (() => void) => {
    this.assert(); return this.owner.subscribePreferences(() => {if (this.owner.current()) listener();});
  };
  write = async (id: CompositeId, value: string | boolean): Promise<void> => {
    this.assert();
    if (!nativeDeviceSettingSupported(id)) throw Object.assign(new Error('native_device_setting_unsupported'), {code: 'unsupported'});
    if (id === 'playerEngine' ? !engineSettings.some(setting => setting === value) : typeof value !== 'boolean') throw new Error('native_device_setting_value_invalid');
    await this.ports.storage.change('preferences:v1', raw => {
      this.assert();
      if (raw !== null && raw !== undefined && !object(raw)) throw new Error('native_device_settings_record_invalid');
      return {record: {...(object(raw) ? raw : {}), [id]: value}, value: undefined};
    });
    const observed = await this.ports.storage.change('preferences:v1', raw => {this.assert(); return {record: raw, value: raw};});
    this.assert(); this.ports.acceptRecord(observed);
  };
}

/** The bootstrap binds this once to its existing record/cache and playback
 * subscription. Borrowers never create a store, revision or optimistic update. */
export function bindNativeDeviceSettings(owner: Owner, ports: Ports): NativeDeviceSettings {
  if (!owner.current()) throw ended();
  if (sources.has(owner)) throw new Error('native_device_settings_already_bound');
  const source = new NativeDeviceSettings(owner, ports); sources.set(owner, source); return source;
}
export function nativeDeviceSettings(owner: Owner): NativeDeviceSettings {
  if (!owner.current()) throw ended();
  const source = sources.get(owner);
  if (!source) throw Object.assign(new Error('native_device_settings_unavailable'), {code: 'unsupported'});
  return source;
}

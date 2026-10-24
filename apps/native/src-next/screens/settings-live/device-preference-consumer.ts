import type {CompositeId} from '../../../../../packages/client-core/src/presentation/settings-structure';
import {settingsBinding, readSettingsBinding, settingsBindingPatch, type SettingsBindingValue} from '../../../../../packages/client-core/src/presentation/settings-bindings';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeServerPreferences, type NativeServerPreferences} from '../../platform/server-preferences';
import {bindNativeDevicePreferences} from '../settings/device-preference-bindings';

export type NativeDevicePreferenceValue = string | boolean;

type Row = Readonly<{
  /** The canonical Settings row whose codec owns the stored value. */
  row: string;
  /** The structure row's value from the codec's committed presentation. */
  shown: (current: unknown) => NativeDevicePreferenceValue | undefined;
  /** The canonical row value the codec writes for a structure row's value. */
  asked: (value: NativeDevicePreferenceValue) => unknown;
}>;

/** The native structure names a drawn device composite by the record key it
 * changes. Only single-key device rows the installed source can keep have a
 * canonical codec; multi-key TV outputs and keys the source does not keep stay
 * unavailable instead of being given an invented record shape. */
const rows: Readonly<Partial<Record<CompositeId, Row>>> = Object.freeze({
  forceStereo: Object.freeze({
    row: 'audioSubtitles.surround',
    shown: (current: unknown) => current === 'stereo' ? true : current === 'asis' ? false : undefined,
    asked: (value: NativeDevicePreferenceValue) => value === true ? 'stereo' : value === false ? 'asis' : undefined,
  }),
  disableHdr: Object.freeze({
    row: 'quality.disableHdr',
    shown: (current: unknown) => typeof current === 'boolean' ? current : undefined,
    asked: (value: NativeDevicePreferenceValue) => typeof value === 'boolean' ? value : undefined,
  }),
});

export type NativeDevicePreferences = Readonly<{
  read: (id: CompositeId) => NativeDevicePreferenceValue | undefined;
  write: (id: CompositeId, value: NativeDevicePreferenceValue) => Promise<NativeDevicePreferenceValue>;
  subscribe: (listener: () => void) => () => void;
}>;

const bound = new WeakMap<NativeShellBootstrapContext, NativeDevicePreferences>();
const unsupported = () => Object.assign(new Error('native_device_setting_unsupported'), {code: 'unsupported'});

/** A scoped caller of the one bootstrap-bound device source. The same context
 * always receives the same facade, so a page, its search results and a
 * replacement page share one source, one subscription and one owner. */
export function nativeDevicePreferences(context: NativeShellBootstrapContext): NativeDevicePreferences {
  const existing = bound.get(context);
  if (existing) return existing;
  const preferences = bindNativeDevicePreferences(context);
  let server: NativeServerPreferences | undefined;
  // The drawn device switch is a profile-device preference, never a fifth
  // installation record key. Borrow the already-installed source only on use.
  const motion = () => {
    try {server ??= nativeServerPreferences(context);} catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'unsupported') return;
      throw error;
    }
    const snapshot = server.getSnapshot(), binding = settingsBinding('appearance.motion');
    if (!binding || binding.form !== 'preferences' || binding.fields || binding.scope !== 'profile-device') return;
    const value = readSettingsBinding(binding, {preferences: snapshot});
    const document = snapshot.documents.find(item => item.scope === binding.scope);
    if (!value || !document || value.effective !== 'follow' && value.effective !== 'reduce') return;
    return {source: server, snapshot, binding, document, value};
  };
  const facade: NativeDevicePreferences = Object.freeze({
    read: id => {
      if (id === 'reduceMotion') {const current = motion(); return current ? current.value.effective === 'reduce' : undefined;}
      const row = rows[id];
      if (!row) return undefined;
      const value: SettingsBindingValue | undefined = preferences.read(row.row);
      return value ? row.shown(value.current) : undefined;
    },
    write: async (id, value) => {
      if (id === 'reduceMotion') {
        const current = motion();
        if (!current) throw unsupported();
        if (typeof value !== 'boolean') throw new Error('Invalid setting value.');
        const {source, snapshot, binding, document} = current;
        const patch = settingsBindingPatch(binding, value ? 'reduce' : 'follow', {preferences: snapshot});
        const written = patch.values[binding.key];
        if (patch.form !== 'preferences' || Object.keys(patch.values).length !== 1 || written !== 'follow' && written !== 'reduce') throw unsupported();
        await source.applyPreferences('profile-device', snapshot.deviceClass, document.revision, {[binding.key]: written});
        const confirmed = motion();
        if (!confirmed) throw new Error('native_device_preference_unreadable');
        return confirmed.value.effective === 'reduce';
      }
      const row = rows[id];
      if (!row) throw unsupported();
      const confirmed: SettingsBindingValue = await preferences.write(row.row, row.asked(value));
      const committed = row.shown(confirmed.current);
      if (committed === undefined) throw new Error('native_device_preference_unreadable');
      return committed;
    },
    subscribe: listener => preferences.subscribe(listener),
  });
  bound.set(context, facade);
  return facade;
}

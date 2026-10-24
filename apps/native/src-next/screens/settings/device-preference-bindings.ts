import {settingsBinding, readSettingsBinding, type SettingsBindingValue} from '../../../../../packages/client-core/src/presentation/settings-bindings';
import type {NativeDeviceSettings} from '../../platform/device-settings';

/** A Settings device row resolves only through the installed device source. */
export function readNativeDevicePreference(rowId: string, source: NativeDeviceSettings): SettingsBindingValue | undefined {
  const binding = settingsBinding(rowId);
  if (!binding || binding.form !== 'device' || binding.fields) return undefined;
  const key = binding.key;
  if (!source.supports(key)) return undefined;
  const value = source.read(key);
  if (value === undefined) return undefined;
  return readSettingsBinding(binding, {device: {[key]: value}}, rowId);
}

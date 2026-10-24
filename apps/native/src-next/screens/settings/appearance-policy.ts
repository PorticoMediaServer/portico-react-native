import {preferenceValue, type PreferenceSnapshot} from '../../../../../packages/client-core/src/preferences';

/** A missing or newer vocabulary is unsupported, not an invented device value. */
export function nativeAppearanceMotion(snapshot: PreferenceSnapshot): 'follow' | 'reduce' | undefined {
  if (!snapshot.registry.fields.some(field => field.key === 'appearance.motion')) return;
  const value = preferenceValue(snapshot, 'appearance.motion');
  return value === 'follow' || value === 'reduce' ? value : undefined;
}

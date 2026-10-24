import {preferenceValue, type PreferenceSnapshot} from '../../../../../packages/client-core/src/preferences';

/** A missing or newer vocabulary is unsupported, not an invented device value. */
export function nativeAppearanceMotion(snapshot: PreferenceSnapshot): 'follow' | 'reduce' | undefined {
  if (!snapshot.registry.fields.some(field => field.key === 'appearance.motion')) return;
  const value = preferenceValue(snapshot, 'appearance.motion');
  return value === 'follow' || value === 'reduce' ? value : undefined;
}

/** Ruling R46-TV-TEXT-SIZE: only the published enum is a confirmed preference. */
export function nativeAppearanceTextSize(snapshot: PreferenceSnapshot): 'standard' | 'large' | undefined {
  if (!snapshot.registry.fields.some(field => field.key === 'appearance.textSize')) return;
  const value = preferenceValue(snapshot, 'appearance.textSize');
  return value === 'standard' || value === 'large' ? value : undefined;
}

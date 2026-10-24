import {createI18n, defaultI18n, deviceRegion, resolveRegion, type DeviceRegion, type I18n} from '../../../../../packages/i18n/src';
import {regionPreferences} from '../../../../../packages/client-core/src/preference-effects';
import type {PreferenceSnapshot} from '../../../../../packages/client-core/src/preferences';
import type {TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';

type Owner = Readonly<{current: () => boolean; preferences: () => PreferenceSnapshot}>;
const keys = ['region.locale', 'region.hourCycle', 'region.formats', 'region.dateOrder', 'region.firstDay', 'region.sizeUnits'] as const;

/** Borrows the confirmed bootstrap snapshot. This memoises formatters, not a
 * preference reader, default, writer or independent preference lifetime. */
export function nativeRuntimeRegionText(owner: Owner, readDeviceRegion: () => DeviceRegion = deviceRegion): TextEnvironment {
  let previous: PreferenceSnapshot | undefined, text: I18n = defaultI18n;
  const current = () => {
    if (!owner.current()) throw Object.assign(new Error('native_runtime_region_retired'), {name: 'AbortError'});
    const snapshot = owner.preferences();
    if (snapshot !== previous) {
      // Older registries retain their existing runtime text. Do not invent the
      // missing regional fields or feed a partial projection to the resolver.
      text = keys.every(key => snapshot.registry.fields.some(field => field.key === key))
        ? createI18n(resolveRegion(regionPreferences(snapshot), readDeviceRegion())) : defaultI18n;
      previous = snapshot;
    }
    return text;
  };
  return Object.freeze({get t() {return current().t;}, get locale() {return current().locale;}});
}

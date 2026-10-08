import {useEffect, useMemo} from 'react';
import {I18nManager, NativeModules, Platform} from 'react-native';
import {createI18n, resolveRegion, type DeviceRegion, type I18n} from '../../../../packages/i18n/src/index';
import {setActiveI18n} from './errors';
import {setServiceI18n} from '../../../../packages/client-core/src/presentation/service-text';
import {useServerPreferences} from './server-preferences';

export type {I18n, MessageId} from '../../../../packages/i18n/src/index';

/**
 * The system's languages and time zone. Hermes' Intl reports the current locale and zone; the
 * ordered preferred-language list comes from the iOS/tvOS settings manager when it is present,
 * and on Android the system's locale (language and region, "en_GB") comes from React Native.
 */
function systemRegion(): DeviceRegion {
  let resolved: {locale?: string; timeZone?: string} = {};
  try {
    resolved = Intl.DateTimeFormat().resolvedOptions();
  } catch {
    /* runtime without Intl */
  }
  const settings = Platform.OS === 'ios' ? (NativeModules.SettingsManager?.settings as {AppleLanguages?: string[]; AppleLocale?: string} | undefined) : undefined;
  const languages = settings?.AppleLanguages?.filter(l => typeof l === 'string') ?? [];
  const system = Platform.OS === 'android' ? I18nManager.getConstants().localeIdentifier : settings?.AppleLocale;
  const locales = [system?.replace(/_/g, '-'), resolved.locale, ...languages].filter((l): l is string => !!l);
  return {locales: locales.length ? locales : ['en-US'], timeZone: resolved.timeZone};
}

const device = systemRegion();

/**
 * D-I18N: the viewer's catalogue and formatters. The server's `region.*` preferences (language,
 * clock) win; `auto` (and anything outside the shell, before a server answers) follows the system.
 * Times are always in the device's own time zone.
 */
export function useI18n(): I18n {
  const prefs = useServerPreferences();
  const locale = prefs.value<string>('region.locale', 'auto');
  const hourCycle = prefs.value<string>('region.hourCycle', 'auto') as 'auto' | 'h12' | 'h23';
  const i18n = useMemo(() => createI18n(resolveRegion({locale, hourCycle}, device)), [locale, hourCycle]);
  // Screen copy and the messages client-core services publish (Watch Together, account, DVR)
  // follow the same catalogue.
  useEffect(() => { setActiveI18n(i18n); setServiceI18n(i18n); }, [i18n]);
  return i18n;
}

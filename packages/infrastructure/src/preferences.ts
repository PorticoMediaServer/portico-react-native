import {Settings} from 'react-native';
import type {NetInfoStateType} from '@react-native-community/netinfo';

const INSTALLATION_STORAGE_KEY =
  'tv.getportico.installation-preferences.v1';

export const APPLE_INSTALLATION_PREFERENCES_VERSION = 1 as const;

export type AudioLanguageCode =
  | 'en' | 'fr' | 'es' | 'de' | 'it' | 'pt' | 'ja' | 'ko' | 'zh'
  | 'nl' | 'sv' | 'no' | 'da' | 'pl' | 'tr' | 'ru';
export type PreferredLanguage = 'original' | 'system' | AudioLanguageCode;
export type PreferredSubtitleLanguage =
  | 'off'
  | AudioLanguageCode;
export const UNLIMITED_DOWNLOAD_STORAGE_BYTES = Number.MAX_SAFE_INTEGER;
export type SeekIntervalSeconds = 10 | 15 | 30;

/** Only values owned by this Apple hardware installation remain local. */
export interface AppleInstallationPreferences {
  version: typeof APPLE_INSTALLATION_PREFERENCES_VERSION;
  downloadsWifiOnly: boolean;
  downloadsStorageLimitBytes: number;
  downloadsAutomaticNextEpisode: boolean;
}

export const defaultAppleInstallationPreferences: AppleInstallationPreferences =
  Object.freeze({
    version: APPLE_INSTALLATION_PREFERENCES_VERSION,
    downloadsWifiOnly: true,
    downloadsStorageLimitBytes: 20 * 1024 * 1024 * 1024,
    downloadsAutomaticNextEpisode: false,
  });

type Listener = () => void;

export interface AppleInstallationPreferenceStorage {
  readCurrent(): unknown;
  writeCurrent(serialized: string): void;
}

export function createAppleInstallationPreferencesStore(
  storage: AppleInstallationPreferenceStorage,
) {
  const listeners = new Set<Listener>();
  let cached = {...defaultAppleInstallationPreferences};
  let hydrated = false;
  const hydrateOnce = () => {
    if (hydrated) return;
    hydrated = true;
    const current = parseStoredObject(storage.readCurrent());
    if (current) {
      cached = sanitizeAppleInstallationPreferences(current);
    }
  };
  return {
    get(): AppleInstallationPreferences {
      hydrateOnce();
      return cached;
    },
    update(
      update: Partial<Omit<AppleInstallationPreferences, 'version'>>,
    ): AppleInstallationPreferences {
      hydrateOnce();
      cached = sanitizeAppleInstallationPreferences({
        ...cached,
        ...update,
        version: APPLE_INSTALLATION_PREFERENCES_VERSION,
      });
      storage.writeCurrent(JSON.stringify(cached));
      listeners.forEach(listener => listener());
      return cached;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const appleInstallationPreferences =
  createAppleInstallationPreferencesStore({
    readCurrent: () => Settings.get(INSTALLATION_STORAGE_KEY),
    writeCurrent: serialized =>
      Settings.set({[INSTALLATION_STORAGE_KEY]: serialized}),
  });

export function sanitizeAppleInstallationPreferences(
  value: unknown,
): AppleInstallationPreferences {
  if (!value || typeof value !== 'object')
    return {...defaultAppleInstallationPreferences};
  const input = value as Record<string, unknown>;
  return {
    version: APPLE_INSTALLATION_PREFERENCES_VERSION,
    downloadsWifiOnly: booleanOr(
      input.downloadsWifiOnly,
      defaultAppleInstallationPreferences.downloadsWifiOnly,
    ),
    downloadsStorageLimitBytes:
      input.downloadsStorageLimitBytes === UNLIMITED_DOWNLOAD_STORAGE_BYTES
        ? UNLIMITED_DOWNLOAD_STORAGE_BYTES
        : boundedIntegerOr(
            input.downloadsStorageLimitBytes,
            256 * 1024 * 1024,
            10 * 1024 * 1024 * 1024 * 1024,
            defaultAppleInstallationPreferences.downloadsStorageLimitBytes,
          ),
    downloadsAutomaticNextEpisode: booleanOr(
      input.downloadsAutomaticNextEpisode,
      defaultAppleInstallationPreferences.downloadsAutomaticNextEpisode,
    ),
  };
}

function parseStoredObject(value: unknown): Record<string, unknown> | undefined {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

export function languageMatches(
  preference: Exclude<PreferredLanguage, 'original' | 'system'>,
  language?: string,
): boolean {
  if (!language) return false;
  const normalized = language.trim().toLowerCase().replace('_', '-');
  const aliases: Record<
    Exclude<PreferredLanguage, 'original' | 'system'>,
    string[]
  > = {
    en: ['en', 'eng', 'english'],
    fr: ['fr', 'fra', 'fre', 'french', 'francais', 'français'],
    es: ['es', 'spa', 'spanish', 'espanol', 'español'],
    de: ['de', 'deu', 'ger', 'german', 'deutsch'],
    it: ['it', 'ita', 'italian', 'italiano'],
    pt: ['pt', 'por', 'portuguese', 'português'],
    ja: ['ja', 'jpn', 'japanese'],
    ko: ['ko', 'kor', 'korean'],
    zh: ['zh', 'zho', 'chi', 'chinese'],
    nl: ['nl', 'nld', 'dut', 'dutch'],
    sv: ['sv', 'swe', 'swedish'],
    no: ['no', 'nor', 'norwegian'],
    da: ['da', 'dan', 'danish'],
    pl: ['pl', 'pol', 'polish'],
    tr: ['tr', 'tur', 'turkish'],
    ru: ['ru', 'rus', 'russian'],
  };
  return aliases[preference].some(
    alias => normalized === alias || normalized.startsWith(`${alias}-`),
  );
}

export async function currentNetworkAllowsStreaming(
  allowCellular: boolean,
): Promise<boolean> {
  if (allowCellular) return true;
  const {default: NetInfo} = await import('@react-native-community/netinfo');
  const state = await NetInfo.fetch();
  return connectionTypeAllowsStreaming(state.type, allowCellular);
}

export function connectionTypeAllowsStreaming(
  type: NetInfoStateType | string,
  allowCellular: boolean,
): boolean {
  return allowCellular || type !== 'cellular';
}

export type ApplePlaybackNetworkContext = {
  networkClass: 'local' | 'wifi' | 'cellular' | 'unknown';
  transportClass: 'wifi' | 'cellular' | 'wired' | 'unknown';
};

/** Maps the native physical route to the portable playback network buckets. */
export function playbackNetworkContextForConnectionType(
  type: NetInfoStateType | string,
): ApplePlaybackNetworkContext {
  if (type === 'wifi')
    return {networkClass: 'wifi', transportClass: 'wifi'};
  if (type === 'cellular')
    return {networkClass: 'cellular', transportClass: 'cellular'};
  if (type === 'ethernet')
    return {networkClass: 'local', transportClass: 'wired'};
  return {networkClass: 'unknown', transportClass: 'unknown'};
}

export async function currentPlaybackNetworkContext(): Promise<ApplePlaybackNetworkContext> {
  const {default: NetInfo} = await import('@react-native-community/netinfo');
  const state = await NetInfo.fetch();
  return playbackNetworkContextForConnectionType(state.type);
}

export function subscribePlaybackNetworkContext(
  listener: (context: ApplePlaybackNetworkContext) => void,
): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  void import('@react-native-community/netinfo').then(({default: NetInfo}) => {
    if (cancelled) return;
    unsubscribe = NetInfo.addEventListener(state => {
      listener(playbackNetworkContextForConnectionType(state.type));
    });
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function boundedIntegerOr(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

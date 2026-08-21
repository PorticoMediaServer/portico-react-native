import {
  connectionTypeAllowsStreaming,
  createAppleInstallationPreferencesStore,
  defaultAppleInstallationPreferences,
  languageMatches,
  playbackNetworkContextForConnectionType,
  sanitizeAppleInstallationPreferences,
  UNLIMITED_DOWNLOAD_STORAGE_BYTES,
} from './preferences';

describe('Apple installation preferences', () => {
  test('uses clean installation defaults when no current record exists', () => {
    const store = createAppleInstallationPreferencesStore({
      readCurrent: () => undefined,
      writeCurrent: jest.fn(),
    });

    expect(store.get()).toEqual(defaultAppleInstallationPreferences);
  });

  test('uses safe defaults for malformed or future local values', () => {
    const store = createAppleInstallationPreferencesStore({
      readCurrent: () => JSON.stringify({version: 99, downloadsWifiOnly: 'no'}),
      writeCurrent: jest.fn(),
    });
    expect(store.get()).toEqual(defaultAppleInstallationPreferences);
  });

  test('preserves the explicit unlimited storage choice', () => {
    expect(sanitizeAppleInstallationPreferences({downloadsStorageLimitBytes: UNLIMITED_DOWNLOAD_STORAGE_BYTES}).downloadsStorageLimitBytes).toBe(UNLIMITED_DOWNLOAD_STORAGE_BYTES);
  });

  test('matches common server language forms without fuzzy cross-language matches', () => {
    expect(languageMatches('en', 'eng')).toBe(true);
    expect(languageMatches('fr', 'fr-CA')).toBe(true);
    expect(languageMatches('es', 'Spanish')).toBe(true);
    expect(languageMatches('en', 'French')).toBe(false);
  });

  test('blocks only cellular playback when the server-effective setting disables it', () => {
    expect(connectionTypeAllowsStreaming('cellular', false)).toBe(false);
    expect(connectionTypeAllowsStreaming('wifi', false)).toBe(true);
    expect(connectionTypeAllowsStreaming('unknown', false)).toBe(true);
    expect(connectionTypeAllowsStreaming('cellular', true)).toBe(true);
  });

  test('maps native connection types to portable playback network classes', () => {
    expect(playbackNetworkContextForConnectionType('ethernet')).toEqual({networkClass: 'local', transportClass: 'wired'});
    expect(playbackNetworkContextForConnectionType('wifi')).toEqual({networkClass: 'wifi', transportClass: 'wifi'});
    expect(playbackNetworkContextForConnectionType('cellular')).toEqual({networkClass: 'cellular', transportClass: 'cellular'});
    expect(playbackNetworkContextForConnectionType('unknown')).toEqual({networkClass: 'unknown', transportClass: 'unknown'});
  });
});

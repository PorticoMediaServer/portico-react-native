export {};
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: string): string;
  resolve(...paths: string[]): string;
};

const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const androidRoot = resolve(__dirname, '../android/src/main/java/tv/getportico/player');
const readNative = (name: string) => readFileSync(resolve(androidRoot, name), 'utf8');

describe('Android P07 source contract', () => {
  it('registers the runtime, player, NSD, and cleanup modules in both shells', () => {
    const mobileApplication = readFileSync(
      resolve(__dirname, '../../../apps/apple-mobile/android/app/src/main/java/tv/getportico/android/MainApplication.kt'),
      'utf8',
    );
    const tvApplication = readFileSync(
      resolve(__dirname, '../../../apps/apple-tv/android/app/src/main/java/tv/getportico/androidtv/MainApplication.kt'),
      'utf8',
    );
    expect(mobileApplication).toContain('add(PorticoAndroidPackage())');
    expect(tvApplication).toContain('add(PorticoAndroidPackage())');
    const registration = readNative('PorticoAndroidPackage.kt');
    expect(registration).toContain('PorticoRuntimeModule.NAME');
    expect(registration).toContain('PorticoCleanupQuarantineModule.NAME');
    expect(registration).toContain('PorticoNearbyDevicesModule.NAME');
    expect(registration).toContain('PorticoPlayerViewModule.NAME');
  });

  it('uses a real Media3 view and gates prepare on native capability evidence', () => {
    const view = readNative('PorticoPlayerView.kt');
    const manager = readNative('PorticoPlayerViewManager.kt');
    expect(view).toContain('ExoPlayer.Builder');
    expect(view).toContain('androidx.media3.ui.PlayerView');
    expect(view).not.toContain('StyledPlayerView');
    expect(view).toContain('HlsMediaSource.Factory');
    expect(view).toContain('DefaultHttpDataSource.Factory');
    expect(view).toContain('runtimeStatus != "available"');
    expect(view).toContain('capabilityStatus != "available"');
    expect(view).toContain('API_RESOURCE_PATH_PATTERN');
    expect(manager).toContain('PorticoPlayerEvent.EVENT_CAPABILITIES');
    expect(manager).toContain('PorticoPlayerEvent.EVENT_ERROR');
    expect(manager).toContain('PorticoPlayerEvent.EVENT_TRACKS');
  });

  it('binds the one ExoPlayer to a MediaSession background service', () => {
    const view = readNative('PorticoPlayerView.kt');
    const authority = readNative('PorticoMediaSessionAuthority.kt');
    const service = readNative('PorticoMediaSessionService.kt');
    expect(view).toContain('PorticoMediaSessionAuthority.attach(context, player, contentMode)');
    expect(view).toContain('PorticoMediaSessionAuthority.detach(context, player)');
    expect(authority).toContain('MediaSession.Builder(context.applicationContext, player)');
    expect(authority).toContain('startForegroundService');
    expect(service).toContain('class PorticoMediaSessionService : MediaSessionService()');
    expect(service).toContain('PorticoMediaSessionAuthority.currentSession()');
    expect(authority.match(/ExoPlayer\.Builder/g)).toBeNull();
    expect(service.match(/ExoPlayer\.Builder/g)).toBeNull();
  });

  it('keeps the Android player boundary descriptor-, generation-, and track-command-fenced', () => {
    const view = readNative('PorticoPlayerView.kt');
    const module = readNative('PorticoPlayerViewModule.kt');
    const bridge = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');
    expect(view).toContain('setPlaybackDescriptor');
    expect(view).toContain('validatePlaybackDescriptor');
    expect(view).toContain('descriptor.generation != playbackGeneration');
    expect(view).toContain('token.isEmpty()');
    expect(view).toContain('HttpDataSource.InvalidResponseCodeException');
    expect(view).toContain('renewalRequired');
    expect(view).toContain('seekableStartSeconds');
    expect(view).toContain('timelineType');
    expect(view).toContain('emitTracks');
    expect(view).toContain('TrackSelectionOverride');
    expect(module).toContain('playAtGeneration');
    expect(module).toContain('seekToAtGeneration');
    expect(module).toContain('setVolumeAtGeneration');
    expect(view).toContain('player.volume = volume.coerceIn(0.0, 1.0).toFloat()');
    expect(module).toContain('selectAudioTrack');
    expect(module).toContain('selectTextTrack');
    expect(module).toContain('rejectUnfencedCommand');
    expect(bridge).toContain('playAtGeneration');
    expect(bridge).toContain('setVolumeAtGeneration');
    expect(bridge).toContain('selectAudioTrack');
    expect(bridge).toContain('onPlaybackTracks');
  });

  it('keeps NSD transient, deduped, bounded, and credential-free', () => {
    const source = readNative('PorticoNearbyDevicesModule.kt');
    expect(source).toContain('NsdManager');
    expect(source).toContain('startBrowsing');
    expect(source).toContain('RESOLVE_TIMEOUT_MS');
    expect(source).toContain('emitted');
    expect(source).toContain('PORTICO_ANDROID_ADVERTISING_UNAVAILABLE');
    expect(source).toContain('isCredentialKey');
    expect(source).toContain('CREDENTIAL_KEY_PARTS');
    expect(source).not.toContain('access_token');
  });

  it('fences stale NSD callbacks, cancels resolve timers, and recovers across networks', () => {
    const source = readNative('PorticoNearbyDevicesModule.kt');
    expect(source).toContain('browseEpoch');
    expect(source).toContain('connectivityEpoch');
    expect(source).toContain('destroyed');
    expect(source).toContain('isActiveDiscovery');
    expect(source).toContain('isActiveResolve');
    expect(source).toContain('resolveTimeouts');
    expect(source).toContain('handler.removeCallbacks');
    expect(source).toContain('ConnectivityManager.NetworkCallback');
    expect(source).toContain('registerDefaultNetworkCallback');
    expect(source).toContain('unregisterNetworkCallback');
    expect(source).toContain('override fun onAvailable(network: Network)');
    expect(source).toContain('override fun onLost(network: Network)');
    expect(source).toContain('PORTICO_ANDROID_NSD_NETWORK_UNAVAILABLE');
    expect(source).toContain('NETWORK_RECOVERY_DEBOUNCE_MS');
  });

  it('uses device-protected, checksummed, fail-closed cleanup storage', () => {
    const store = readNative('PorticoDeviceProtectedCleanupStore.kt');
    const module = readNative('PorticoCleanupQuarantineModule.kt');
    expect(store).toContain('createDeviceProtectedStorageContext');
    expect(store).toContain('MessageDigest');
    expect(store).toContain('.commit()');
    expect(store).toContain('unknown fields');
    expect(store).toContain('PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT');
    expect(module).toContain('PorticoDeviceProtectedCleanupStore');
  });

  it('does not route Android identity through the shared Apple descriptor', () => {
    const source = [
      readNative('PorticoAndroidRuntime.kt'),
      readNative('PorticoRuntimeModule.kt'),
      readNative('PorticoPlayerViewModule.kt'),
      readNative('PorticoAndroidPackage.kt'),
    ].join('\n');
    expect(source).not.toContain('porticoClientDescriptor');
    expect(source).not.toContain('applePlaybackProfile');
    expect(source).not.toMatch(/\b(iOS|tvOS|ios|tvos)\b/);
  });
});

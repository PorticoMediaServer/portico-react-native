import {revisionRequiredFetch} from './revision-required-fetch';
import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import {
  HttpLocalApi,
  knownServerRoutes,
  assertFirstContactIdentity,
  type CredentialSessionService,
  type LocalSession,
} from '../../../../packages/client-core/src/index.ts';
import {
  RouteError,
  routeBase64,
  routeBytes,
  privateRouteHost,
  type RouteCrypto,
} from '../../../../packages/client-core/src/route-identity.ts';
import {
  type RouteConnection,
  type DiscoveryRoute,
  sessionRoute,
} from '../../../../packages/client-core/src/route-connection.ts';
import {
  forgetNativeSession,
  restoreNativeSession,
  type ConnectionEnvironment,
  type HostedConnectionSource,
} from '../../../../packages/client-core/src/server-connections.ts';
import {nativeAppSessions} from './app-session-storage';
import type {NewServerConnection} from '../../../../packages/client-core/src/app-sessions';
import { routePath } from '../../../../packages/contracts/src/routes.ts';
import { checkApplePlainHttp } from './apple-plain-http';
import { isAccountAuthority } from './account-authority';
import {homeActionDiagnostics} from './home-action-diagnostics';
import { certificateOrigin, parseSavedCertificates, savedCertificateOrigin, settleCertificate, type CertificateContext, type CertificatePlatform, type SavedCertificate } from './certificate-trust';
/** One request through the native transport, as it is. */
const nativeRequest: typeof fetch = async (input, options = {}) => {
  if (
    typeof input !== 'string' ||
    options.signal?.aborted ||
    (options.body != null && typeof options.body !== 'string')
  )
    throw new RouteError('cancelled', 'Connection request cancelled.');
  const id = NativeModules.PorticoRuntime.playbackRequestId(),
    cancel = () => NativeModules.PorticoRuntime.cancelQueueRequest(id);
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const headers: Record<string, string> = {};
    new Headers(options.headers).forEach((v, k) => (headers[k] = v));
    let raw: {status: number; headers: Record<string, string>; body: string};
    const diagnostic = homeActionDiagnostics.request(options.method ?? 'GET', input);
    try {
      raw = await NativeModules.PorticoRuntime.networkRequest(
        id,
        input,
        options.method ?? 'GET',
        headers,
        options.body ?? null,
      );
    } catch (error) {
      homeActionDiagnostics.rejected(diagnostic, error);
      // The caller gave up on it: that is a cancellation, whatever the transport said as it stopped.
      if (options.signal?.aborted) throw new RouteError('cancelled', 'Connection request cancelled.');
      throw error;
    }
    homeActionDiagnostics.response(diagnostic, raw.status);
    if (options.signal?.aborted)
      throw new RouteError('cancelled', 'Connection request cancelled.');
    return new Response(
      [204, 205, 304].includes(raw.status) ? null : raw.body,
      { status: raw.status, headers: raw.headers },
    );
  } finally {
    options.signal?.removeEventListener('abort', cancel);
  }
};
/**
 * The native transport for every API request. On Apple, plain HTTP to an address off the local
 * network is refused here with the reason (the system would refuse it anyway). A request that
 * meets the owner's own certificate settles it (`certificate-trust.ts`) and is retried once.
 */
function nativeFetchForIdentity(expected?: string): typeof fetch {return revisionRequiredFetch(async (input, options = {}) => {
  if (Platform.OS === 'ios' && typeof input === 'string') checkApplePlainHttp(input);
  const origin = typeof input === 'string' && !isAccountAuthority(input) ? certificateOrigin(input) : undefined;
  const decision: CertificateContext = async proof => {
    const state = await nativeAppSessions.read();
    if (options.signal?.aborted) throw new RouteError('cancelled', 'certificate_decision_cancelled');
    const knownRoutes = knownServerRoutes(state);
    assertFirstContactIdentity(origin!, proof, {linkId: expected, knownRoutes});
    // Bonjour's fp is the identity-key hash, never a TLS fingerprint. Its home
    // qualification must come from the canonical fresh-v2/key/TXT/observed-leaf
    // conjunction. That checked guard has not been published/intaken yet; no
    // discovery record grants home authority in this source-only draft.
    const home = privateRouteHost(new URL(origin!).hostname);
    return {expected, home, knownServerIds: state.servers.map(value => value.connection.pin.serverId)};
  };
  try {
    const result = await nativeRequest(input, options);
    // A Portico-pinned leaf can complete TLS while the system still refuses it. It must
    // pass the same identity decision, rather than masquerade as system trust.
    if (origin && certificateTrustAvailable() && await nativeCertificatePlatform.refused(origin))
      await settleCertificate(origin, nativeCertificatePlatform, nativeRouteCrypto, decision, options.signal ?? undefined);
    return result;
  } catch (error) {
    // An owner's own certificate is settled only for the owner's server, never the account service (NS-02).
    if (!origin || (error as {code?: unknown})?.code !== 'certificate_untrusted' || !certificateTrustAvailable()) throw error;
    await settleCertificate(origin, nativeCertificatePlatform, nativeRouteCrypto, decision, options.signal ?? undefined);
    return nativeRequest(input, options);
  }
});}
export const nativeNetworkFetch = nativeFetchForIdentity();
/** Expected identity stays captured for every route probe and authenticated request. */
export const nativeServerFetch = (serverId: string) => nativeFetchForIdentity(serverId);
/** Whether this device can trust an owner's own certificate (Android and Apple; not Vega). */
export function certificateTrustAvailable(): boolean {
  return typeof NativeModules.PorticoNetwork?.refusedCertificate === 'function';
}
/** Every certificate this device trusts at an address (none on a device that cannot trust one). */
export async function savedCertificates(): Promise<SavedCertificate[]> {
  if (typeof NativeModules.PorticoNetwork?.pinnedCertificates !== 'function') return [];
  return parseSavedCertificates(await NativeModules.PorticoNetwork.pinnedCertificates());
}
/** Stops trusting the certificate saved at `address`: the next connection there checks it again. */
export function forgetSavedCertificate(address: string): void {
  NativeModules.PorticoNetwork?.forgetCertificate?.(savedCertificateOrigin(address));
}
export const nativeCertificatePlatform: CertificatePlatform = {
  refused: async origin => {
    const found = await NativeModules.PorticoNetwork.refusedCertificate(origin);
    return typeof found?.fingerprint === 'string' ? found.fingerprint : undefined;
  },
  pinned: async origin => {
    const found = await NativeModules.PorticoNetwork.pinnedCertificate(origin);
    return typeof found?.fingerprint === 'string' && typeof found?.serverId === 'string' ? {fingerprint: found.fingerprint, serverId: found.serverId} : undefined;
  },
  pin: async (origin, pin) => {
    await NativeModules.PorticoNetwork.pinCertificate(origin, pin.fingerprint, pin.serverId);
  },
  // The identity proof only: its exact address, method and body, over the one certificate.
  proofFetcher: (origin, fingerprint) => async (input, options = {}) => {
    if (typeof input !== 'string' || input !== origin + routePath('prove_network_identity') || options.method !== 'POST' || typeof options.body !== 'string')
      throw new RouteError('cancelled', 'Connection request cancelled.');
    const raw = await NativeModules.PorticoNetwork.proofRequest(origin, fingerprint, options.body);
    if (options.signal?.aborted) throw new RouteError('cancelled', 'Connection request cancelled.');
    return new Response(raw.body, {status: raw.status, headers: raw.headers});
  },
};
export const nativeRouteCrypto: RouteCrypto = {
  random: n => {
    const values = NativeModules.PorticoRuntime.playbackRandomBytes(n);
    if (
      !Array.isArray(values) ||
      values.length !== n ||
      values.some(v => !Number.isInteger(v) || v < 0 || v > 255)
    )
      throw new RouteError(
        'random_unavailable',
        'Secure connection verification is unavailable.',
      );
    return new Uint8Array(values);
  },
  sha256: async data =>
    routeBytes(await NativeModules.PorticoNetwork.sha256(routeBase64(data)), 32),
  verify: async (publicKey, signature, payload) =>
    !!(await NativeModules.PorticoNetwork.verify(
      routeBase64(publicKey),
      routeBase64(signature),
      routeBase64(payload),
    )),
};
export async function browseNearby(
  kind: 'servers' | 'tv' | 'players',
  signal: AbortSignal,
): Promise<readonly unknown[]> {
  if (signal.aborted) throw new RouteError('cancelled', 'Discovery cancelled.');
  const id = NativeModules.PorticoRuntime.playbackRequestId(),
    cancel = () => NativeModules.PorticoNetwork.cancelBrowse(id);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await NativeModules.PorticoNetwork.browse(id, kind);
    if (signal.aborted)
      throw new RouteError('cancelled', 'Discovery cancelled.');
    return Array.isArray(result) ? result : [];
  } catch (e) {
    if (
      typeof e === 'object' &&
      e &&
      (e as { code?: string }).code === 'permission_denied'
    )
      throw new RouteError(
        'permission_denied',
        'Local Network access is denied. Manual addresses and TV codes still work.',
      );
    throw e;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
const nativeEnvironment = {
  fetcher: nativeNetworkFetch,
  crypto: nativeRouteCrypto,
  discover: async (signal: AbortSignal) =>
    (await browseNearby('servers', signal)) as readonly DiscoveryRoute[],
};
/** Capture one server for the whole runtime. A later switch never retargets its refresh writes. */
export function nativeServerEnvironment(serverId: string, admission?: NewServerConnection): ConnectionEnvironment {
  return {...nativeEnvironment, fetcher: nativeServerFetch(serverId), storage: nativeAppSessions.connectionStorage(serverId, admission)};
}
export function nativeSelectedConnectionEnvironment(): ConnectionEnvironment {
  return {...nativeEnvironment, storage: nativeAppSessions.selectedStorage()};
}

let activeApi: HttpLocalApi | undefined,
  transport = 'unknown';
let active: RouteConnection | undefined,
  monitoring = false,
  revision = 0;
export function trackNativeConnection(api: HttpLocalApi) {
  const next = api.getRouteConnection();
  if (active && active !== next) {
    const retired = active;
    setTimeout(() => retired.dispose(), 16000);
  }
  active = next;
  // Which surface this is and what it is connected over scope the viewer's quality preferences.
  // Both are plain declarations; the server decides what they mean.
  activeApi = api;
  api.setDeviceClass(Platform.isTV ? 'television' : 'mobile');
  api.setTransportClass(transport);
  active?.setForeground(AppState.currentState === 'active');
  ensureMonitoring();
}
const networkListeners = new Set<() => void>();
function ensureMonitoring() {
  if (monitoring) return;
  monitoring = true;
  new NativeEventEmitter(NativeModules.PorticoNetwork).addListener(
    'portico.network',
    (event?: {transport?: string}) => {
      transport = event?.transport ?? transport;
      activeApi?.setTransportClass(transport);
      active?.networkChanged(String(++revision));
      for (const listener of networkListeners) listener();
    },
  );
  NativeModules.PorticoNetwork.startMonitoring();
  let previous = AppState.currentState;
  AppState.addEventListener('change', state => {
    active?.setForeground(state === 'active');
    if (state === 'active' && previous !== 'active')
      active?.foregroundActivity();
    previous = state;
  });
}
/** Called when the device's network path changes (Wi-Fi to cellular, back online). */
export function onNetworkChange(listener: () => void): () => void {
  ensureMonitoring();
  networkListeners.add(listener);
  return () => {
    networkListeners.delete(listener);
  };
}
export function nativeHostedSource(
  origin: string,
  credentials: CredentialSessionService,
  accountId: string,
): HostedConnectionSource {
  return {
    origin,
    accountId,
    request: async <T>(path: string, signal: AbortSignal) => {
      await credentials.synchronize();
      const session = await credentials.accessSession();
      if (signal.aborted || session.account.id !== accountId)
        throw new RouteError(
          'account_changed',
          'Your Portico Account changed.',
        );
      return new HttpLocalApi(
        origin,
        session.accessToken,
        nativeNetworkFetch,
      ).request<T>(path, 'GET', undefined, signal);
    },
  };
}
export async function restoreNativeConnection(
  origin: string,
  credentials: CredentialSessionService | undefined,
  expected: LocalSession,
  env = nativeServerEnvironment(expected.viewer.serverId),
) {
  return restoreNativeSession(
    env,
    record =>
      record.hosted && credentials && record.hosted.origin === origin
        ? nativeHostedSource(origin, credentials, record.hosted.accountId)
        : undefined,
    expected,
  );
}
export async function forgetNativeConnection(session: LocalSession) {
  const captured = sessionRoute(session.accessToken);
  const env = nativeServerEnvironment(session.viewer.serverId);
  await forgetNativeSession(env, session);
  const retained = await env.storage.read();
  if (retained && sessionRoute(retained.session.accessToken) === captured)
    return;
  if (active === captured) active = undefined;
  setTimeout(() => {
    if (active !== captured) captured?.dispose();
  }, 16000);
}

/** Play on: a signed-in Portico player found on this network (opaque ids only). */
export type NearbyAdvert = {receiverId: string; serverId: string; name: string; kind: 'tv' | 'phone' | 'tablet' | 'computer'};

/** Play on: this device is a player others may send to (only while it is ready to receive). */
export function advertisePlayer(advert: NearbyAdvert): void {
  void NativeModules.PorticoNetwork?.advertisePlayer?.(advert)?.catch?.(() => {});
}
export function stopPlayerAdvertisement(): void {
  NativeModules.PorticoNetwork?.stopPlayerAdvertisement?.();
}

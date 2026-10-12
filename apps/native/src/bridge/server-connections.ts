import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import {
  HttpLocalApi,
  type CredentialSessionService,
  type LocalSession,
} from '../../../../packages/client-core/src/index.ts';
import {
  RouteError,
  routeBase64,
  routeBytes,
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
  type ServerConnectionStorage,
  type RememberedServer,
  type HostedConnectionSource,
} from '../../../../packages/client-core/src/server-connections.ts';
import { NativeQueueStore } from './queue-storage';
const storageKey = 'network.selected.v1';
const store = new NativeQueueStore();
// A saved connection that is there but can never be read ends the sign-in (the shared code tells
// it by this code); a store that cannot be read right now keeps it. A change treats the damaged
// record as absent, so the next sign-in saves over it and anything else leaves it untouched.
const damaged = () =>
  new RouteError(
    'invalid_saved_connection',
    'Saved server credentials are incomplete.',
  );
const storage: ServerConnectionStorage = {
  read: () =>
    store.change(
      storageKey,
      raw => ({
        record: raw,
        value: raw === null ? undefined : (raw as RememberedServer),
      }),
      { error: damaged },
    ),
  change: async update => {
    await store.change(
      storageKey,
      raw => ({
        record:
          update(raw === null ? undefined : (raw as RememberedServer)) ?? null,
        value: undefined,
      }),
      { error: damaged, replace: true },
    );
  },
};
export const nativeNetworkFetch: typeof fetch = async (input, options = {}) => {
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
    const raw = await NativeModules.PorticoRuntime.networkRequest(
      id,
      input,
      options.method ?? 'GET',
      headers,
      options.body ?? null,
    );
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
export const nativeConnectionEnvironment: ConnectionEnvironment = {
  storage,
  fetcher: nativeNetworkFetch,
  crypto: nativeRouteCrypto,
  discover: async signal =>
    (await browseNearby('servers', signal)) as readonly DiscoveryRoute[],
};
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
) {
  return restoreNativeSession(
    nativeConnectionEnvironment,
    record =>
      record.hosted && credentials && record.hosted.origin === origin
        ? nativeHostedSource(origin, credentials, record.hosted.accountId)
        : undefined,
    expected,
  );
}
export async function forgetNativeConnection(session: LocalSession) {
  const captured = sessionRoute(session.accessToken);
  await forgetNativeSession(nativeConnectionEnvironment, session);
  const retained = await nativeConnectionEnvironment.storage.read();
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

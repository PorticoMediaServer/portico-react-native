import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {
  dedupePorticoDiscoveryRecords,
  normalizePorticoDiscoveryRecord,
  PORTICO_LAN_SERVICE_TYPE,
  type NormalizedPorticoDiscoveryRecord,
} from '@porticomediaserver/client-core';
import {formatTVSetupCode} from './tvSetupCode';
import {
  parseAuthorizedNearbyReceiver,
  PORTICO_RECEIVER_SERVICE_TYPE,
  receiverAdvertisementTXT,
  type NearbyAuthorizedReceiver,
  type NearbyReceiverAdvertisement,
  type ReceiverControllerGrant,
} from './playbackReceiver';
import {porticoDiagnostics} from './supportDiagnostics';
import {getPorticoRuntimeDescriptor} from './types';

export const PORTICO_SETUP_SERVICE_TYPE = '_portico-setup._tcp' as const;
export const PORTICO_SETUP_PROTOCOL_VERSION = 1 as const;

export interface NearbyTVSetupAdvertisement {
  setupSessionId: string;
  code: string;
  devicePublicKey: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  expiresAt: string;
  protocolVersion: typeof PORTICO_SETUP_PROTOCOL_VERSION;
}

export interface NearbyPorticoSetupDevice extends NearbyTVSetupAdvertisement {
  id: string;
  instanceName: string;
  serviceType: typeof PORTICO_SETUP_SERVICE_TYPE;
}

type NativeDiscoveryEvent = {
  action?: unknown;
  instanceName?: unknown;
  serviceType?: unknown;
  txt?: unknown;
  hostName?: unknown;
  port?: unknown;
  addresses?: unknown;
};

type NativeNearbyDevicesModule = {
  startBrowsing(serviceTypes: string[]): Promise<void>;
  stopBrowsing(): Promise<void>;
  startAdvertisingSetup(instanceName: string, txt: Record<string, string>): Promise<void>;
  stopAdvertisingSetup(): Promise<void>;
  startAdvertisingReceiver(instanceName: string, port: number, txt: Record<string, string>): Promise<void>;
  stopAdvertisingReceiver(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  logDiagnostic?(stage: string, details: Readonly<Record<string, string | number | boolean>>): void;
};

const nativeModule = NativeModules.PorticoNearbyDevices as NativeNearbyDevicesModule | undefined;

/** Emits a deliberately sanitized diagnostic through the native device log. */
export function logNativeDiagnostic(
  stage: string,
  details: Readonly<Record<string, string | number | boolean>>,
): void {
  const event = porticoDiagnostics.record(stage, details);
  try {
    nativeModule?.logDiagnostic?.(event.stage, event.details);
  } catch {
    // Native diagnostics are best effort and must never break the caller.
  }
}

type NativeDiscoverySubscription = {
  serviceTypes: ReadonlySet<string>;
  onEvent(event: NativeDiscoveryEvent): void;
  onFailure(): void;
};

let nextDiscoverySubscriptionId = 1;
let nativeDiscoveryEventSubscription: {remove(): void} | undefined;
let nativeBrowsingUpdate: Promise<void> = Promise.resolve();
let activeNativeServiceTypesKey = '';
const nativeDiscoverySubscriptions = new Map<number, NativeDiscoverySubscription>();

/**
 * Platform-neutral boundary for Bonjour on Apple and NSD on Android.
 * Discovery is only a short-lived local presence hint. Hosted Services still
 * authenticates the account and validates the setup session, code, and device key.
 */
export function subscribeToNearbyTVSetups(
  listener: (devices: readonly NearbyPorticoSetupDevice[]) => void,
): () => void {
  if (!nativeModule) {
    notifyNearbyListener(listener, [], 'nearby-setup');
    return () => undefined;
  }
  const devices = new Map<string, NearbyPorticoSetupDevice>();
  return subscribeToNativeDiscovery([PORTICO_SETUP_SERVICE_TYPE], (event: NativeDiscoveryEvent) => {
    const id = discoveryEventId(event);
    if (!id) return;
    if (event.action === 'removed') {
      devices.delete(id);
    } else {
      const parsed = parseNearbyTVSetup(event);
      if (!parsed) return;
      devices.set(id, parsed);
    }
    notifyNearbyListener(
      listener,
      [...devices.values()].sort((left, right) => left.deviceName.localeCompare(right.deviceName)),
      'nearby-setup',
    );
  }, () => notifyNearbyListener(listener, [], 'nearby-setup'));
}

/** Browses Portico Server's existing `_portico._tcp` contract. Results are untrusted hints until their fingerprint is verified. */
export function subscribeToNearbyPorticoServers(
  listener: (servers: readonly NormalizedPorticoDiscoveryRecord[]) => void,
): () => void {
  if (!nativeModule) {
    notifyNearbyListener(listener, [], 'nearby-servers');
    return () => undefined;
  }
  const records = new Map<string, NormalizedPorticoDiscoveryRecord>();
  return subscribeToNativeDiscovery([PORTICO_LAN_SERVICE_TYPE], (event: NativeDiscoveryEvent) => {
    const id = discoveryEventId(event);
    if (!id) return;
    if (event.action === 'removed') {
      records.delete(id);
    } else if (normalizeServiceType(event.serviceType) === PORTICO_LAN_SERVICE_TYPE && isRecord(event.txt)) {
      try {
        records.set(id, normalizePorticoDiscoveryRecord({
          hostname: text(event.hostName) || undefined,
          addresses: Array.isArray(event.addresses)
            ? event.addresses.filter(
                (address): address is string => typeof address === 'string',
              )
            : [],
          instanceName: text(event.instanceName),
          observedAt: new Date(),
          port: typeof event.port === 'number' ? event.port : Number.NaN,
          serviceType: text(event.serviceType),
          txt: stringRecord(event.txt),
        }));
      } catch {
        records.delete(id);
      }
    }
    notifyNearbyListener(
      listener,
      dedupePorticoDiscoveryRecords([...records.values()]),
      'nearby-servers',
    );
  }, () => notifyNearbyListener(listener, [], 'nearby-servers'));
}

/**
 * Collects a bounded Bonjour snapshot for Hosted route recovery. The records
 * remain untrusted hints here; the shared connection pipeline subsequently
 * matches both server ID and the fingerprint from the signed route document,
 * then probes `/api/remote-access/health` before sending any credential.
 */
export function discoverNearbyPorticoServers(
  timeoutMilliseconds = 1_800,
  signal?: AbortSignal,
): Promise<readonly NormalizedPorticoDiscoveryRecord[]> {
  if (!nativeModule || signal?.aborted) return Promise.resolve([]);
  return new Promise(resolve => {
    let latest: readonly NormalizedPorticoDiscoveryRecord[] = [];
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', settle);
      unsubscribe();
      resolve(latest);
    };
    const timeout = setTimeout(
      settle,
      Math.max(250, Math.min(5_000, timeoutMilliseconds)),
    );
    signal?.addEventListener('abort', settle, {once: true});
    unsubscribe = subscribeToNearbyPorticoServers(records => {
      latest = records;
      // One matching service normally resolves within a single Bonjour event;
      // a short grace period still lets duplicate interface records coalesce.
      if (records.length) setTimeout(settle, 120);
    });
  });
}

export function advertiseNearbyTVSetup(advertisement: NearbyTVSetupAdvertisement): () => void {
  const runtimeDescriptor = Platform.OS === 'android'
    ? getPorticoRuntimeDescriptor('tv')
    : undefined;
  if (
    runtimeDescriptor &&
    (advertisement.platform !== runtimeDescriptor.nativePlatform ||
      advertisement.deviceName !== runtimeDescriptor.deviceName)
  ) {
    throw new Error(
      'The Nearby TV setup advertisement does not match the Android runtime descriptor.',
    );
  }
  const code = formatTVSetupCode(advertisement.code);
  if (!nativeModule || !code) return () => undefined;
  const instanceName = `${advertisement.deviceName} ${code}`.slice(0, 63);
  const txt = {
    txtversion: String(advertisement.protocolVersion),
    setupid: advertisement.setupSessionId,
    code,
    publickey: advertisement.devicePublicKey,
    name: advertisement.deviceName,
    platform: advertisement.platform,
    appversion: advertisement.appVersion,
    expiresat: advertisement.expiresAt,
  };
  void nativeModule.startAdvertisingSetup(instanceName, txt);
  return () => {
    void nativeModule.stopAdvertisingSetup();
  };
}

/**
 * Browses only the receiver Bonjour service and returns records with a matching,
 * unexpired account-issued authorization. A setup TV can never enter this list.
 */
export function subscribeToAuthorizedPlaybackReceivers(
  grants: readonly ReceiverControllerGrant[],
  listener: (receivers: readonly NearbyAuthorizedReceiver[]) => void,
): () => void {
  if (!nativeModule) {
    notifyNearbyListener(listener, [], 'authorized-receivers');
    return () => undefined;
  }
  const receivers = new Map<string, NearbyAuthorizedReceiver>();
  return subscribeToNativeDiscovery([PORTICO_RECEIVER_SERVICE_TYPE], (event: NativeDiscoveryEvent) => {
    const id = discoveryEventId(event);
    if (!id) return;
    if (event.action === 'removed') receivers.delete(id);
    else {
      const receiver = parseAuthorizedNearbyReceiver(event, grants);
      if (receiver) receivers.set(id, receiver);
      else receivers.delete(id);
    }
    notifyNearbyListener(
      listener,
      [...receivers.values()].sort((left, right) => left.deviceName.localeCompare(right.deviceName)),
      'authorized-receivers',
    );
  }, () => notifyNearbyListener(listener, [], 'authorized-receivers'));
}

/** Advertises a signed-in playback receiver. The listening endpoint must already be active. */
export function advertiseNearbyPlaybackReceiver(advertisement: NearbyReceiverAdvertisement, port: number): () => void {
  if (!nativeModule || Platform.OS !== 'ios' || !Number.isInteger(port) || port < 1 || port > 65_535) return () => undefined;
  const instanceName = advertisement.deviceName.trim().slice(0, 63);
  if (!instanceName) return () => undefined;
  void nativeModule.startAdvertisingReceiver(instanceName, port, receiverAdvertisementTXT(advertisement));
  return () => { void nativeModule.stopAdvertisingReceiver(); };
}

export function parseNearbyTVSetup(event: NativeDiscoveryEvent): NearbyPorticoSetupDevice | undefined {
  const id = discoveryEventId(event);
  if (!id || normalizeServiceType(event.serviceType) !== PORTICO_SETUP_SERVICE_TYPE || !isRecord(event.txt)) return undefined;
  const txt = event.txt;
  if (text(txt.txtversion) !== String(PORTICO_SETUP_PROTOCOL_VERSION)) return undefined;
  const code = formatTVSetupCode(txt.code);
  const setupSessionId = text(txt.setupid);
  const devicePublicKey = text(txt.publickey);
  const deviceName = text(txt.name);
  const platform = text(txt.platform);
  const appVersion = text(txt.appversion);
  const expiresAt = text(txt.expiresat);
  if (!code || !setupSessionId || !devicePublicKey || !deviceName || !platform || !appVersion) return undefined;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return undefined;
  return {
    id,
    instanceName: text(event.instanceName),
    serviceType: PORTICO_SETUP_SERVICE_TYPE,
    setupSessionId,
    code,
    devicePublicKey,
    deviceName,
    platform,
    appVersion,
    expiresAt: new Date(expiry).toISOString(),
    protocolVersion: PORTICO_SETUP_PROTOCOL_VERSION,
  };
}

/**
 * NSNetServiceBrowser is process-wide in the native bridge. Keep one event
 * listener and restart it with the union of requested service types so opening
 * one surface can never silently cancel discovery needed by another surface.
 */
function subscribeToNativeDiscovery(
  serviceTypes: readonly string[],
  onEvent: (event: NativeDiscoveryEvent) => void,
  onFailure: () => void,
): () => void {
  if (!nativeModule) {
    notifyNearbyListener(onFailure, undefined, 'native-discovery-failure');
    return () => undefined;
  }
  const id = nextDiscoverySubscriptionId++;
  nativeDiscoverySubscriptions.set(id, {
    onEvent,
    onFailure,
    serviceTypes: new Set(serviceTypes.map(normalizeServiceType).filter(Boolean)),
  });
  ensureNativeDiscoveryEvents();
  scheduleNativeBrowsingUpdate();
  return () => {
    nativeDiscoverySubscriptions.delete(id);
    scheduleNativeBrowsingUpdate();
    if (nativeDiscoverySubscriptions.size === 0) {
      nativeDiscoveryEventSubscription?.remove();
      nativeDiscoveryEventSubscription = undefined;
    }
  };
}

function ensureNativeDiscoveryEvents(): void {
  if (!nativeModule || nativeDiscoveryEventSubscription) return;
  const emitter = new NativeEventEmitter(nativeModule);
  nativeDiscoveryEventSubscription = emitter.addListener('PorticoNearbyDeviceChanged', (event: NativeDiscoveryEvent) => {
    const eventServiceType = normalizeServiceType(event.serviceType);
    if (!eventServiceType) return;
    for (const subscription of [...nativeDiscoverySubscriptions.values()]) {
      if (subscription.serviceTypes.has(eventServiceType)) {
        notifyNearbyListener(subscription.onEvent, event, 'native-discovery-event');
      }
    }
  });
}

function scheduleNativeBrowsingUpdate(): void {
  if (!nativeModule) return;
  nativeBrowsingUpdate = nativeBrowsingUpdate
    .catch(() => undefined)
    .then(async () => {
      const serviceTypes = [...new Set(
        [...nativeDiscoverySubscriptions.values()].flatMap(subscription => [...subscription.serviceTypes]),
      )].sort();
      const serviceTypesKey = serviceTypes.join('\0');
      if (serviceTypesKey === activeNativeServiceTypesKey) return;
      try {
        if (serviceTypes.length > 0) await nativeModule.startBrowsing(serviceTypes);
        else await nativeModule.stopBrowsing();
        activeNativeServiceTypesKey = serviceTypesKey;
      } catch {
        for (const subscription of [...nativeDiscoverySubscriptions.values()]) {
          notifyNearbyListener(subscription.onFailure, undefined, 'native-discovery-failure');
        }
      }
    });
}

function notifyNearbyListener<T>(
  listener: (value: T) => void,
  value: T,
  source: string,
): void {
  try {
    listener(value);
  } catch {
    porticoDiagnostics.record('listener-failure', {source});
  }
}

function discoveryEventId(event: NativeDiscoveryEvent): string | undefined {
  const instanceName = text(event.instanceName);
  const serviceType = normalizeServiceType(event.serviceType);
  return instanceName && serviceType ? `${serviceType}:${instanceName}` : undefined;
}

function normalizeServiceType(value: unknown): string {
  return text(value).toLowerCase().replace(/\.local\.?$/, '').replace(/\.$/, '');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => typeof entry === 'string' ? [[key, entry]] : []));
}

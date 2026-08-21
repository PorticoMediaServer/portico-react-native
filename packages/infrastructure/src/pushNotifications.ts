import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {hostedClient} from './clientEnvironment';
import {installationId} from './installation';

const IOS_BUNDLE_ID = 'tv.getportico.ios' as const;

interface NativePushToken {
  appBundleId: string;
  deviceToken: string;
  environment: 'sandbox' | 'production';
}

interface PorticoPushNotificationsModule {
  currentToken(): Promise<NativePushToken | null>;
  requestRegistration(): Promise<void>;
  setBadgeCount(count: number): Promise<void>;
}

const nativePush = NativeModules.PorticoPushNotifications as
  | PorticoPushNotificationsModule
  | undefined;
let activeHostedAccount = false;
let lastRegisteredKey: string | undefined;
let mutation: Promise<void> = Promise.resolve();
const notificationWakeListeners = new Set<() => void>();

function validNativeToken(value: unknown): value is NativePushToken {
  if (!value || typeof value !== 'object') return false;
  const token = value as Partial<NativePushToken>;
  return token.appBundleId === IOS_BUNDLE_ID
    && (token.environment === 'sandbox' || token.environment === 'production')
    && typeof token.deviceToken === 'string'
    && /^[0-9a-f]{64,400}$/.test(token.deviceToken);
}

async function registerCurrentToken(token: NativePushToken): Promise<void> {
  if (!activeHostedAccount || !validNativeToken(token)) return;
  const scopedInstallationId = await installationId();
  if (!activeHostedAccount) return;
  const key = `${scopedInstallationId}:${token.environment}:${token.deviceToken}`;
  if (lastRegisteredKey === key) return;
  await hostedClient.registerPushSubscription({
    installationId: scopedInstallationId,
    provider: 'apns',
    appBundleId: IOS_BUNDLE_ID,
    environment: token.environment,
    deviceToken: token.deviceToken,
  });
  if (activeHostedAccount) lastRegisteredKey = key;
}

function enqueue(operation: () => Promise<void>): Promise<void> {
  const next = mutation.then(operation, operation);
  mutation = next.catch(() => undefined);
  return next;
}

/**
 * Publishes APNs reachability only for a current Hosted account. Local Auth
 * intentionally never calls Hosted Services and continues to use the server
 * notification inbox as its sole notification surface.
 */
export function activateHostedPushNotifications(): () => void {
  if (Platform.OS !== 'ios' || !nativePush) return () => undefined;
  activeHostedAccount = true;
  void nativePush.requestRegistration()
    .then(() => nativePush.currentToken())
    .then(token => {
      if (validNativeToken(token))
        void enqueue(() => registerCurrentToken(token));
    })
    .catch(() => undefined);
  return () => {
    activeHostedAccount = false;
    lastRegisteredKey = undefined;
  };
}

export async function revokeHostedPushNotifications(): Promise<void> {
  if (Platform.OS !== 'ios' || !nativePush) return;
  activeHostedAccount = false;
  lastRegisteredKey = undefined;
  const token = await nativePush.currentToken();
  if (!validNativeToken(token)) return;
  const scopedInstallationId = await installationId();
  await enqueue(async () => {
    await hostedClient.revokePushSubscription({
      installationId: scopedInstallationId,
      appBundleId: IOS_BUNDLE_ID,
      environment: token.environment,
    });
  });
}

export function subscribeHostedNotificationWakes(listener: () => void): () => void {
  notificationWakeListeners.add(listener);
  return () => notificationWakeListeners.delete(listener);
}

export function setHostedNotificationBadge(count: number): Promise<void> {
  if (Platform.OS !== 'ios' || !nativePush) return Promise.resolve();
  return nativePush.setBadgeCount(Math.max(0, Math.min(999, Math.trunc(count))));
}

if (Platform.OS === 'ios' && nativePush) {
  const emitter = new NativeEventEmitter(
    nativePush as unknown as import('react-native').NativeModule,
  );
  emitter.addListener('PorticoPushTokenChanged', value => {
    if (validNativeToken(value)) void enqueue(() => registerCurrentToken(value));
  });
  emitter.addListener('PorticoPushTokenUnavailable', () => {
    if (activeHostedAccount) void revokeHostedPushNotifications().catch(() => undefined);
  });
  emitter.addListener('PorticoNotificationWake', () => {
    if (!activeHostedAccount) return;
    for (const listener of notificationWakeListeners) listener();
  });
}

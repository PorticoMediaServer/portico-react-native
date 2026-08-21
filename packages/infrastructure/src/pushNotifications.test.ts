jest.mock('react-native', () => {
  const currentToken = jest.fn();
  (globalThis as {__porticoCurrentToken?: jest.Mock}).__porticoCurrentToken = currentToken;
  return ({
  NativeModules: {PorticoPushNotifications: {currentToken, requestRegistration: jest.fn(async () => undefined), setBadgeCount: jest.fn(async () => undefined)}},
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: (name: string, listener: (value?: unknown) => void) => {
      const registry = ((globalThis as {__porticoPushListeners?: Map<string, (value?: unknown) => void>}).__porticoPushListeners ??= new Map());
      registry.set(name, listener);
      return {remove: jest.fn()};
    },
  })),
  Platform: {OS: 'ios'},
  });
});

jest.mock('./clientEnvironment', () => {
  const registerPushSubscription = jest.fn();
  const revokePushSubscription = jest.fn();
  Object.assign(globalThis, {__porticoRegisterPush: registerPushSubscription, __porticoRevokePush: revokePushSubscription});
  return {hostedClient: {registerPushSubscription, revokePushSubscription}};
});

jest.mock('./installation', () => ({
  installationId: jest.fn(async () => 'installation-push-0001'),
}));

import {
  activateHostedPushNotifications,
  revokeHostedPushNotifications,
} from './pushNotifications';

const mockGlobal = globalThis as unknown as {
  __porticoPushListeners: Map<string, (value?: unknown) => void>;
  __porticoCurrentToken: jest.Mock;
  __porticoRegisterPush: jest.Mock;
  __porticoRevokePush: jest.Mock;
};
const mockListeners = mockGlobal.__porticoPushListeners;
const mockCurrentToken = mockGlobal.__porticoCurrentToken;
const mockRegisterPushSubscription = mockGlobal.__porticoRegisterPush;
const mockRevokePushSubscription = mockGlobal.__porticoRevokePush;

const token = {
  appBundleId: 'tv.getportico.ios',
  deviceToken: 'ab'.repeat(32),
  environment: 'sandbox' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentToken.mockResolvedValue(token);
  mockRegisterPushSubscription.mockResolvedValue({status: 'active'});
  mockRevokePushSubscription.mockResolvedValue({status: 'revoked'});
});

test('uploads the native token only after Hosted account activation', async () => {
  await Promise.resolve();
  expect(mockRegisterPushSubscription).not.toHaveBeenCalled();
  const deactivate = activateHostedPushNotifications();
  await new Promise<void>(resolve => setImmediate(() => resolve()));
  expect(mockRegisterPushSubscription).toHaveBeenCalledWith({
    installationId: 'installation-push-0001',
    provider: 'apns',
    appBundleId: 'tv.getportico.ios',
    environment: 'sandbox',
    deviceToken: token.deviceToken,
  });
  deactivate();
});

test('rejects a native token published for another Apple target', async () => {
  mockCurrentToken.mockResolvedValueOnce({...token, appBundleId: 'tv.getportico.tvos'});
  const deactivate = activateHostedPushNotifications();
  await new Promise<void>(resolve => setImmediate(() => resolve()));
  expect(mockRegisterPushSubscription).not.toHaveBeenCalled();
  deactivate();
});

test('uploads a rotated APNs token while the Hosted account is active', async () => {
  const deactivate = activateHostedPushNotifications();
  await new Promise<void>(resolve => setImmediate(() => resolve()));
  const rotated = {...token, deviceToken: 'cd'.repeat(32)};
  mockListeners.get('PorticoPushTokenChanged')?.(rotated);
  await new Promise<void>(resolve => setImmediate(() => resolve()));
  expect(mockRegisterPushSubscription).toHaveBeenLastCalledWith(
    expect.objectContaining({deviceToken: rotated.deviceToken}),
  );
  deactivate();
});

test('revokes the installation binding without sending the APNs token', async () => {
  await revokeHostedPushNotifications();
  expect(mockRevokePushSubscription).toHaveBeenCalledWith({
    installationId: 'installation-push-0001',
    appBundleId: 'tv.getportico.ios',
    environment: 'sandbox',
  });
  expect(JSON.stringify(mockRevokePushSubscription.mock.calls)).not.toContain(
    token.deviceToken,
  );
});

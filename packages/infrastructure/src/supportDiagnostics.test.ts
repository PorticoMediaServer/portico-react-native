import {
  PorticoDiagnosticsController,
  createPorticoSupportBundle,
  porticoDiagnostics,
} from './supportDiagnostics';
import {parsePorticoBuildContract, porticoClientDescriptor} from './types';

const descriptor = porticoClientDescriptor('mobile', parsePorticoBuildContract({
  version: 1,
  apiVersion: 'v1',
  environment: 'test',
  distribution: 'simulator',
  hostedApiBaseUrl: 'https://hosted.test',
  appVersion: '0.1.0-test',
  buildNumber: '42',
  commit: 'test-commit',
}));

afterEach(() => {
  porticoDiagnostics.clear();
  delete (globalThis as typeof globalThis & {__PORTICO_BUILD_CONTRACT__?: unknown}).__PORTICO_BUILD_CONTRACT__;
});

test('keeps a bounded, exception-isolated diagnostic ring', () => {
  const controller = new PorticoDiagnosticsController(2);
  const observer = jest.fn();
  controller.subscribe(() => {
    throw new Error('observer failure');
  });
  controller.subscribe(observer);

  controller.record('auth-failure', {
    phase: 'cloud-directory',
    accountId: 'account-secret',
    route: 'https://api.example.test/account-secret',
    message: 'token ptc_acc_secret@example.test leaked here',
    serverCount: 3,
  });
  controller.recordError(
    'restore',
    Object.assign(new Error('https://private.example.test/path?token=ptc_secret'), {
      code: 'network.unavailable',
    }),
  );
  controller.record('restore-complete', {completed: true});

  expect(observer).toHaveBeenCalledTimes(3);
  const bundle = controller.createSupportBundle(descriptor, {
    authStatus: 'server-unavailable',
    accountSignedIn: true,
    serverCount: 3,
  });
  expect(bundle.events).toHaveLength(2);
  expect(bundle.events[0]?.stage).toBe('restore');
  expect(bundle.events[0]?.details).toEqual({
    errorName: 'Error',
    errorCode: 'network.unavailable',
  });
  expect(JSON.stringify(bundle)).not.toContain('account-secret');
  expect(JSON.stringify(bundle)).not.toContain('api.example.test');
  expect(JSON.stringify(bundle)).not.toContain('ptc_secret');
  expect(bundle.state).toEqual({
    authStatus: 'server-unavailable',
    accountSignedIn: true,
    serverCount: 3,
  });
});

test('exports a versioned support bundle from the stable public controller', () => {
  (globalThis as typeof globalThis & {__PORTICO_BUILD_CONTRACT__?: unknown}).__PORTICO_BUILD_CONTRACT__ = {
    version: 1,
    apiVersion: 'v1',
    environment: 'test',
    distribution: 'simulator',
    hostedApiBaseUrl: 'https://hosted.test',
    appVersion: '0.1.0-test',
    buildNumber: '42',
    commit: 'test-commit',
  };
  porticoDiagnostics.record('route-discovery', {
    discoveredRecords: 2,
    identityMatches: 1,
    routeCandidates: 1,
  });

  const bundle = createPorticoSupportBundle('tv', {
    networkLocality: 'local-network',
    activeSession: true,
    profileSelected: true,
  });

  expect(bundle).toMatchObject({
    version: 1,
    client: {
      version: 1,
      os: 'tvos',
      formFactor: 'television',
      capabilities: {
        playback: {source: 'native-runtime-required'},
        pagination: {mode: 'cursor'},
        profileSwitch: {authority: 'hosted-signed-selection-envelope'},
      },
    },
    state: {
      networkLocality: 'local-network',
      activeSession: true,
      profileSelected: true,
    },
  });
  expect(bundle.events).toHaveLength(1);
});

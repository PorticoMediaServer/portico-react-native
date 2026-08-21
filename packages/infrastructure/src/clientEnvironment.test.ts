import type {ViewerScope} from '@porticomediaserver/client-core';
import {isValidLocalServerRouteURL, localServerRouteAddressClass} from '@porticomediaserver/client-core/local-discovery';
import {
  beginServerSessionEnvironment,
  createServerCredentialMutationGate,
  NativeNetworkRouteRefreshCoordinator,
  nativeNetworkRouteIdentity,
  nativeNetworkLocality,
  routeAwareFetch,
  requestServerRouteRefresh,
  shouldRefreshServerRouteForResponse,
  subscribeServerRouteChanges,
  subscribeServerRouteRefreshRequests,
  subscribeServerSessionChanges,
  serverSessionEnvironmentMatches,
  setServerSession,
} from './clientEnvironment';

test('publishes same-route credential replacement independently from route changes', () => {
  const changes: Array<{previousRevision?: string; currentRevision?: string}> = [];
  const unsubscribe = subscribeServerSessionChanges(change => changes.push({
    previousRevision: (change.previous as {authorizationRevision?: string} | undefined)?.authorizationRevision,
    currentRevision: (change.current as {authorizationRevision?: string} | undefined)?.authorizationRevision,
  }));
  try {
    setServerSession({...credentials(scopeA), apiBaseUrl: 'https://server.test'});
    setServerSession({
      ...credentials({...scopeA, authorizationRevision: 'revision-a-2'}),
      apiBaseUrl: 'https://server.test',
    });
    expect(changes.at(-1)).toEqual({
      previousRevision: 'revision-a',
      currentRevision: 'revision-a-2',
    });
  } finally {
    unsubscribe();
    setServerSession(undefined);
  }
});

test('isolates throwing route, session, and refresh listeners', async () => {
  const routeObserver = jest.fn();
  const sessionObserver = jest.fn();
  const unsubscribeRouteThrower = subscribeServerRouteChanges(() => {
    throw new Error('route observer failed');
  });
  const unsubscribeRouteObserver = subscribeServerRouteChanges(routeObserver);
  const unsubscribeSessionThrower = subscribeServerSessionChanges(() => {
    throw new Error('session observer failed');
  });
  const unsubscribeSessionObserver = subscribeServerSessionChanges(sessionObserver);
  const unsubscribeRefreshThrower = subscribeServerRouteRefreshRequests(() => {
    throw new Error('refresh observer failed');
  });
  const unsubscribeRefreshObserver = subscribeServerRouteRefreshRequests(() => true);
  try {
    setServerSession({...credentials(scopeA), apiBaseUrl: 'https://server.test'});
    expect(routeObserver).toHaveBeenCalledTimes(1);
    expect(sessionObserver).toHaveBeenCalledTimes(1);
    await expect(requestServerRouteRefresh({reason: 'network-transition'})).resolves.toBe(true);
  } finally {
    unsubscribeRouteThrower();
    unsubscribeRouteObserver();
    unsubscribeSessionThrower();
    unsubscribeSessionObserver();
    unsubscribeRefreshThrower();
    unsubscribeRefreshObserver();
    setServerSession(undefined);
  }
});

test('only route-level failures on idempotent reads request route replacement', () => {
  for (const status of [421, 502, 503, 504, 521, 522, 523, 524]) {
    expect(shouldRefreshServerRouteForResponse(undefined, status)).toBe(true);
    expect(shouldRefreshServerRouteForResponse('HEAD', status)).toBe(true);
  }
  expect(shouldRefreshServerRouteForResponse('GET', 403)).toBe(false);
  expect(shouldRefreshServerRouteForResponse('GET', 404)).toBe(false);
  expect(shouldRefreshServerRouteForResponse('POST', 503)).toBe(false);
});

describe('route-aware fetch recovery', () => {
  const originalFetch = globalThis.fetch;
  const oldRoute = 'https://old-route.direct.getportico.tv';
  const nextRoute = 'https://new-route.direct.getportico.tv';
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    setServerSession({
      ...credentials(scopeA),
      apiBaseUrl: oldRoute,
    });
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    globalThis.fetch = originalFetch;
    setServerSession(undefined);
  });

  test.each([421, 502, 503, 504, 521, 522, 523, 524])(
    'awaits route recovery and retries GET once after HTTP %s',
    async status => {
      const failed = {status} as Response;
      const recovered = {status: 200} as Response;
      const fetch = jest.fn()
        .mockResolvedValueOnce(failed)
        .mockResolvedValueOnce(recovered);
      globalThis.fetch = fetch;
      const refresh = jest.fn(async () => {
        setServerSession({
          ...credentials(scopeA),
          apiBaseUrl: nextRoute,
        });
        return true;
      });
      unsubscribe = subscribeServerRouteRefreshRequests(refresh);

      await expect(routeAwareFetch(`${oldRoute}/api/home`)).resolves.toBe(recovered);

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenNthCalledWith(1, `${oldRoute}/api/home`, undefined);
      expect(fetch).toHaveBeenNthCalledWith(2, `${nextRoute}/api/home`, undefined);
    },
  );

  test('awaits one single-flight refresh for concurrent thrown read failures', async () => {
    const release = deferred();
    const recovered = {status: 200} as Response;
    const fetch = jest.fn()
      .mockRejectedValueOnce(new TypeError('old route unavailable'))
      .mockRejectedValueOnce(new TypeError('old route unavailable'))
      .mockResolvedValue(recovered);
    globalThis.fetch = fetch;
    const refresh = jest.fn(async () => {
      await release.promise;
      setServerSession({
        ...credentials(scopeA),
        apiBaseUrl: nextRoute,
      });
      return true;
    });
    unsubscribe = subscribeServerRouteRefreshRequests(refresh);

    const first = routeAwareFetch(`${oldRoute}/api/home`);
    const second = routeAwareFetch(`${oldRoute}/api/libraries`);
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    release.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual([
      recovered,
      recovered,
    ]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.slice(2).map(call => call[0])).toEqual([
      `${nextRoute}/api/home`,
      `${nextRoute}/api/libraries`,
    ]);
  });

  test('never replays a mutation after a thrown route failure', async () => {
    const failure = new TypeError('route unavailable');
    const fetch = jest.fn().mockRejectedValue(failure);
    globalThis.fetch = fetch;
    const refresh = jest.fn().mockResolvedValue(true);
    unsubscribe = subscribeServerRouteRefreshRequests(refresh);

    await expect(routeAwareFetch(`${oldRoute}/api/saved`, {
      method: 'POST',
      body: '{}',
    })).rejects.toBe(failure);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  test('returns an eligible-looking mutation response without refresh or replay', async () => {
    const response = {status: 503} as Response;
    const fetch = jest.fn().mockResolvedValue(response);
    globalThis.fetch = fetch;
    const refresh = jest.fn().mockResolvedValue(true);
    unsubscribe = subscribeServerRouteRefreshRequests(refresh);

    await expect(routeAwareFetch(`${oldRoute}/api/saved`, {
      method: 'DELETE',
    })).resolves.toBe(response);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});

const scopeA: ViewerScope = {
  authority: 'local',
  accountId: 'account-a',
  serverId: 'server-a',
  profileId: 'profile-a',
  authorizationRevision: 'revision-a',
};
const scopeB: ViewerScope = {
  authority: 'local',
  accountId: 'account-b',
  serverId: 'server-b',
  profileId: 'profile-b',
  authorizationRevision: 'revision-b',
};

function credentials(scope: ViewerScope) {
  return {
    accessToken: `access-${scope.accountId}`,
    refreshToken: `refresh-${scope.accountId}`,
    authenticationMode: 'local' as const,
    authority: scope.authority,
    accountId: scope.accountId,
    serverId: scope.serverId,
    profileId: scope.profileId,
    authorizationRevision: scope.authorizationRevision,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return {promise, resolve};
}

test('drains admitted A mutations and rejects queued A writes before B publication', async () => {
  const initial = beginServerSessionEnvironment();
  setServerSession(credentials(scopeA));
  initial.activate(scopeA);
  const gateA = createServerCredentialMutationGate();
  const releaseA = deferred();
  const writes: string[] = [];
  const admittedA = gateA.run(async () => {
    await releaseA.promise;
    writes.push('A-before-fence');
  });

  const stageB = beginServerSessionEnvironment();
  const gateB = createServerCredentialMutationGate();
  let drained = false;
  const drain = stageB.drain().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  releaseA.resolve();
  await Promise.all([admittedA, drain]);

  await expect(gateA.run(async () => { writes.push('late-A'); })).rejects.toMatchObject({
    name: 'ViewerCredentialEnvironmentFencedError',
  });
  setServerSession(credentials(scopeB));
  stageB.activate(scopeB);
  await gateB.run(async () => { writes.push('B'); });
  expect(serverSessionEnvironmentMatches(scopeB)).toBe(true);
  expect(writes).toEqual(['A-before-fence', 'B']);

  // Two-phase rollback fences B first, then restores A's exact generation.
  stageB.fence();
  setServerSession(credentials(scopeA));
  stageB.rollback();
  expect(serverSessionEnvironmentMatches(scopeA)).toBe(true);
  await gateA.run(async () => { writes.push('A-after-rollback'); });
  await expect(gateB.run(async () => { writes.push('late-B'); })).rejects.toMatchObject({
    name: 'ViewerCredentialEnvironmentFencedError',
  });
  expect(writes).toEqual(['A-before-fence', 'B', 'A-after-rollback']);
});

describe('native network route refresh coordination', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('refreshes once when a home LAN changes to a mobile hotspot', () => {
    const refresh = jest.fn();
    const coordinator = new NativeNetworkRouteRefreshCoordinator(refresh);
    coordinator.update({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: {ipAddress: '192.168.2.20', subnet: '255.255.255.0'},
    });
    coordinator.update({
      type: 'cellular',
      isConnected: true,
      isInternetReachable: true,
      details: {ipAddress: '172.20.10.4', cellularGeneration: '5g'},
    });
    jest.advanceTimersByTime(749);
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('coalesces a transient reachability flap until the network is reachable', () => {
    const refresh = jest.fn();
    const coordinator = new NativeNetworkRouteRefreshCoordinator(refresh);
    const wifi = {
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: {ipAddress: '192.168.2.20'},
    } as const;
    coordinator.update(wifi);
    coordinator.update({...wifi, isInternetReachable: false});
    jest.advanceTimersByTime(5_000);
    expect(refresh).not.toHaveBeenCalled();
    coordinator.update(wifi);
    coordinator.update(wifi);
    jest.runAllTimers();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('ignores duplicate events for the same reachable network', () => {
    const refresh = jest.fn();
    const coordinator = new NativeNetworkRouteRefreshCoordinator(refresh);
    const wifi = {
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: {ipAddress: '192.168.2.20', ssid: 'Portico Home'},
    } as const;
    coordinator.update(wifi);
    coordinator.update({...wifi, details: {...wifi.details}});
    jest.runAllTimers();
    expect(refresh).not.toHaveBeenCalled();
  });

  test('network identity excludes route URL and keeps physical locality distinct', () => {
    expect(nativeNetworkRouteIdentity({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: {ipAddress: '192.168.2.20', ssid: 'Portico Home'},
    })).toBe('wifi|192.168.2.20||Portico Home||');
    expect(nativeNetworkLocality({type: 'wifi', isConnected: true, isInternetReachable: true})).toBe('local-network');
    expect(nativeNetworkLocality({type: 'cellular', isConnected: true, isInternetReachable: true})).toBe('wide-area');
    expect([
      'http://localhost:32500',
      'http://127.0.0.1:32500',
      'http://192.168.2.20:32500',
      'http://10.0.0.20:32500',
      'http://172.20.0.20:32500',
    ].every(isValidLocalServerRouteURL)).toBe(true);
    expect(localServerRouteAddressClass('http://192.168.2.20:32500')).toBe('rfc1918-lan');
  });
});

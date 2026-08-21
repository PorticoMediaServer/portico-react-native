import {
  PORTICO_NAVIGATION_CONTRACT_REVISION,
  type PorticoNavigationRestoration,
  type PorticoNavigationRestorationFence,
} from '@portico/client-core';
import {
  BoundedNavigationRestorationStore,
  createSettingsNavigationRestorationStorage,
  registerNavigationRestorationViewerFence,
  type NavigationRestorationStorage,
} from './navigationRestoration';

const fence: PorticoNavigationRestorationFence = {
  accountId: 'account-one',
  authority: 'hosted',
  authorizationRevision: 'authorization-one',
  capabilityRevision: 'capabilities-one',
  platform: 'handheld',
  productContractRevision: 'product-one',
  profileId: 'profile-one',
  routeContractRevision: PORTICO_NAVIGATION_CONTRACT_REVISION,
  serverId: 'server-one',
};

function memoryStorage(initial?: unknown) {
  let value = initial;
  const storage: NavigationRestorationStorage = {
    clear: jest.fn(async () => {
      value = undefined;
    }),
    read: jest.fn(async () => value),
    write: jest.fn(async next => {
      value = next;
    }),
  };
  return {storage, value: () => value};
}

test('stores and restores only the last bounded primary destination', async () => {
  const memory = memoryStorage();
  const store = new BoundedNavigationRestorationStore(memory.storage);
  expect(await store.activateScope(fence)).toBeUndefined();
  await store.save({destination: 'library', libraryId: 'tv', pivot: 'episodes'});
  const written = memory.value() as PorticoNavigationRestoration;
  expect(written.destination).toEqual({
    destination: 'library',
    libraryId: 'tv',
    pivot: 'episodes',
  });
  expect(JSON.stringify(written)).not.toMatch(
    /token|credential|sourceURL|file:\/\/|password/i,
  );

  const relaunched = new BoundedNavigationRestorationStore(memory.storage);
  expect(await relaunched.activateScope(fence)).toEqual({
    destination: 'library',
    libraryId: 'tv',
    pivot: 'episodes',
  });
});

test.each([
  ['accountId', 'account-two'],
  ['profileId', 'profile-two'],
  ['serverId', 'server-two'],
  ['authorizationRevision', 'authorization-two'],
  ['platform', 'television'],
  ['capabilityRevision', 'capabilities-two'],
] as const)(
  'silently clears restoration when %s changes',
  async (field, value) => {
    const source = memoryStorage();
    const first = new BoundedNavigationRestorationStore(source.storage);
    await first.activateScope(fence);
    await first.save({destination: 'saved'});

    const relaunched = new BoundedNavigationRestorationStore(source.storage);
    expect(
      await relaunched.activateScope({...fence, [field]: value}),
    ).toBeUndefined();
    expect(source.storage.clear).toHaveBeenCalled();
    expect(source.value()).toBeUndefined();
  },
);

test('scope transition revokes save authority before clearing old state', async () => {
  const memory = memoryStorage();
  const store = new BoundedNavigationRestorationStore(memory.storage);
  await store.activateScope(fence);
  await store.save({destination: 'channels'});
  await store.resetForScopeChange({...fence, profileId: 'profile-two'});
  expect(memory.value()).toBeUndefined();
  expect(store.currentFence()?.profileId).toBe('profile-two');
  await store.clear();
  await expect(store.save({destination: 'home'})).rejects.toThrow(
    /verified viewer scope/,
  );
});

test('malformed preferences are removed without surfacing an error', async () => {
  const memory = memoryStorage({version: 'v1', destination: {destination: 'player'}});
  const store = new BoundedNavigationRestorationStore(memory.storage);
  expect(await store.activateScope(fence)).toBeUndefined();
  expect(memory.value()).toBeUndefined();
});

test('Settings adapter uses one JSON UserDefaults value and null deletion', async () => {
  const values: Record<string, unknown> = {};
  const settings = {
    get: jest.fn((key: string) => values[key]),
    set: jest.fn((next: Record<string, unknown>) => {
      Object.assign(values, next);
    }),
  };
  const storage = createSettingsNavigationRestorationStorage(
    settings,
    'test.navigation',
  );
  const value: PorticoNavigationRestoration = {
    destination: {destination: 'home'},
    fence,
    savedAt: '2026-07-21T00:00:00.000Z',
    version: 'v1',
  };
  await storage.write(value);
  expect(typeof values['test.navigation']).toBe('string');
  expect(await storage.read()).toEqual(value);
  await storage.clear();
  expect(values['test.navigation']).toBeNull();
});

test('viewer transition focus fence revokes and clears restoration before publication', async () => {
  const memory = memoryStorage();
  const store = new BoundedNavigationRestorationStore(memory.storage);
  await store.activateScope(fence);
  await store.save({destination: 'saved'});
  let hook: (() => void | Promise<void>) | undefined;
  const unregister = jest.fn();
  const runtime = {
    register: jest.fn((_phase: 'focus', next: () => void | Promise<void>) => {
      hook = next;
      return unregister;
    }),
  };
  expect(registerNavigationRestorationViewerFence(runtime, store)).toBe(unregister);
  expect(runtime.register).toHaveBeenCalledWith('focus', expect.any(Function));
  await hook?.();
  expect(memory.value()).toBeUndefined();
  await expect(store.save({destination: 'home'})).rejects.toThrow(
    /verified viewer scope/,
  );
});

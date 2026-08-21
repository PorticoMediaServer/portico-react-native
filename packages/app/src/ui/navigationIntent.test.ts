import type {ViewerScope} from '@portico/client-core';
import {
  authorizePorticoDestination,
  PorticoNavigationIntentCoordinator,
  PORTICO_REACT_NAVIGATION_LINK_PREFIXES,
  createPorticoReactNavigationLinking,
  dispatchPorticoDestination,
  registerNavigationIntentViewerFence,
} from './navigationIntent';

test('authorizes protected destinations against the active server profile', async () => {
  const client = {
    library: jest.fn().mockResolvedValue({id: 'library-one'}),
    libraryPivotBrowseCapabilities: jest.fn().mockResolvedValue({}),
    media: jest.fn().mockResolvedValue({id: 'media-one'}),
    person: jest.fn().mockResolvedValue({person: {id: 'person-one'}}),
    viewerNotifications: jest.fn().mockResolvedValue({items: []}),
    watchWithFriendsGroup: jest.fn().mockResolvedValue({id: 'group-one', mediaId: 'media-one'}),
    liveTvChannel: jest.fn().mockResolvedValue({id: 'channel-one'}),
    libraryChannelGuide: jest.fn().mockResolvedValue({channel: {id: 'library-channel-one'}}),
    dvrRecording: jest.fn().mockResolvedValue({id: 'recording-one'}),
  } as never;
  await expect(authorizePorticoDestination(client, {
    destination: 'library', libraryId: 'library-one', pivot: 'shows',
  }, 'handheld')).resolves.toBe(true);
  expect((client as {library: jest.Mock}).library).toHaveBeenCalledWith('library-one');
  expect((client as {libraryPivotBrowseCapabilities: jest.Mock}).libraryPivotBrowseCapabilities).toHaveBeenCalledWith('library-one', 'shows');
  await expect(authorizePorticoDestination(client, {
    destination: 'player', mediaId: 'media-one', context: 'watch-with-friends', watchWithFriendsGroupId: 'group-one',
  }, 'handheld')).resolves.toBe(true);
  await expect(authorizePorticoDestination(client, {
    destination: 'player', mediaId: 'recording-one', context: 'dvr',
  }, 'handheld')).resolves.toBe(true);
  expect((client as {dvrRecording: jest.Mock}).dvrRecording).toHaveBeenCalledWith('recording-one');
  expect((client as {media: jest.Mock}).media).not.toHaveBeenCalledWith('recording-one');
});

test('fails closed for missing resources, TV offline links, and mismatched local downloads', async () => {
  const client = {
    media: jest.fn().mockRejectedValue(new Error('not found')),
  } as never;
  await expect(authorizePorticoDestination(client, {
    destination: 'media-detail', mediaId: 'missing',
  }, 'handheld')).resolves.toBe(false);
  await expect(authorizePorticoDestination(client, {
    destination: 'player', mediaId: 'media-one', context: 'offline', localDownloadId: 'download-one',
  }, 'television', {downloads: true}, {authorizeOffline: () => true})).resolves.toBe(false);
  await expect(authorizePorticoDestination(client, {
    destination: 'player', mediaId: 'media-one', context: 'offline', localDownloadId: 'download-one',
  }, 'handheld', {downloads: true}, {authorizeOffline: () => false})).resolves.toBe(false);
});

const scope: ViewerScope = {
  authority: 'hosted',
  accountId: 'account-one',
  serverId: 'server-one',
  profileId: 'profile-one',
  authorizationRevision: 'authorization-one',
};

const settleNavigationIntent = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('holds an external intent until a verified viewer authorizes it', async () => {
  const coordinator = new PorticoNavigationIntentCoordinator();
  const dispatch = jest.fn();
  expect(coordinator.captureURL('portico://media/media-one')).toBe(true);
  expect(dispatch).not.toHaveBeenCalled();
  coordinator.activate({
    viewerScope: scope,
    platform: 'handheld',
    authorize: destination => destination.destination === 'media-detail',
    dispatch,
  });
  await settleNavigationIntent();
  expect(dispatch).toHaveBeenCalledWith({
    destination: 'media-detail',
    mediaId: 'media-one',
  });
  expect(coordinator.hasPendingIntent()).toBe(false);
});

test('rejects unauthorized, unavailable, and malformed intents without replay', async () => {
  const coordinator = new PorticoNavigationIntentCoordinator();
  const dispatch = jest.fn();
  coordinator.activate({
    viewerScope: scope,
    platform: 'television',
    authorize: () => true,
    dispatch,
  });
  expect(coordinator.captureURL('portico://downloads')).toBe(true);
  expect(coordinator.captureURL('portico://play/media?sourceURL=https://bad')).toBe(false);
  expect(coordinator.captureURL('https://example.com/media/media-one')).toBe(false);
  expect(coordinator.captureURL('http://app.getportico.tv/media/media-one')).toBe(false);
  expect(coordinator.captureURL('https://app.getportico.tv:8443/media/media-one')).toBe(false);
  expect(dispatch).not.toHaveBeenCalled();

  coordinator.activate({...coordinatorContext(dispatch), authorize: () => false});
  coordinator.captureURL('portico://settings/security');
  await settleNavigationIntent();
  expect(dispatch).not.toHaveBeenCalled();
  coordinator.activate(coordinatorContext(dispatch));
  expect(dispatch).not.toHaveBeenCalled();
});

test('binds links captured by an active viewer to that immutable identity', async () => {
  const coordinator = new PorticoNavigationIntentCoordinator();
  const dispatch = jest.fn();
  coordinator.activate(coordinatorContext(dispatch));
  coordinator.deactivate(false);
  // Capture while deactivated is intentionally unbound and may survive login.
  coordinator.captureURL('portico://home');
  coordinator.activate(coordinatorContext(dispatch, {...scope, profileId: 'profile-two'}));
  await settleNavigationIntent();
  expect(dispatch).toHaveBeenCalledWith({destination: 'home'});

  dispatch.mockClear();
  coordinator.activate(coordinatorContext(dispatch));
  coordinator.captureURL('portico://media/media-two');
  await settleNavigationIntent();
  expect(dispatch).toHaveBeenCalledTimes(1);
  coordinator.deactivate();
  expect(coordinator.hasPendingIntent()).toBe(false);
});

test('suspension retains a pre-login intent while reset discards it', async () => {
  const coordinator = new PorticoNavigationIntentCoordinator();
  const dispatch = jest.fn();
  coordinator.captureURL('portico://library/library-one?pivot=shows');
  coordinator.suspend();
  expect(coordinator.hasPendingIntent()).toBe(true);
  coordinator.activate(coordinatorContext(dispatch));
  await settleNavigationIntent();
  expect(dispatch).toHaveBeenCalledWith({
    destination: 'library',
    libraryId: 'library-one',
    pivot: 'shows',
  });

  coordinator.suspend();
  coordinator.captureURL('portico://settings/security');
  expect(coordinator.hasPendingIntent()).toBe(true);
  coordinator.reset();
  expect(coordinator.hasPendingIntent()).toBe(false);
});

test('viewer transition focus fence preserves only an unbound first-login intent', async () => {
  const coordinator = new PorticoNavigationIntentCoordinator();
  coordinator.captureURL('portico://saved');
  let hook: (() => void | Promise<void>) | undefined;
  const runtime = {
    register: jest.fn((_phase: 'focus', next: () => void | Promise<void>) => {
      hook = next;
      return jest.fn();
    }),
  };
  registerNavigationIntentViewerFence(runtime, coordinator);
  expect(runtime.register).toHaveBeenCalledWith('focus', expect.any(Function));
  await hook?.();
  expect(coordinator.hasPendingIntent()).toBe(true);

  const dispatch = jest.fn();
  coordinator.activate(coordinatorContext(dispatch));
  await settleNavigationIntent();
  expect(dispatch).toHaveBeenCalledWith({destination: 'saved'});

  coordinator.activate(coordinatorContext(dispatch));
  await hook?.();
  expect(coordinator.hasPendingIntent()).toBe(false);
});

test('React Navigation adapter owns initial and subsequent OS URL intake', async () => {
  let eventHandler: ((event: {url: string}) => void) | undefined;
  const remove = jest.fn();
  const source = {
    getInitialURL: jest.fn(async () => 'portico://search?q=rookie'),
    addEventListener: jest.fn((_type: 'url', handler: (event: {url: string}) => void) => {
      eventHandler = handler;
      return {remove};
    }),
  };
  const coordinator = new PorticoNavigationIntentCoordinator();
  const dispatch = jest.fn();
  coordinator.activate(coordinatorContext(dispatch));
  const linking = createPorticoReactNavigationLinking(coordinator, source as never);

  expect(linking.prefixes).toEqual(PORTICO_REACT_NAVIGATION_LINK_PREFIXES);

  await expect(linking.getInitialURL?.()).resolves.toBeNull();
  await settleNavigationIntent();
  expect(dispatch).toHaveBeenLastCalledWith({destination: 'search', query: 'rookie'});
  const unsubscribe = linking.subscribe?.(jest.fn());
  eventHandler?.({url: 'portico://person/person-one'});
  await settleNavigationIntent();
  expect(dispatch).toHaveBeenLastCalledWith({destination: 'person', personId: 'person-one'});
  unsubscribe?.();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('never dispatches a delayed authorization after the viewer changes', async () => {
  const coordinator = new PorticoNavigationIntentCoordinator();
  const dispatch = jest.fn();
  let resolveAuthorization!: (allowed: boolean) => void;
  const authorization = new Promise<boolean>(resolve => {
    resolveAuthorization = resolve;
  });
  coordinator.activate({
    ...coordinatorContext(dispatch),
    authorize: () => authorization,
  });
  coordinator.captureURL('portico://media/media-one');
  coordinator.transitionViewerFence();
  coordinator.activate(coordinatorContext(dispatch, {...scope, profileId: 'profile-two'}));
  resolveAuthorization(true);
  await settleNavigationIntent();
  expect(dispatch).not.toHaveBeenCalled();
});

function coordinatorContext(
  dispatch: jest.Mock,
  viewerScope: ViewerScope = scope,
) {
  return {
    viewerScope,
    platform: 'handheld' as const,
    authorize: () => true,
    dispatch,
  };
}

test('canonical dispatcher keeps playback resources out of navigation intent', () => {
  const navigation = new Proxy(
    {},
    {get: (target, key) => ((target as Record<PropertyKey, unknown>)[key] ??= jest.fn())},
  ) as never;
  expect(dispatchPorticoDestination(navigation, {
    destination: 'player',
    context: 'offline',
    mediaId: 'media-one',
    localDownloadId: 'download-one',
  })).toBe(true);
  expect((navigation as {openDownloadedPlayer: jest.Mock}).openDownloadedPlayer)
    .toHaveBeenCalledWith('media-one', 'download-one');
  expect(JSON.stringify({
    destination: 'player',
    context: 'offline',
    mediaId: 'media-one',
    localDownloadId: 'download-one',
  })).not.toMatch(/source|file:|token|credential|callback/i);
});

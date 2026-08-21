import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type {AppEvent, PorticoClient, ViewerScope} from '@porticomediaserver/client-core';
import {PorticoViewerRuntimeProvider, ViewerRuntimeCoordinator} from '@portico-react-native/infrastructure';
import {
  applicationEventQueryPrefixesFromSemanticTags,
  applicationEventSemanticTags,
  applicationEventQueryPrefixes,
  invalidateApplicationEvent,
  useApplicationEventInvalidations,
} from './applicationEvents';

const scope: ViewerScope = {
  authority: 'hosted',
  accountId: 'account-1',
  serverId: 'server-1',
  profileId: 'profile-1',
  authorizationRevision: 'revision-1',
};

function event(tags: string[], resource?: string, resourceId?: string): AppEvent {
  return {
    id: 1,
    type: 'data.changed',
    createdAt: '2026-07-18T12:00:00.000Z',
    tags,
    resource,
    resourceId,
  };
}

test('maps server tags to narrow query families and de-duplicates overlaps', () => {
  expect(
    applicationEventQueryPrefixes(
      event(
        ['playback-progress', 'media-state'],
        'media',
        'episode-1',
      ),
    ),
  ).toEqual([
    ['media', 'episode-1'],
    ['home'],
    ['library-page'],
    ['watchlist'],
    ['favorites'],
    ['saved-resource-items'],
    ['active-detail-queue'],
  ]);
  expect(applicationEventQueryPrefixes(event(['live-tv', 'dvr']))).toEqual([
    ['live-tv-sources'],
    ['live-tv-channels'],
    ['live-tv-guide'],
    ['dvr-status'],
    ['dvr-rules'],
    ['dvr-recordings'],
  ]);
});

test('semantic event tags preserve targeted media identity through coalescing', () => {
  const tags = new Set(applicationEventSemanticTags(event(['playback-progress'], 'media', 'episode / 1')));
  expect(applicationEventQueryPrefixesFromSemanticTags(tags)).toEqual([
    ['media', 'episode / 1'],
    ['home'],
  ]);
});

test('invalidation retains cached data while active queries refetch', () => {
  const runtime = new ViewerRuntimeCoordinator();
  runtime.initialize(scope);
  const queryClient = runtime.getSnapshot().queryClient;
  queryClient.setQueryData(['home'], {rows: ['retained']});
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

  invalidateApplicationEvent(
    queryClient,
    event(['playback-progress'], 'media', 'episode-1'),
  );

  expect(queryClient.getQueryData(['home'])).toEqual({rows: ['retained']});
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['home'],
    refetchType: 'active',
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['media', 'episode-1'],
    refetchType: 'active',
  });
  runtime.forceClosed();
});

test('mounts one viewer subscription and remounts without replacing the physical connection', async () => {
  const runtime = new ViewerRuntimeCoordinator();
  runtime.initialize(scope);
  let subscription:
    | Parameters<PorticoClient['subscribeAppEvents']>[0]
    | undefined;
  const subscribeAppEvents = jest.fn((options: Parameters<PorticoClient['subscribeAppEvents']>[0]) => {
    subscription = options;
    return new Promise<void>(resolve => {
      options.signal.addEventListener('abort', () => resolve(), {once: true});
    });
  });
  const client = {subscribeAppEvents} as unknown as PorticoClient;
  function Probe({activeClient}: {activeClient: PorticoClient}) {
    useApplicationEventInvalidations(activeClient);
    return null;
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PorticoViewerRuntimeProvider coordinator={runtime}>
        <Probe activeClient={client} />
      </PorticoViewerRuntimeProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {
    runtime.setLifecycleState({foreground: true, online: true});
    await Promise.resolve();
  });
  expect(subscribeAppEvents).toHaveBeenCalledTimes(1);
  expect(subscription?.transport).toBe('long-poll');

  // A server access-token rotation mutates the client's credential store, not
  // its viewer/session identity or this shell-level client reference.
  await ReactTestRenderer.act(async () => {
    renderer.unmount();
    renderer = ReactTestRenderer.create(
      <PorticoViewerRuntimeProvider coordinator={runtime}>
        <Probe activeClient={client} />
      </PorticoViewerRuntimeProvider>,
    );
  });
  expect(subscribeAppEvents).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => renderer.unmount());
  runtime.forceClosed();
  expect(subscription?.signal.aborted).toBe(true);
});

test('coalesces application events into targeted active-query invalidation', async () => {
  jest.useFakeTimers();
  const runtime = new ViewerRuntimeCoordinator();
  runtime.initialize(scope);
  const queryClient = runtime.getSnapshot().queryClient;
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  let subscription: Parameters<PorticoClient['subscribeAppEvents']>[0] | undefined;
  const client = {
    subscribeAppEvents: jest.fn((options: Parameters<PorticoClient['subscribeAppEvents']>[0]) => {
      subscription = options;
      return new Promise<void>(resolve => options.signal.addEventListener('abort', resolve, {once: true}));
    }),
  } as unknown as PorticoClient;
  function Probe() {
    useApplicationEventInvalidations(client);
    return null;
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PorticoViewerRuntimeProvider coordinator={runtime}><Probe /></PorticoViewerRuntimeProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {
    runtime.setLifecycleState({foreground: true, online: true});
    await Promise.resolve();
  });
  await ReactTestRenderer.act(async () => {
    subscription!.onEvent(event(['playback-progress'], 'media', 'episode-1'));
    subscription!.onEvent(event(['playback-progress'], 'media', 'episode-1'));
    jest.advanceTimersByTime(120);
  });
  expect(invalidate).toHaveBeenCalledWith({queryKey: ['media', 'episode-1'], refetchType: 'active'});
  expect(invalidate).toHaveBeenCalledWith({queryKey: ['home'], refetchType: 'active'});
  const mediaCalls = invalidate.mock.calls.filter(([request]) => JSON.stringify(request?.queryKey) === JSON.stringify(['media', 'episode-1']));
  expect(mediaCalls).toHaveLength(1);
  await ReactTestRenderer.act(async () => {
    runtime.forceClosed();
    renderer.unmount();
  });
  jest.useRealTimers();
});

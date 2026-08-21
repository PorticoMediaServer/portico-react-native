import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import type {TVLogicalFocusContainer} from '@portico-react-native/tv-focus';

let directionHandler: ((event: {eventType: string}) => void) | undefined;

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const ReactRuntime = jest.requireActual('react');
  return {
    __esModule: true,
    default: ReactRuntime.forwardRef((props: object, ref: React.Ref<unknown>) =>
      ReactRuntime.createElement('Pressable', {...props, ref}),
    ),
  };
});

jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  Object.defineProperty(native, 'useTVEventHandler', {
    configurable: true,
    value: (handler: (event: {eventType: string}) => void) => {
      directionHandler = handler;
    },
  });
  return native;
});

import {
  ContentFocusProvider,
  Focusable,
  TVLogicalFocusContainerBoundary,
  type TVFocusNode,
} from './primitives';
import {TVNavigationFocusBoundary} from './tvNavigationFocus';
import {
  tvBrowseSurfaceFocusContainer,
  type TVBrowseFocusSurface,
} from './tv/surfaceFocusTopology';

const fence = {contractRevision: 'focus-test'};

function nativeFocusable(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
) {
  return renderer.root.find(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  );
}

function targetFactory(
  targets: Map<string, TVFocusNode & {requestTVFocus: jest.Mock}>,
  labels: readonly string[],
) {
  let index = 0;
  return (_element: React.ReactElement<unknown>) => {
    const label = labels[index++];
    const target = {requestTVFocus: jest.fn()} as unknown as TVFocusNode & {
      requestTVFocus: jest.Mock;
    };
    if (label) targets.set(label, target);
    return target;
  };
}

test('ContentFocusProvider forwards logical metadata through mount, focus, and unmount', async () => {
  const mounted = jest.fn();
  const focused = jest.fn();
  const unmounted = jest.fn();
  const container = {id: 'detail:hero', movement: 'native'} as const;
  const targets = new Map<string, TVFocusNode & {requestTVFocus: jest.Mock}>();
  let renderer!: TestRenderer.ReactTestRenderer;

  await act(async () => {
    renderer = TestRenderer.create(
      <ContentFocusProvider
        onContentFocus={focused}
        onContentMount={mounted}
        onContentUnmount={unmounted}
      >
        <TVLogicalFocusContainerBoundary container={container}>
          <Focusable
            accessibilityLabel="More"
            onPress={jest.fn()}
            platform="tv"
            tvFocusBoundaryDirections={['right']}
            tvFocusId="detail:more"
            tvFocusNeighbours={{right: 'detail:facts'}}
          />
        </TVLogicalFocusContainerBoundary>
      </ContentFocusProvider>,
      {createNodeMock: targetFactory(targets, ['More'])},
    );
  });

  const more = nativeFocusable(renderer, 'More');
  await act(async () => more.props.onFocus({}));
  expect(mounted).toHaveBeenCalledWith(
    targets.get('More'),
    'detail:more',
    expect.objectContaining({
      boundaryDirections: ['right'],
      container,
      neighbours: {right: 'detail:facts'},
    }),
  );
  expect(focused).toHaveBeenCalledWith(
    targets.get('More'),
    'detail:more',
    expect.objectContaining({container}),
  );

  await act(async () => renderer.unmount());
  expect(unmounted).toHaveBeenCalledWith(
    targets.get('More'),
    'detail:more',
    expect.objectContaining({container}),
  );
});

describe.each([
  'home',
  'search',
  'library',
  'channels',
  'saved',
  'profile-selection',
] as const)('%s live focus surface', (surface: TVBrowseFocusSurface) => {
  test('mounts a semantic target with surface-owned logical metadata', async () => {
    const mounted = jest.fn();
    const targets = new Map<
      string,
      TVFocusNode & {requestTVFocus: jest.Mock}
    >();
    const container = tvBrowseSurfaceFocusContainer(surface);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ContentFocusProvider
          onContentFocus={jest.fn()}
          onContentMount={mounted}
        >
          <TVLogicalFocusContainerBoundary container={container}>
            <Focusable
              accessibilityLabel={`${surface} target`}
              onPress={jest.fn()}
              platform="tv"
              tvFocusId={`${surface}:semantic:item-1`}
            />
          </TVLogicalFocusContainerBoundary>
        </ContentFocusProvider>,
        {createNodeMock: targetFactory(targets, [`${surface} target`])},
      );
    });
    expect(mounted).toHaveBeenCalledWith(
      targets.get(`${surface} target`),
      `${surface}:semantic:item-1`,
      expect.objectContaining({container}),
    );
    await act(async () => renderer.unmount());
  });
});

test('a tagged More boundary requests facts exactly once while ordinary local movement stays native', async () => {
  const targets = new Map<string, TVFocusNode & {requestTVFocus: jest.Mock}>();
  const containers: TVLogicalFocusContainer[] = [
    {
      id: 'detail:hero',
      movement: 'native',
      neighbours: {right: 'detail:facts'},
    },
    {id: 'detail:facts', movement: 'native', neighbours: {left: 'detail:hero'}},
  ];
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <TVNavigationFocusBoundary
        containers={containers}
        fence={fence}
        routeName="Detail"
      >
        <TVLogicalFocusContainerBoundary container={containers[0]}>
          <Focusable
            accessibilityLabel="Play"
            onPress={jest.fn()}
            platform="tv"
            tvFocusId="detail:play"
          />
          <Focusable
            accessibilityLabel="More"
            onPress={jest.fn()}
            platform="tv"
            tvFocusBoundaryDirections={['right']}
            tvFocusId="detail:more"
            tvFocusNeighbours={{right: 'detail:facts'}}
          />
        </TVLogicalFocusContainerBoundary>
        <TVLogicalFocusContainerBoundary container={containers[1]}>
          <Focusable
            accessibilityLabel="Facts"
            onPress={jest.fn()}
            platform="tv"
            tvFocusBoundaryDirections={['left']}
            tvFocusId="detail:facts"
          />
        </TVLogicalFocusContainerBoundary>
      </TVNavigationFocusBoundary>,
      {createNodeMock: targetFactory(targets, ['Play', 'More', 'Facts'])},
    );
  });

  await act(async () => nativeFocusable(renderer, 'Play').props.onFocus({}));
  await act(async () => directionHandler?.({eventType: 'right'}));
  expect(targets.get('Facts')?.requestTVFocus).not.toHaveBeenCalled();

  await act(async () => nativeFocusable(renderer, 'More').props.onFocus({}));
  await act(async () => directionHandler?.({eventType: 'right'}));
  expect(targets.get('Facts')?.requestTVFocus).toHaveBeenCalledTimes(1);
});

test('a boundary request skips missing cast and extras containers', async () => {
  const targets = new Map<string, TVFocusNode & {requestTVFocus: jest.Mock}>();
  const containers: TVLogicalFocusContainer[] = [
    {
      id: 'detail:episodes',
      movement: 'native',
      neighbours: {down: 'detail:cast'},
    },
    {
      id: 'detail:cast',
      movement: 'native',
      neighbours: {down: 'detail:extras'},
    },
    {
      id: 'detail:extras',
      movement: 'native',
      neighbours: {down: 'detail:facts'},
    },
    {id: 'detail:facts', movement: 'native'},
  ];
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <TVNavigationFocusBoundary
        containers={containers}
        fence={fence}
        routeName="Detail"
      >
        <TVLogicalFocusContainerBoundary container={containers[0]}>
          <Focusable
            accessibilityLabel="Episode"
            onPress={jest.fn()}
            platform="tv"
            tvFocusBoundaryDirections={['down']}
            tvFocusId="detail:episode"
          />
        </TVLogicalFocusContainerBoundary>
        <TVLogicalFocusContainerBoundary container={containers[3]}>
          <Focusable
            accessibilityLabel="Facts"
            onPress={jest.fn()}
            platform="tv"
            tvFocusId="detail:facts"
          />
        </TVLogicalFocusContainerBoundary>
      </TVNavigationFocusBoundary>,
      {createNodeMock: targetFactory(targets, ['Episode', 'Facts'])},
    );
  });

  await act(async () => nativeFocusable(renderer, 'Episode').props.onFocus({}));
  await act(async () => directionHandler?.({eventType: 'down'}));
  expect(targets.get('Facts')?.requestTVFocus).toHaveBeenCalledTimes(1);
});

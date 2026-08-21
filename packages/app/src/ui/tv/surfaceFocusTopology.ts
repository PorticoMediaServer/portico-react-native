import type {TVLogicalFocusContainer} from '@portico-react-native/tv-focus';

export type TVBrowseFocusSurface =
  | 'channels'
  | 'home'
  | 'library'
  | 'profile-selection'
  | 'saved'
  | 'search';

const surfaceContainers = Object.freeze(
  Object.fromEntries(
    (
      [
        'channels',
        'home',
        'library',
        'profile-selection',
        'saved',
        'search',
      ] as const
    ).map(surface => [
      surface,
      Object.freeze({id: `${surface}:content`, movement: 'native' as const}),
    ]),
  ) as Record<TVBrowseFocusSurface, TVLogicalFocusContainer>,
);

const surfaceTopologies = Object.freeze(
  Object.fromEntries(
    Object.entries(surfaceContainers).map(([surface, container]) => [
      surface,
      Object.freeze([container]),
    ]),
  ) as Record<TVBrowseFocusSurface, readonly TVLogicalFocusContainer[]>,
);

export function tvBrowseSurfaceFocusContainer(
  surface: TVBrowseFocusSurface,
): TVLogicalFocusContainer {
  return surfaceContainers[surface];
}

export function tvBrowseSurfaceFocusContainers(
  surface: TVBrowseFocusSurface,
): readonly TVLogicalFocusContainer[] {
  return surfaceTopologies[surface];
}

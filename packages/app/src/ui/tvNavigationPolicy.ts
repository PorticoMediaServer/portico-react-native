import type {
  TVFocusFence,
  TVFocusRouteIdentity,
} from '@portico-react-native/tv-focus';
import {tvFocusRouteScope} from '@portico-react-native/tv-focus';

export const tvPrimaryRouteNames = [
  'Home',
  'Library',
  'Channels',
  'Saved',
] as const;
export type TVPrimaryRouteName = (typeof tvPrimaryRouteNames)[number];
export type TVProductRouteName =
  | TVPrimaryRouteName
  | 'Search'
  | 'Settings'
  | 'Person'
  | 'ProfileSelection'
  | 'Detail'
  | 'Player';

export type TVNavigationParams = Readonly<Record<string, unknown>> | undefined;

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Returns a stable product identity rather than React Navigation's ephemeral
 * route key. Only allowlisted, non-secret ids participate in focus scope.
 */
export function tvRouteIdentity(
  name: TVProductRouteName,
  params?: TVNavigationParams,
): TVFocusRouteIdentity {
  switch (name) {
    case 'Detail': {
      const mediaId = safeId(params?.mediaId);
      const episodeId = safeId(params?.episodeId);
      const seasonId = safeId(params?.seasonId);
      return {
        name,
        semanticId:
          [mediaId, seasonId, episodeId].filter(Boolean).join('/') || undefined,
      };
    }
    case 'Person':
      return {name, semanticId: safeId(params?.personId)};
    case 'Player': {
      const mediaId = safeId(params?.mediaId);
      const groupId = safeId(params?.watchWithFriendsGroupId);
      const downloadId = safeId(params?.localDownloadId);
      const kind =
        params?.live === true
          ? 'live'
          : params?.dvr === true
            ? 'dvr'
            : params?.libraryChannel === true
              ? 'library-channel'
              : downloadId
                ? 'download'
                : 'vod';
      return {
        name,
        semanticId:
          [kind, mediaId, groupId, downloadId].filter(Boolean).join('/') ||
          kind,
      };
    }
    case 'Library': {
      // Pivots replace route state and may have distinct remembered focus.
      const libraryId = safeId(params?.libraryId);
      const pivot = safeId(params?.pivot);
      return {
        name,
        semanticId: [libraryId, pivot].filter(Boolean).join('/') || undefined,
      };
    }
    case 'Settings':
      return {name, semanticId: safeId(params?.section)};
    default:
      return {name};
  }
}

export function tvNavigationFocusScope(
  fence: TVFocusFence,
  name: TVProductRouteName,
  params?: TVNavigationParams,
): string {
  return tvFocusRouteScope(fence, tvRouteIdentity(name, params));
}

export function isTVPrimaryRoute(name: string): name is TVPrimaryRouteName {
  return (tvPrimaryRouteNames as readonly string[]).includes(name);
}

export function tvRouteShowsRail(name: TVProductRouteName): boolean {
  return name !== 'Player';
}

/** Standard Bottom Tabs own state/history; Portico supplies their rail view. */
export const tvTabNavigatorPolicy = Object.freeze({
  backBehavior: 'none' as const,
  detachInactiveScreens: false,
  initialRouteName: 'Home' as TVPrimaryRouteName,
  sceneStyle: {backgroundColor: 'transparent'},
  screenOptions: Object.freeze({
    freezeOnBlur: false,
    headerShown: false,
    lazy: true,
    // A primary rail destination is a root, not a bookmark into a stale
    // detail hierarchy. Standard tabPress still pops the already-selected
    // stack; this also resets it when the viewer leaves for another tab.
    popToTopOnBlur: true,
  }),
});

/**
 * The initial television stack deliberately retains inactive native views.
 * This is a bounded stack, preserves tvOS focus/scroll continuity, and can be
 * tightened route-by-route after direct device verification.
 */
export const tvStackNavigatorPolicy = Object.freeze({
  detachInactiveScreens: false,
  screenOptions: Object.freeze({
    animationEnabled: true,
    gestureEnabled: false,
    headerShown: false,
  }),
});

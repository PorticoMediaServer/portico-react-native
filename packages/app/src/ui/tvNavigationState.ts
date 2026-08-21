import type {NavigationAction, NavigationState, NavigatorScreenParams, PartialState} from '@react-navigation/native';
import type {PorticoRoute} from './navigation';
import {resolveTVCurrentDestination} from './tv/currentDestination';
export {porticoRouteForTVScreen} from './tv/currentDestination';

export type TVNavigationState = NavigationState | PartialState<NavigationState>;

export type TVSectionTargetParams = {
  HomeRoot: undefined;
  LibraryRoot: {libraryId?: string; pivot?: string} | undefined;
  ChannelsRoot: {tab?: string} | undefined;
  SavedRoot: {tab?: string} | undefined;
};

export type TVTarget =
  | {tab: 'Home' | 'Library' | 'Channels' | 'Saved'; params?: NavigatorScreenParams<TVSectionTargetParams>}
  | {name: 'Search' | 'Settings' | 'Person' | 'Detail' | 'Player'; params?: object; tab?: undefined};

export function porticoRouteFromTVState(state: TVNavigationState | undefined): PorticoRoute {
  return resolveTVCurrentDestination(state).route;
}

export function activeTVSectionStackKey(state: TVNavigationState | undefined): string | undefined {
  return resolveTVCurrentDestination(state).sectionStackKey;
}

export function targetActiveTVSectionAction(
  state: TVNavigationState | undefined,
  action: NavigationAction,
): NavigationAction | undefined {
  const target = activeTVSectionStackKey(state);
  return target ? {...action, target} : undefined;
}

export function tvTargetForPorticoRoute(route: PorticoRoute): TVTarget | undefined {
  switch (route.name) {
    case 'home': return {tab: 'Home', params: {screen: 'HomeRoot'}};
    case 'library': return {tab: 'Library', params: {screen: 'LibraryRoot', params: {libraryId: route.libraryId, pivot: route.pivot}}};
    case 'channels': return {tab: 'Channels', params: {screen: 'ChannelsRoot', params: {tab: route.tab}}};
    case 'saved': return {tab: 'Saved', params: {screen: 'SavedRoot', params: {tab: route.tab}}};
    case 'downloads': return undefined;
    case 'search': return {name: 'Search', params: {query: route.query}};
    case 'settings': return {name: 'Settings', params: {section: route.section}};
    case 'person': return {name: 'Person', params: {personId: route.personId}};
    case 'detail': return {name: 'Detail', params: route};
    case 'player': return {name: 'Player', params: route};
  }
}

export function tvSecondaryRouteShouldReplace(current: PorticoRoute, next: PorticoRoute): boolean {
  if (current.name !== next.name) return false;
  switch (next.name) {
    case 'search':
    case 'settings':
      return true;
    case 'person':
      return current.name === 'person' && current.personId === next.personId;
    case 'detail':
      // Season/episode selection is replace-style presentation state for the
      // same media detail identity, matching Client Core and handheld policy.
      return current.name === 'detail' && current.mediaId === next.mediaId;
    case 'player':
      return current.name === 'player' && current.mediaId === next.mediaId && current.live === next.live && current.dvr === next.dvr && current.libraryChannel === next.libraryChannel && current.localDownloadId === next.localDownloadId && current.watchWithFriendsGroupId === next.watchWithFriendsGroupId;
    default:
      return false;
  }
}

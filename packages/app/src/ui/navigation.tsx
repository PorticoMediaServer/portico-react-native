import React, {createContext, useContext, useMemo, useRef, useState} from 'react';
import {Platform} from 'react-native';
import type {MediaViewModel} from '../data/contracts';
import {detailRouteForMedia} from '../data/detailNavigation';

export type PrimaryDestination = 'home' | 'library' | 'channels' | 'saved' | 'downloads';

export type PorticoRoute =
  | {name: 'home'}
  | {name: 'library'; libraryId?: string; pivot?: string}
  | {name: 'channels'; tab?: string}
  | {name: 'saved'; tab?: string}
  | {name: 'downloads'}
  | {name: 'search'; query?: string}
  | {name: 'settings'; section?: string}
  | {name: 'person'; personId: string}
  | {name: 'detail'; mediaId: string; seasonId?: string; episodeId?: string; mediaKind?: 'live-channel' | 'live-program'}
  | {name: 'player'; mediaId: string; live?: boolean; dvr?: boolean; libraryChannel?: boolean; watchWithFriendsGroupId?: string; localDownloadId?: string; playbackIntentRevision?: number};

export type PlayableMediaIdentity = Pick<
  MediaViewModel,
  'id' | 'kind' | 'parentId' | 'playbackMediaId'
>;

/**
 * Preserve the server identity expected by each playback surface. A DVR
 * recording is not a media id, while a live programme normally plays through
 * its channel playback target. Keeping this routing in navigation prevents
 * cards and detail screens from quietly falling back to generic VOD playback.
 */
export function playerRouteForMedia(
  item: PlayableMediaIdentity,
): Extract<PorticoRoute, {name: 'player'}> {
  if (item.kind === 'recording') {
    return {name: 'player', mediaId: item.id, dvr: true};
  }
  if (item.kind === 'live-channel' || item.kind === 'live-program') {
    return {
      name: 'player',
      mediaId: item.playbackMediaId || item.parentId || item.id,
      live: true,
    };
  }
  return {name: 'player', mediaId: item.playbackMediaId};
}

export function shouldRetainPlayerOnBack(
  route: PorticoRoute | undefined,
  environment: {os: string; isTV: boolean} = {os: Platform.OS, isTV: Platform.isTV},
): route is Extract<PorticoRoute, {name: 'player'}> {
  // Handheld Back always collapses the one persistent player instead of
  // destroying it. tvOS intentionally keeps playback route-bound.
  return route?.name === 'player' && !environment.isTV;
}

export interface PorticoNavigationActions {
  route: PorticoRoute;
  minimizedPlayer?: Extract<PorticoRoute, {name: 'player'}>;
  persistentPlayer?: Extract<PorticoRoute, {name: 'player'}>;
  selectPrimary(destination: PrimaryDestination): void;
  openSearch(query?: string): void;
  openSettings(section?: string): void;
  openDetail(mediaId: string, selection?: {seasonId?: string; episodeId?: string; mediaKind?: 'live-channel' | 'live-program'}): void;
  openMediaDetail(item: Pick<MediaViewModel, 'id' | 'kind' | 'parentId' | 'grandparentId'>): void;
  openPerson(personId: string): void;
  openPlayableMedia(item: PlayableMediaIdentity): void;
  openPlayer(mediaId: string, live?: boolean): void;
  openDownloadedPlayer(mediaId: string, localDownloadId: string): void;
  replaceLibraryPresentation(libraryId?: string, pivot?: string): void;
  replacePrimarySubTab(destination: 'channels' | 'saved', tab: string): void;
  replaceSearchQuery(query?: string): void;
  replaceSettingsSection(section?: string): void;
  openWatchWithFriendsPlayer(mediaId: string, groupId: string): void;
  openDvrPlayer(recordingId: string): void;
  openLibraryChannel(channelId: string): void;
  back(): void;
  collapsePlayer(): void;
  closePlayer(): void;
  minimizePlayer(route: Extract<PorticoRoute, {name: 'player'}>): void;
  closeMinimizedPlayer(): void;
  restoreMinimizedPlayer(): void;
}

export interface PorticoNavigatorCommands {
  back(): void;
  open(route: PorticoRoute): void;
  restorePlayer(route: Extract<PorticoRoute, {name: 'player'}>): void;
  replace(route: PorticoRoute): void;
  selectPrimary(destination: PrimaryDestination): void;
}

const PorticoNavigationContext = createContext<PorticoNavigationActions | undefined>(undefined);

/**
 * React Navigation-backed product navigation for handheld clients.
 *
 * The navigator owns route state and history. This provider deliberately owns
 * only Portico policy that isn't route machinery: offline source resolution
 * and the persistent mini-player descriptor. The actual playback authority is
 * hosted above disposable navigator screens by MobileNavigationApplication.
 */
export function PorticoNavigationActionProvider({
  children,
  commands,
  playerPersistence = 'minimize-on-exit',
  route,
}: {
  children?: React.ReactNode;
  commands: PorticoNavigatorCommands;
  playerPersistence?: 'minimize-on-exit' | 'route-bound';
  route: PorticoRoute;
}) {
  const [minimizedPlayer, setMinimizedPlayer] = useState<Extract<PorticoRoute, {name: 'player'}>>();
  const [persistentPlayer, setPersistentPlayer] = useState<Extract<PorticoRoute, {name: 'player'}>>();
  const playbackRequest = useRef(0);
  const playerExitMode = useRef<'minimize' | 'close'>('minimize');
  const previousRouteWasPlayer = useRef(route.name === 'player');

  React.useEffect(() => {
    const wasPlayer = previousRouteWasPlayer.current;
    previousRouteWasPlayer.current = route.name === 'player';
    if (playerPersistence === 'route-bound' && wasPlayer && route.name !== 'player') {
      setMinimizedPlayer(undefined);
      setPersistentPlayer(undefined);
    }
  }, [playerPersistence, route.name]);

  const prepareToLeavePlayer = React.useCallback(() => {
    if (route.name !== 'player') return;
    if (playerPersistence === 'route-bound') return;
    setPersistentPlayer(current => current ?? route);
    setMinimizedPlayer(current => current ?? route);
  }, [playerPersistence, route]);

  const openResolvedPlayer = React.useCallback((next: Extract<PorticoRoute, {name: 'player'}>) => {
    playerExitMode.current = 'minimize';
    const currentPlayer = persistentPlayer ?? (route.name === 'player' ? route : undefined);
    const sameSource = Boolean(currentPlayer && sameSemanticRoute(currentPlayer, next));
    const resolved = sameSource
      ? {...next, playbackIntentRevision: (currentPlayer?.playbackIntentRevision ?? 0) + 1}
      : next;
    setPersistentPlayer(resolved);
    setMinimizedPlayer(undefined);
    if (sameSemanticRoute(route, resolved)) commands.replace(resolved);
    else commands.open(resolved);
  }, [commands, persistentPlayer, route]);

  const value = useMemo<PorticoNavigationActions>(() => ({
    route,
    minimizedPlayer,
    persistentPlayer,
    selectPrimary: destination => {
      playbackRequest.current += 1;
      prepareToLeavePlayer();
      commands.selectPrimary(destination);
    },
    openSearch: query => {
      playbackRequest.current += 1;
      prepareToLeavePlayer();
      if (route.name !== 'search') commands.open({name: 'search', query});
      else commands.replace({name: 'search', query});
    },
    openSettings: section => {
      playbackRequest.current += 1;
      prepareToLeavePlayer();
      if (route.name !== 'settings') commands.open({name: 'settings', section});
      else commands.replace({name: 'settings', section});
    },
    openDetail: (mediaId, selection) => {
      playbackRequest.current += 1;
      prepareToLeavePlayer();
      const next: Extract<PorticoRoute, {name: 'detail'}> = {name: 'detail', mediaId, ...selection};
      if (sameSemanticRoute(route, next)) commands.replace(next);
      else commands.open(next);
    },
    openMediaDetail: item => {
      playbackRequest.current += 1;
      prepareToLeavePlayer();
      const next = detailRouteForMedia(item);
      if (sameSemanticRoute(route, next)) commands.replace(next);
      else commands.open(next);
    },
    openPerson: personId => {
      playbackRequest.current += 1;
      prepareToLeavePlayer();
      const next: Extract<PorticoRoute, {name: 'person'}> = {name: 'person', personId};
      if (sameSemanticRoute(route, next)) commands.replace(next);
      else commands.open(next);
    },
    openPlayableMedia: item => {
      playbackRequest.current += 1;
      const next = playerRouteForMedia(item);
      if (!Platform.isTV && isAudioMediaKind(item.kind)) {
        playerExitMode.current = 'minimize';
        setPersistentPlayer(next);
        setMinimizedPlayer(next);
        if (route.name === 'player') commands.back();
      } else {
        openResolvedPlayer(next);
      }
    },
    openPlayer: (mediaId, live) => {
      playbackRequest.current += 1;
      openResolvedPlayer({name: 'player', mediaId, live});
    },
    openDownloadedPlayer: (mediaId, localDownloadId) => {
      playbackRequest.current += 1;
      openResolvedPlayer({name: 'player', mediaId, localDownloadId});
    },
    replaceLibraryPresentation: (libraryId, pivot) => commands.replace({name: 'library', libraryId, pivot}),
    replacePrimarySubTab: (destination, tab) => commands.replace({name: destination, tab}),
    replaceSearchQuery: query => commands.replace({name: 'search', query}),
    replaceSettingsSection: section => commands.replace({name: 'settings', section}),
    openWatchWithFriendsPlayer: (mediaId, groupId) => {
      playbackRequest.current += 1;
      const next: Extract<PorticoRoute, {name: 'player'}> = {
        name: 'player', mediaId, watchWithFriendsGroupId: groupId,
      };
      if (route.name === 'player' && route.watchWithFriendsGroupId === groupId) {
        commands.restorePlayer(next);
      } else {
        openResolvedPlayer(next);
      }
    },
    openDvrPlayer: recordingId => {
      playbackRequest.current += 1;
      openResolvedPlayer({name: 'player', mediaId: recordingId, dvr: true});
    },
    openLibraryChannel: channelId => {
      playbackRequest.current += 1;
      openResolvedPlayer({name: 'player', mediaId: channelId, libraryChannel: true});
    },
    back: () => {
      playbackRequest.current += 1;
      commands.back();
    },
    collapsePlayer: () => {
      if (route.name !== 'player' || playerPersistence === 'route-bound') return;
      playerExitMode.current = 'minimize';
      setPersistentPlayer(route);
      setMinimizedPlayer(route);
      commands.back();
    },
    closePlayer: () => {
      playerExitMode.current = 'close';
      setMinimizedPlayer(undefined);
      setPersistentPlayer(undefined);
      if (route.name === 'player') commands.back();
    },
    minimizePlayer: player => {
      if (playerExitMode.current === 'close') {
        playerExitMode.current = 'minimize';
        return;
      }
      setPersistentPlayer(player);
      setMinimizedPlayer(current => current ?? player);
    },
    closeMinimizedPlayer: () => {
      setMinimizedPlayer(undefined);
      setPersistentPlayer(undefined);
    },
    restoreMinimizedPlayer: () => {
      if (!minimizedPlayer) return;
      setMinimizedPlayer(undefined);
      commands.restorePlayer(minimizedPlayer);
    },
  }), [commands, minimizedPlayer, openResolvedPlayer, persistentPlayer, playerPersistence, prepareToLeavePlayer, route]);

  return <PorticoNavigationContext.Provider value={value}>{children}</PorticoNavigationContext.Provider>;
}

export function usePorticoNavigationActions(): PorticoNavigationActions {
  const context = useContext(PorticoNavigationContext);
  if (!context) {
    throw new Error('usePorticoNavigationActions must be used within PorticoNavigationActionProvider.');
  }
  return context;
}

/** Semantic identity excludes replace-state selections such as episode/pivot. */
export function sameSemanticRoute(left: PorticoRoute, right: PorticoRoute): boolean {
  if (left.name !== right.name) return false;
  if (left.name === 'person' && right.name === 'person') return left.personId === right.personId;
  if (left.name === 'detail' && right.name === 'detail') return left.mediaId === right.mediaId;
  if (left.name === 'player' && right.name === 'player') {
    return left.mediaId === right.mediaId
      && Boolean(left.live) === Boolean(right.live)
      && Boolean(left.dvr) === Boolean(right.dvr)
      && Boolean(left.libraryChannel) === Boolean(right.libraryChannel)
      && left.watchWithFriendsGroupId === right.watchWithFriendsGroupId
      && left.localDownloadId === right.localDownloadId;
  }
  return false;
}

export function isAudioMediaKind(kind: PlayableMediaIdentity['kind']): boolean {
  return kind === 'track' || kind === 'book' || kind === 'chapter';
}

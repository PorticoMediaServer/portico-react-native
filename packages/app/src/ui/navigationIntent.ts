import type {LinkingOptions, ParamListBase} from '@react-navigation/native';
import {
  consumePorticoPendingDestinationIntent,
  createPorticoPendingDestinationIntent,
  parsePorticoLink,
  porticoDestinationIsAvailable,
  type PorticoClient,
  type PorticoDestination,
  type PorticoDestinationCapabilities,
  type PorticoPlatformClass,
  type ProfileTransitionReason,
  type ViewerScope,
} from '@portico/client-core';
import {Linking} from 'react-native';
import type {PorticoNavigationActions} from './navigation';

export type VerifiedNavigationIntentContext = {
  viewerScope: ViewerScope;
  platform: PorticoPlatformClass;
  capabilities?: PorticoDestinationCapabilities;
  /** Final server/profile authorization check, performed after authentication. */
  authorize(destination: PorticoDestination): boolean | Promise<boolean>;
  /** Dispatches through the one active navigator rather than a second router. */
  dispatch(destination: PorticoDestination): void;
};

export type PorticoDestinationAuthorizationOptions = {
  /** Offline resources are local and must be verified by the owning device. */
  authorizeOffline?(destination: Extract<PorticoDestination, {destination: 'player'}>): boolean | Promise<boolean>;
};

/**
 * Performs the final, read-only authorization check against the exact active
 * server/profile. Parsing and capability checks are intentionally insufficient:
 * an opaque identifier must not enter route state until the server confirms
 * that this viewer can still see it.
 */
export async function authorizePorticoDestination(
  client: PorticoClient,
  destination: PorticoDestination,
  platform: PorticoPlatformClass,
  capabilities: PorticoDestinationCapabilities = {},
  options: PorticoDestinationAuthorizationOptions = {},
): Promise<boolean> {
  if (!porticoDestinationIsAvailable(destination, platform, capabilities)) return false;
  try {
    switch (destination.destination) {
      case 'library':
        if (!destination.libraryId) return true;
        await client.library(destination.libraryId);
        if (destination.pivot) {
          await client.libraryPivotBrowseCapabilities(destination.libraryId, destination.pivot);
        }
        return true;
      case 'person':
        await client.person(destination.personId, {limit: 1});
        return true;
      case 'media-detail':
        if (destination.mediaKind === 'live-channel') {
          await client.liveTvChannel(destination.mediaId);
        } else {
          await client.media(destination.mediaId);
        }
        return true;
      case 'notifications':
        await client.viewerNotifications({limit: 1});
        return true;
      case 'watch-with-friends':
        if (!destination.groupId) return false;
        await client.watchWithFriendsGroup(destination.groupId);
        return true;
      case 'player':
        if (destination.context === 'offline') {
          return Boolean(options.authorizeOffline && await options.authorizeOffline(destination));
        }
        if (destination.context === 'watch-with-friends') {
          if (!destination.watchWithFriendsGroupId) return false;
          const group = await client.watchWithFriendsGroup(destination.watchWithFriendsGroupId);
          return group.mediaId === destination.mediaId;
        }
        if (destination.context === 'live') {
          await client.liveTvChannel(destination.mediaId);
        } else if (destination.context === 'library-channel') {
          await client.libraryChannelGuide(destination.mediaId, {limit: 1});
        } else if (destination.context === 'dvr') {
          // A recording id belongs to the DVR resource namespace; it is not a
          // generic media id and must be authorized through the DVR contract.
          await client.dvrRecording(destination.mediaId);
        } else {
          await client.media(destination.mediaId);
        }
        return true;
      default:
        return true;
    }
  } catch {
    return false;
  }
}

type ExternalLinkSource = Pick<typeof Linking, 'getInitialURL' | 'addEventListener'>;

/** Approved HTTPS origins whose Portico paths may be parsed at app ingress. */
export const PORTICO_APPROVED_HTTPS_LINK_HOSTS = [
  'app.getportico.tv',
  'web.getportico.tv',
  'beta-web.getportico.tv',
] as const;

/**
 * Only app.getportico.tv is currently provisioned in the Apple associated-
 * domains entitlement. Hosted web origins remain approved parser inputs for
 * explicit handoff, but must not be advertised as OS universal links until
 * their AASA and entitlements are deliberately provisioned.
 */
export const PORTICO_REACT_NAVIGATION_LINK_PREFIXES = [
  'portico://',
  'https://app.getportico.tv',
] as const;

export function parsePorticoExternalLink(value: string): PorticoDestination | undefined {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme === 'portico') return parsePorticoLink(value);
  if (scheme !== 'https') return undefined;
  return parsePorticoLink(value, {
    allowedWebHosts: PORTICO_APPROVED_HTTPS_LINK_HOSTS,
  });
}

/** Optional product presentations that are not standalone legacy route methods. */
export type PorticoDestinationPresentations = {
  openNotifications?(): void;
  openWatchWithFriends?(groupId?: string): void;
};

/**
 * One canonical destination-to-facade translation for notifications, links,
 * and future OS activities. Platform navigators still own history policy.
 */
export function dispatchPorticoDestination(
  navigation: PorticoNavigationActions,
  destination: PorticoDestination,
  presentations: PorticoDestinationPresentations = {},
): boolean {
  switch (destination.destination) {
    case 'home':
    case 'downloads':
      navigation.selectPrimary(destination.destination);
      return true;
    case 'library':
      if (destination.libraryId || destination.pivot) {
        navigation.replaceLibraryPresentation(
          destination.libraryId,
          destination.pivot,
        );
      } else navigation.selectPrimary('library');
      return true;
    case 'channels':
    case 'saved':
      if (destination.tab) {
        navigation.replacePrimarySubTab(destination.destination, destination.tab);
      } else navigation.selectPrimary(destination.destination);
      return true;
    case 'search':
      navigation.openSearch(destination.query);
      return true;
    case 'settings':
      navigation.openSettings(destination.section);
      return true;
    case 'person':
      navigation.openPerson(destination.personId);
      return true;
    case 'media-detail':
      navigation.openDetail(destination.mediaId, {
        seasonId: destination.seasonId,
        episodeId: destination.episodeId,
        mediaKind: destination.mediaKind,
      });
      return true;
    case 'notifications':
      if (!presentations.openNotifications) return false;
      presentations.openNotifications();
      return true;
    case 'watch-with-friends':
      if (!presentations.openWatchWithFriends) return false;
      presentations.openWatchWithFriends(destination.groupId);
      return true;
    case 'player':
      if (destination.context === 'offline' && destination.localDownloadId) {
        navigation.openDownloadedPlayer(
          destination.mediaId,
          destination.localDownloadId,
        );
      } else if (
        destination.context === 'watch-with-friends' &&
        destination.watchWithFriendsGroupId
      ) {
        navigation.openWatchWithFriendsPlayer(
          destination.mediaId,
          destination.watchWithFriendsGroupId,
        );
      } else if (destination.context === 'dvr') {
        navigation.openDvrPlayer(destination.mediaId);
      } else if (destination.context === 'library-channel') {
        navigation.openLibraryChannel(destination.mediaId);
      } else {
        navigation.openPlayer(destination.mediaId, destination.context === 'live');
      }
      return true;
  }
}

/**
 * Holds at most one short-lived external navigation intent. URLs are parsed at
 * ingress, but are never dispatched until a verified viewer scope performs a
 * final authorization and capability check. Nothing sensitive is persisted.
 */
export class PorticoNavigationIntentCoordinator {
  private active?: VerifiedNavigationIntentContext;
  private pending?: ReturnType<typeof createPorticoPendingDestinationIntent>;
  private authorityGeneration = 0;
  private intentGeneration = 0;

  captureURL(value: string, now = new Date()): boolean {
    const destination = parsePorticoExternalLink(value);
    if (!destination) return false;
    const expectedIdentity = this.active
      ? {
          authority: this.active.viewerScope.authority,
          accountId: this.active.viewerScope.accountId,
          serverId: this.active.viewerScope.serverId,
          profileId: this.active.viewerScope.profileId,
        }
      : undefined;
    this.pending = createPorticoPendingDestinationIntent(destination, {
      now,
      ...(expectedIdentity ? {expectedIdentity} : {}),
    });
    this.intentGeneration += 1;
    void this.flush(now);
    return true;
  }

  /** Publishes only an already-verified account/profile/server generation. */
  activate(context: VerifiedNavigationIntentContext, now = new Date()): void {
    this.authorityGeneration += 1;
    this.active = context;
    void this.flush(now);
  }

  /**
   * Revokes the active dispatch authority at the viewer transition fence.
   * Sign-out and profile/server changes discard any intent bound to the prior
   * viewer. A caller may retain an unbound pre-login intent during normal
   * authentication by explicitly passing false.
   */
  deactivate(discardPending = true): void {
    this.authorityGeneration += 1;
    this.active = undefined;
    if (discardPending) {
      this.pending = undefined;
      this.intentGeneration += 1;
    }
  }

  /** Temporarily removes dispatch authority while retaining pre-login intent. */
  suspend(): void {
    this.deactivate(false);
  }

  /** Explicit cancellation/sign-out boundary; no intent survives it. */
  reset(): void {
    this.deactivate(true);
  }

  /**
   * Revokes an old viewer inside the transactional focus fence. A URL captured
   * before the very first sign-in has no viewer binding and may proceed to the
   * newly verified viewer's final authorization check. Once any viewer was
   * active, or an intent was bound to one, the transition discards it.
   */
  transitionViewerFence(): void {
    const hadActiveViewer = Boolean(this.active);
    this.authorityGeneration += 1;
    this.active = undefined;
    if (hadActiveViewer || this.pending?.expectedIdentity) {
      this.pending = undefined;
      this.intentGeneration += 1;
    }
  }

  hasPendingIntent(): boolean {
    return Boolean(this.pending);
  }

  private async flush(now: Date): Promise<void> {
    if (!this.active || !this.pending) return;
    const pending = this.pending;
    const active = this.active;
    const authorityGeneration = this.authorityGeneration;
    const intentGeneration = this.intentGeneration;
    // Consume once even when authorization rejects it. Replaying a rejected
    // external intent after later privilege changes would cross viewer fences.
    this.pending = undefined;
    const destination = consumePorticoPendingDestinationIntent(
      pending,
      active.viewerScope,
      active.platform,
      {
        now,
        capabilities: active.capabilities,
        // Identity, expiry, and capability fencing happen synchronously here.
        // Resource authorization is deliberately awaited below so it can use
        // the active server rather than weakening this path to a local check.
        authorize: () => true,
      },
    );
    if (!destination) return;
    let authorized = false;
    try {
      authorized = await active.authorize(destination);
    } catch {
      authorized = false;
    }
    if (!authorized || this.active !== active || this.authorityGeneration !== authorityGeneration || this.intentGeneration !== intentGeneration) return;
    try {
      active.dispatch(destination);
    } catch {
      // External navigation is an enhancement, never a reason to take down the
      // signed-in shell. Navigator teardown races therefore fail silently.
    }
  }
}

export const porticoNavigationIntents = new PorticoNavigationIntentCoordinator();

type ViewerRuntimeIntentFence = {
  register(
    phase: 'focus',
    hook: (
      scope: ViewerScope,
      reason: ProfileTransitionReason,
    ) => void | Promise<void>,
  ): () => void;
};

/** Clears old-viewer intents inside the transactional viewer focus fence. */
export function registerNavigationIntentViewerFence(
  runtime: ViewerRuntimeIntentFence,
  coordinator: PorticoNavigationIntentCoordinator = porticoNavigationIntents,
): () => void {
  return runtime.register('focus', () => coordinator.transitionViewerFence());
}

/**
 * React Navigation is the sole native URL subscription owner. We intentionally
 * return null / do not call React Navigation's raw listener because a URL must
 * pass Portico's post-auth authorization fence before becoming route state.
 * The coordinator dispatches the approved canonical destination through the
 * active navigator facade instead.
 */
export function createPorticoReactNavigationLinking<ParamList extends ParamListBase>(
  coordinator: PorticoNavigationIntentCoordinator = porticoNavigationIntents,
  source: ExternalLinkSource = Linking,
): LinkingOptions<ParamList> {
  return {
    prefixes: [...PORTICO_REACT_NAVIGATION_LINK_PREFIXES],
    async getInitialURL() {
      try {
        const value = await source.getInitialURL();
        if (value) coordinator.captureURL(value);
      } catch {
        // OS link retrieval failure must not become an application boot error.
      }
      return null;
    },
    subscribe(_listener) {
      const subscription = source.addEventListener('url', event => {
        coordinator.captureURL(event.url);
      });
      return () => subscription.remove();
    },
  };
}

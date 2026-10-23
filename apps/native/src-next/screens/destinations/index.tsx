import React from 'react';
import type {ContentScope} from '../../../../../packages/client-core/src/library-content';
import type {MessageId} from '../../../../../packages/i18n/src';
import type {NativeOfflineDownloadsAdapter} from '../../platform/offline-downloads';
import {sameAuthority} from '../../shell/model';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeRouteRenderer} from '../../shell/route-registry';
import {SearchScreen} from '../search/SearchScreen';
import {NativeSearchDestination} from '../search/model';
import type {NativeSearchActions, NativeSearchExplorePort, NativeSearchSelectionPort} from '../search/types';
import {SavedScreen, type NativeSavedActions, type NativeSavedSelectionPort} from '../saved/SavedScreen';
import {NativeSavedDestination} from '../saved/model';
import {DownloadsScreen, type NativeDownloadsCopy} from '../downloads/DownloadsScreen';
import type {OfflineEntry} from '../../platform/offline-downloads';

export type NativeDestinationPorts = Readonly<{
  context: NativeShellBootstrapContext;
  requestId: () => Promise<string>;
  rememberHistory: () => boolean;
  reportError: (error: unknown) => void;
  searchExplore: NativeSearchExplorePort;
  searchActions: NativeSearchActions;
  searchSelection: NativeSearchSelectionPort;
  savedActions: NativeSavedActions;
  savedSelection: NativeSavedSelectionPort;
  offline: NativeOfflineDownloadsAdapter;
  downloads: Readonly<{copy: NativeDownloadsCopy; back: () => void; openTitle: (entry: OfflineEntry) => void}>;
  onThisPhone: MessageId;
}>;
export type NativeDestinationRenderers = Readonly<{
  search: NativeRouteRenderer;
  saved: NativeRouteRenderer;
  downloads: NativeRouteRenderer;
  dispose: () => void;
}>;

export type NativeDownloadsRendererPorts = Readonly<{
  offline: NativeOfflineDownloadsAdapter;
  copy: NativeDownloadsCopy; back: () => void; openTitle: (entry: OfflineEntry) => void;
}>;

/** The STOP1 empty Downloads route has no dependency on Search discovery or selection.
 * Accounts can assemble this checked descriptor while the other producers are landing. */
export function createNativeDownloadsRenderer(context: NativeShellBootstrapContext, ports: NativeDownloadsRendererPorts): NativeRouteRenderer {
  const lifetime = destinationLifetime(context);
  return {render: (_route, runtime) => lifetime.current() ? <DownloadsScreen runtime={runtime} device={ports.offline} copy={ports.copy} back={ports.back} openTitle={ports.openTitle}/> : null};
}

function destinationLifetime(context: NativeShellBootstrapContext) {
  const viewer = context.session()?.viewer, authority = context.authority();
  if (!viewer || !context.current() || viewer.serverId !== authority.serverId || viewer.accountId !== authority.accountId || viewer.profileId !== authority.profileId) throw new Error('native_destination_authority_required');
  const scope: ContentScope = Object.freeze({serverId: viewer.serverId, viewerId: JSON.stringify([viewer.authority, viewer.accountId, viewer.profileId])});
  return {scope, current: () => {
    const live = context.session()?.viewer;
    return context.current() && sameAuthority(authority, context.authority()) && !!live && live.authority === viewer.authority
      && live.serverId === viewer.serverId && live.accountId === viewer.accountId && live.profileId === viewer.profileId;
  }};
}

/** Accounts assembles these descriptors into the sole shell dispatcher and the actual
 * downloads route. Importing this module never registers global routes or a mock host. */
export function createNativeDestinationRenderers(ports: NativeDestinationPorts): NativeDestinationRenderers {
  const lifetime = destinationLifetime(ports.context);
  let disposed = false;
  const current = () => !disposed && lifetime.current();
  const search = new NativeSearchDestination({api: ports.context.api, scope: lifetime.scope, current, rememberHistory: ports.rememberHistory, reportError: ports.reportError});
  const saved = new NativeSavedDestination({api: ports.context.api, scope: lifetime.scope, current, requestId: ports.requestId});
  return Object.freeze({
    search: {render: (route, runtime) => current() && route.kind === 'shell' && route.destination.kind === 'search'
      ? <SearchScreen destination={search} runtime={runtime} explore={ports.searchExplore} actions={ports.searchActions} selection={ports.searchSelection}/> : null},
    saved: {render: (route, runtime) => current() && route.kind === 'shell' && route.destination.kind === 'saved'
      ? <SavedScreen destination={saved} runtime={runtime} device={ports.offline} actions={ports.savedActions} selection={ports.savedSelection} onThisPhone={ports.onThisPhone}/> : null},
    downloads: {render: (_route, runtime) => current() ? <DownloadsScreen runtime={runtime} device={ports.offline} {...ports.downloads}/> : null},
    dispose: () => {if (disposed) return; disposed = true; search.dispose(); saved.dispose();},
  } satisfies NativeDestinationRenderers);
}

export type {NativeSearchActions, NativeSearchExplorePort, NativeSearchExploreSnapshot, NativeSearchGenre, NativeSearchSelectionPort} from '../search/types';
export type {NativeSavedActions, NativeSavedSelectionPort} from '../saved/SavedScreen';
export type {NativeDownloadsCopy} from '../downloads/DownloadsScreen';
export {NativeTVKeyboard} from '../search/TVKeyboard';
export type {NativeTVKeyboardProps} from '../search/TVKeyboard';
export type {NativeDestinationActivation, NativeDestinationActivationPort} from './focus';

import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../shell/route-registry';
import {titleRoute, type NativeShellRoute} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
import {sameAuthority} from '../../shell/model';
import {NativeCollectionController} from './controller';
import {NativeCollectionScreen} from './CollectionScreen';

type CollectionRoute = Extract<NativeShellRoute, {kind: 'collection'}>;

/** One real catalogue collection page. It reads the server's collection view and
 * uses the same authority-local queue selector for Play all and Shuffle. */
export function createNativeCollectionRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  return Object.freeze({
    render: (route: NativeShellRoute, runtime: NativeShellRuntime) => {
      if (route.kind !== 'collection' || !context.current()) return null;
      const viewer = context.session()?.viewer;
      if (!viewer) return null;
      return <CollectionHost key={`${route.libraryId}:${route.collectionId}`} route={route} context={context} runtime={runtime}/>;
    },
  });
}

function CollectionHost({route, context, runtime}: {route: CollectionRoute; context: NativeShellBootstrapContext; runtime: NativeShellRuntime}) {
  const viewer = context.session()!.viewer, authority = context.authority();
  const controller = useMemo(() => new NativeCollectionController({
    api: context.api, scope: {serverId: viewer.serverId, viewerId: JSON.stringify([viewer.authority, viewer.accountId, viewer.profileId])},
    libraryId: route.libraryId, collectionId: route.collectionId, title: route.title, current: context.current,
  }), [context, route.libraryId, route.collectionId, route.title, viewer.accountId, viewer.authority, viewer.profileId, viewer.serverId]);
  useEffect(() => {void controller.open().catch(runtime.reportError); return () => controller.dispose();}, [controller, runtime]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const current = () => context.current() && sameAuthority(context.navigation.getSnapshot().authority, authority);
  const play = (shuffle: boolean) => {
    const port = runtime.playback?.cataloguePlayback?.();
    if (!port) return;
    const operation = new AbortController(), revision = context.navigation.getSnapshot().revision;
    const isCurrent = () => !operation.signal.aborted && current() && context.navigation.getSnapshot().revision === revision;
    void port.playSegments([{source: {container: {kind: 'collection', id: route.collectionId}}, ...(shuffle ? {order: {mode: 'shuffle' as const}} : {})}],
      {signal: operation.signal, isCurrent}).catch(runtime.reportError);
  };
  return <NativeCollectionScreen state={state} runtime={runtime} onPlay={() => play(false)} onShuffle={() => play(true)}
    onSort={(sort, direction) => {void controller.sort(sort, direction).catch(runtime.reportError);}}
    onOpen={entry => {if (current()) context.navigation.open(titleRoute(entry), authority);}}
    onBack={() => {if (current()) context.navigation.back(authority);}}
    onRetry={() => {void controller.retry().catch(runtime.reportError);}}
    onMore={() => {void controller.more().catch(runtime.reportError);}}/>;
}

nativeShellRoutes.registerRoute('collection', createNativeCollectionRenderer);

import React from 'react';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../shell/route-registry';
import {NativeScreenLifetime} from './lifetime';
import {NativeTogetherController} from './together-controller';
import {NativeTogetherMedia} from './together-media';
import {nativeTogetherSession} from './together-session';
import {NativeTogetherScreen} from './TogetherScreen';
import {publishGroupPort} from './group-port';

export function createNativeTogetherRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = new NativeScreenLifetime(context);
  const controller = new NativeTogetherController(lifetime, nativeTogetherSession(context));
  const media = new NativeTogetherMedia(lifetime, context.api);
  // tv-more18: the player chrome's group pill reads the live owner through this registration;
  // it is retired with the route/authority, and it exposes only the owner's own snapshot and
  // its own makeHost action — the port sends no group command and keeps no membership copy.
  const retirePort = publishGroupPort({
    getSnapshot: () => controller.getSnapshot(),
    subscribe: listener => controller.subscribe(listener),
    current: () => lifetime.current() && context.current(),
    makeHost: memberId => controller.makeHost(memberId),
  });
  return {
    render: (route, runtime) => {
      lifetime.assert();
      if (route.kind !== 'together') throw new Error('native_together_route_mismatch');
      return <NativeTogetherScreen ports={{context}} controller={controller} media={media} runtime={runtime}/>;
    },
    dispose: () => {retirePort(); controller.dispose(); media.dispose(); lifetime.dispose();},
  };
}

nativeShellRoutes.registerRoute('together', createNativeTogetherRenderer);

import React from 'react';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../shell/route-registry';
import {NativeScreenLifetime} from './lifetime';
import {NativeTogetherController} from './together-controller';
import {NativeTogetherMedia} from './together-media';
import {nativeTogetherSession} from './together-session';
import {NativeTogetherScreen} from './TogetherScreen';

export function createNativeTogetherRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = new NativeScreenLifetime(context);
  const controller = new NativeTogetherController(lifetime, nativeTogetherSession(context));
  const media = new NativeTogetherMedia(lifetime, context.api);
  return {
    render: (route, runtime) => {
      lifetime.assert();
      if (route.kind !== 'together') throw new Error('native_together_route_mismatch');
      const snapshot = context.navigation.getSnapshot();
      const occurrence = context.navigation.presentationStack().at(-1)?.occurrence;
      const back = () => {
        if (snapshot.route !== route || !occurrence || context.navigation.getSnapshot() !== snapshot || !lifetime.current()) return;
        context.navigation.commitNativePop(snapshot, occurrence);
      };
      return <NativeTogetherScreen ports={{context}} controller={controller} media={media} runtime={runtime} onBack={back}/>;
    },
    dispose: () => {controller.dispose(); media.dispose(); lifetime.dispose();},
  };
}

nativeShellRoutes.registerRoute('together', createNativeTogetherRenderer);

import type {ReactNode} from 'react';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
import {nativeShellRoutes, type NativeShellRouteRegistry} from '../../shell/route-registry';
import {createNativeWatchModule, type NativeWatchModuleBindings} from './module';

/** One registered factory identity deliberately serves both outlets: bind()
 * then creates one authority-local module/control clock and disposes it once. */
export function registerNativeWatch(createBindings: (context: NativeShellBootstrapContext) => NativeWatchModuleBindings,
  registry: NativeShellRouteRegistry = nativeShellRoutes): () => void {
  const create = (context: NativeShellBootstrapContext) => {
    const module = createNativeWatchModule(context, createBindings(context));
    function render(runtime: NativeShellRuntime): ReactNode;
    function render(route: NativeShellRoute, runtime: NativeShellRuntime): ReactNode;
    function render(value: NativeShellRoute | NativeShellRuntime, runtime?: NativeShellRuntime): ReactNode {
      return 'kind' in value ? runtime ? module.title.render(value, runtime) : null : module.render(value);
    }
    return Object.freeze({render, back: module.back, dispose: module.dispose});
  };
  const offTitle = registry.registerRoute('title', create);
  let offWatch: () => void;
  try {offWatch = registry.registerWatch(create);}
  catch (error) {offTitle(); throw error;}
  return () => {offWatch(); offTitle();};
}

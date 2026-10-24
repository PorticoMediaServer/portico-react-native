import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {createNativeEntryActions} from '../destinations/entry-actions';
import {createNativeDownloadsDevice} from '../downloads/device';
import {nativeScreenServices} from '../native-screen-services';
import type {NativeSavedActions} from './SavedScreen';
import {createNativeSavedHubController, createNativeSavedViewController, type NativeSavedViewRoute} from './navigation';

/** Real Saved inputs for a generated presenter. This binds existing services,
 * the borrowed Watch module and the same native device lease as Downloads;
 * it creates neither a renderer nor a second offline store/player. */
export function createNativeSavedState(context: NativeShellBootstrapContext) {
  const lifetime = nativeDestinationLifetime(context), common = nativeScreenServices(context);
  const hub = createNativeSavedHubController(context, common.requestId), device = createNativeDownloadsDevice(context);
  let disposed = false;
  const current = () => !disposed && lifetime.current();
  const entries = createNativeEntryActions(context, {current: () => current() && hub.activation.getSnapshot().visible,
    contains: hub.source.contains, subscribe: hub.source.subscribe});
  const actions: NativeSavedActions = Object.freeze({
    menuState: entries.menuState, openView: hub.openView, openEntry: entries.open, menuEntry: entries.menu, isMenuOpen: entries.isMenuOpen,
    openDownloads: hub.openDownloads, openPin: hub.openPin, editPins: hub.editPins,
  });
  type View = ReturnType<typeof createView>;
  const views = new Map<NativeSavedViewRoute, View>(), cleanups: (() => void)[] = [];
  const retained = (target: NativeSavedViewRoute) => context.navigation.getSnapshot().route === target || context.navigation.retainedRoutes().includes(target);
  function createView(target: NativeSavedViewRoute) {
    const controller = createNativeSavedViewController(context, target, common.requestId);
    const entryActions = createNativeEntryActions(context, {current: () => current() && controller.activation.getSnapshot().visible,
      contains: controller.source.contains, subscribe: controller.source.subscribe});
    return Object.freeze({...controller, actions: entryActions, dispose: () => {entryActions.dispose(); controller.dispose();}});
  }
  const dispose = () => {
    if (disposed) return;
    disposed = true; cleanups.splice(0).forEach(stop => stop());
    for (const view of views.values()) view.dispose();
    views.clear(); entries.dispose(); hub.dispose(); device.dispose();
  };
  const check = () => {
    if (!current()) {dispose(); return;}
    for (const [target, view] of views) if (!retained(target)) {views.delete(target); view.dispose();}
  };
  cleanups.push(context.subscribeAuthority(check), context.navigation.subscribe(check));
  return Object.freeze({source: hub.source, activation: hub.activation, actions, offline: device.device,
    view: (target: NativeSavedViewRoute) => {
      check();
      if (!current() || !retained(target)) return;
      let value = views.get(target);
      if (!value) {value = createView(target); views.set(target, value);}
      return value;
    },
    dispose,
  });
}

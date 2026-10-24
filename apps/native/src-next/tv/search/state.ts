import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import {nativeDestinationActivation} from '../../shell/routes';
import {nativeDestinationLifetime} from '../../screens/destinations/lifetime';
import type {NativeDestinationActivation, NativeDestinationActivationPort} from '../../screens/destinations/focus';
import {nativeScreenServices} from '../../screens/native-screen-services';
import {NativeSearchDestination} from '../../screens/search/model';
import {NativeSearchExplore} from '../../screens/search/explore';
import {createNativeSearchGenreController, nativeSearchRememberHistory, openNativeSearchGenre, openNativeSearchGenres} from '../../screens/search/navigation';

type GenreRoute = Extract<NativeShellRoute, {kind: 'search-genre'}>;

/** Authority-local TV inputs for the eventual generated Search screen. This
 * creates no renderer, registers no route, and performs no eager request. */
export function createNativeTVSearchState(context: NativeShellBootstrapContext) {
  const lifetime = nativeDestinationLifetime(context), common = nativeScreenServices(context);
  let disposed = false, rememberHistory = nativeSearchRememberHistory(context);
  const current = () => !disposed && lifetime.current();
  const destination = new NativeSearchDestination({api: context.api, scope: lifetime.scope, current,
    rememberHistory: () => nativeSearchRememberHistory(context), reportError: error => {if (current()) common.reportError(error, 'search');}});
  const explore = new NativeSearchExplore({api: context.api, current, surface: 'tv', openGenre: genre => {if (current()) openNativeSearchGenre(context, genre);}});
  const genres = new Map<GenreRoute, ReturnType<typeof createNativeSearchGenreController>>();
  const activationListeners = new Set<() => void>();
  const pageActivation = nativeDestinationActivation(context.navigation, {kind: 'search'});
  let previousActivation: NativeDestinationActivation | undefined, activationSnapshot: NativeDestinationActivation | undefined;
  const activation: NativeDestinationActivationPort = {
    subscribe: listener => {if (disposed) return () => {}; activationListeners.add(listener); return () => {activationListeners.delete(listener);};},
    getSnapshot: () => {
      const page = pageActivation.getSnapshot(), visible = current() && page.visible;
      if (!activationSnapshot || previousActivation !== page || activationSnapshot.visible !== visible) {
        previousActivation = page; activationSnapshot = Object.freeze({...page, visible});
      }
      return activationSnapshot;
    },
  };
  const cleanups: (() => void)[] = [];
  const retained = (target: GenreRoute) => context.navigation.getSnapshot().route === target || context.navigation.retainedRoutes().includes(target);
  const dispose = () => {
    if (disposed) return;
    disposed = true; cleanups.splice(0).forEach(stop => stop());
    for (const controller of genres.values()) controller.dispose();
    genres.clear(); destination.dispose(); explore.dispose();
    for (const listener of [...activationListeners]) listener();
    activationListeners.clear();
  };
  const check = () => {
    if (!current()) {dispose(); return;}
    for (const [target, controller] of genres) if (!retained(target)) {genres.delete(target); controller.dispose();}
  };
  const changed = () => {
    check();
    for (const listener of [...activationListeners]) listener();
  };
  cleanups.push(context.subscribeAuthority(changed), context.navigation.subscribe(changed), context.subscribePreferences(() => {
    if (!current()) {dispose(); return;}
    const value = nativeSearchRememberHistory(context);
    if (value === rememberHistory) return;
    rememberHistory = value;
    // The model aborts the earlier history read and clears it immediately when
    // the confirmed preference turns off; late results re-read that getter.
    void destination.refreshHistory().catch(error => {if (current()) common.reportError(error, 'search');});
  }));
  return Object.freeze({
    destination, explore, activation,
    openGenres: () => current() && openNativeSearchGenres(context),
    genre: (target: GenreRoute) => {
      check();
      if (!current() || !retained(target)) return;
      let controller = genres.get(target);
      if (!controller) {controller = createNativeSearchGenreController(context, target); genres.set(target, controller);}
      return controller;
    },
    dispose,
  });
}

import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import {nativeDestinationLifetime} from '../../screens/destinations/lifetime';
import {createNativeSearchController} from '../../screens/search/controller';
import {NativeSearchExplore} from '../../screens/search/explore';
import {createNativeSearchGenreController, openNativeSearchGenre, openNativeSearchGenres} from '../../screens/search/navigation';

type GenreRoute = Extract<NativeShellRoute, {kind: 'search-genre'}>;

/** Authority-local TV inputs for the eventual generated Search screen. This
 * creates no renderer, registers no route, and performs no eager request. */
export function createNativeTVSearchState(context: NativeShellBootstrapContext, target: NativeShellRoute = context.navigation.getSnapshot().route) {
  const lifetime = nativeDestinationLifetime(context), search = createNativeSearchController(context, target);
  let disposed = false;
  const retained = (route: NativeShellRoute) => context.navigation.getSnapshot().route === route || context.navigation.retainedRoutes().includes(route);
  const current = () => !disposed && lifetime.current() && retained(target);
  const explore = new NativeSearchExplore({api: context.api, current, surface: 'tv', openGenre: genre => {if (current()) openNativeSearchGenre(context, genre);}});
  const genres = new Map<GenreRoute, ReturnType<typeof createNativeSearchGenreController>>();
  const cleanups: (() => void)[] = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true; cleanups.splice(0).forEach(stop => stop());
    for (const controller of genres.values()) controller.dispose();
    genres.clear(); search.dispose(); explore.dispose();
  };
  const check = () => {
    if (!current()) {dispose(); return;}
    for (const [target, controller] of genres) if (!retained(target)) {genres.delete(target); controller.dispose();}
  };
  cleanups.push(context.subscribeAuthority(check), context.navigation.subscribe(check));
  return Object.freeze({
    destination: search.source, explore, activation: search.activation, load: search.load,
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

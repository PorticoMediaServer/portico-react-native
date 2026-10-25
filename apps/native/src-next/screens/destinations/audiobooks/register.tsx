import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import type {NativeShellBootstrapContext} from '../../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../../shell/route-registry';
import type {NativeShellRoute} from '../../../shell/routes';
import {nativeDestinationLifetime} from '../lifetime';
import {createNativeEntryActions} from '../entry-actions';
import {NativeAudiobookController} from './model';
import {BookScreen} from './BookScreen';
import {AuthorSeriesScreen} from './AuthorSeriesScreen';

type MenuArgs = Parameters<ReturnType<typeof createNativeEntryActions>['menu']>;
type Page = Readonly<{key: string; entry: ContentEntry; controller: NativeAudiobookController; actions: ReturnType<typeof createNativeEntryActions>;
  /** The route this page is drawn under right now. A cached page outlives the
   * route that created it, so its actions read this slot rather than the first
   * route object they were built with. */
  drawn: {route?: NativeShellRoute}}>;

/** Phone 41a and TV 43: the real book page. One route-owned controller per book. */
export function createNativeBookRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = nativeDestinationLifetime(context);
  let pages = new Map<string, Page>(), disposed = false;
  const current = () => !disposed && lifetime.current();
  const close = (page: Page) => {page.actions.dispose(); page.controller.dispose();};
  const pageFor = (route: {kind: 'book' | 'audiobook'; entry: ContentEntry}): Page | undefined => {
    if (!current() || route.entry.kind !== 'book' && route.entry.kind !== 'author' && route.entry.kind !== 'book_series' || !route.entry.libraryId) return;
    const key = JSON.stringify([route.entry.libraryId, route.entry.id]);
    let page = pages.get(key);
    if (!page) {
      const controller = new NativeAudiobookController({context, kind: route.entry.kind as 'book' | 'author' | 'book_series', libraryId: route.entry.libraryId, id: route.entry.id});
      // The cached page's actions outlive one route, so their lifetime follows the
      // route this page is actually drawn under: the slot is replaced on every
      // render and only the live route may match it. The shared entry actions also
      // hold every menu and play operation to the navigation revision it started
      // under, so an operation retained from an earlier visit cannot adopt a
      // successor route.
      const drawn: {route?: NativeShellRoute} = {};
      const actions = createNativeEntryActions(context, {current: () => current() && drawn.route !== undefined && context.navigation.getSnapshot().route === drawn.route,
        contains: entry => controller.contains(entry), subscribe: controller.subscribe});
      page = Object.freeze({key, entry: route.entry, controller, actions, drawn});
      pages.set(key, page);
      while (pages.size > 3) {
        const oldest = pages.entries().next().value as [string, Page] | undefined;
        if (!oldest) break;
        pages.delete(oldest[0]); close(oldest[1]);
      }
      void controller.load();
    }
    return page;
  };
  const renderer: NativeRouteRenderer = {
    render: (route, runtime) => {
      if (route.kind !== 'book' && route.kind !== 'audiobook') return null;
      const page = pageFor(route);
      if (!page) return null;
      // This render's callbacks belong to this exact drawn route. The cache may have
      // been built under an earlier visit, and a retained callback must never act on
      // a successor route: both the authority lifetime and the live route identity
      // are checked, and navigation re-checks the authority it is handed.
      page.drawn.route = route;
      const stillDrawn = () => current() && context.navigation.isCurrent() && context.navigation.getSnapshot().route === route;
      const back = () => {if (stillDrawn()) context.navigation.back(context.authority());};
      // The screens receive a facade built for this render, never the cached
      // service itself: a retained callback from an earlier route cannot open a
      // new menu under the route that happens to be live now. The cached service
      // keeps following page.drawn.route for its own asynchronous work.
      const actions: Pick<ReturnType<typeof createNativeEntryActions>, 'menu'> = Object.freeze({
        menu: (...args: MenuArgs) => {if (stillDrawn()) page.actions.menu(...args);},
      });
      // An author or series named by a book's own context keeps that book's library,
      // so its destination is a real page and the rail can still highlight the
      // library; the entry's own library wins when the server sent one.
      const openEntry = (entry: ContentEntry) => {
        if (!stillDrawn() || !page.entry.libraryId) return;
        const target: ContentEntry = entry.libraryId ? entry : Object.freeze({...entry, libraryId: page.entry.libraryId});
        context.navigation.open(entry.kind === 'book' ? {kind: 'book', entry: target} : {kind: 'audiobook', entry: target}, context.authority());
      };
      return route.kind === 'book'
        ? <BookScreen controller={page.controller} entry={page.entry} runtime={runtime} actions={actions} openEntry={openEntry} onBack={back}/>
        : <AuthorSeriesScreen controller={page.controller} entry={page.entry} runtime={runtime} actions={actions} openEntry={openEntry} onBack={back}/>;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const page of pages.values()) close(page);
      pages.clear();
    },
  };
  return Object.freeze(renderer);
}

nativeShellRoutes.registerRoute('book', createNativeBookRenderer);
nativeShellRoutes.registerRoute('audiobook', createNativeBookRenderer);

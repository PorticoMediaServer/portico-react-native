import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import type {NativeShellBootstrapContext} from '../../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../../shell/route-registry';
import {nativeDestinationLifetime} from '../lifetime';
import {createNativeEntryActions} from '../entry-actions';
import {NativeAudiobookController} from './model';
import {BookScreen} from './BookScreen';

type Page = Readonly<{key: string; entry: ContentEntry; controller: NativeAudiobookController; actions: ReturnType<typeof createNativeEntryActions>}>;

/** Phone 41a and TV 43: the real book page. One route-owned controller per book. */
export function createNativeBookRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = nativeDestinationLifetime(context);
  let pages = new Map<string, Page>(), disposed = false;
  const current = () => !disposed && lifetime.current();
  const close = (page: Page) => {page.actions.dispose(); page.controller.dispose();};
  const pageFor = (route: {kind: 'book'; entry: ContentEntry}): Page | undefined => {
    if (!current() || route.entry.kind !== 'book' || !route.entry.libraryId) return;
    const key = JSON.stringify([route.entry.libraryId, route.entry.id]);
    let page = pages.get(key);
    if (!page) {
      const controller = new NativeAudiobookController({context, kind: 'book', libraryId: route.entry.libraryId, id: route.entry.id});
      const actions = createNativeEntryActions(context, {current: () => current() && context.navigation.getSnapshot().route === route,
        contains: entry => controller.contains(entry), subscribe: controller.subscribe});
      page = Object.freeze({key, entry: route.entry, controller, actions});
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
      if (route.kind !== 'book') return null;
      const page = pageFor(route);
      if (!page) return null;
      return <BookScreen controller={page.controller} entry={page.entry} runtime={runtime} actions={page.actions}
        onBack={() => {if (current()) context.navigation.back(context.authority());}}/>;
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

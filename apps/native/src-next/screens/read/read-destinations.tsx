import React from 'react';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../shell/route-registry';
import type {NativeShellRoute} from '../../shell/routes';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {openNativeReadingSettings} from '../settings/ReadingSettingsRoute';
import {isReadingLibraryKind} from './platform';
import {NativeReadBook} from './read-book-model';
import {NativeReadSeries} from './read-series-model';
import {ReadBookScreen} from './ReadBookScreen';
import {ReadSeriesScreen} from './ReadSeriesScreen';

/** phone-read 3/3c and 4/4c: route-owned book and series destinations. The cache
 * holds inert controllers only; each page arms and loads from its own layout
 * effect with the exact route it was rendered under. The reader still opens
 * through the one existing read route/host. */
type BookRoute = Extract<NativeShellRoute, {kind: 'read-book'}>;
type SeriesRoute = Extract<NativeShellRoute, {kind: 'read-series'}>;

const bookKey = (route: BookRoute) => JSON.stringify([route.libraryId, route.item.id, route.item.sourceId]);
const seriesKey = (route: SeriesRoute) => JSON.stringify([route.libraryId, route.seriesId]);

/** A route may only render while its library is still a current authorized
 * Reading library and the descriptor still carries the same real ids. */
function readingLibrary(context: NativeShellBootstrapContext, libraryId: string) {
  if (!context.current() || !context.session()) return undefined;
  const library = context.libraries().find(candidate => candidate.id === libraryId);
  return library && isReadingLibraryKind(library.kind) ? library : undefined;
}
const bookRouteCurrent = (context: NativeShellBootstrapContext, route: BookRoute): boolean =>
  !!readingLibrary(context, route.libraryId) && route.item.libraryId === route.libraryId
  && typeof route.item.id === 'string' && route.item.id.length > 0
  && typeof route.item.sourceId === 'string' && route.item.sourceId.length > 0;
const seriesRouteCurrent = (context: NativeShellBootstrapContext, route: SeriesRoute): boolean =>
  !!readingLibrary(context, route.libraryId) && /^[A-Za-z0-9_-]{43}$/.test(route.seriesId);

function retain<T extends {dispose: () => void}>(pages: Map<string, T>, key: string, value: T): void {
  pages.set(key, value);
  while (pages.size > 3) {
    const oldest = pages.keys().next();
    if (oldest.done) return;
    const stale = pages.get(oldest.value);
    pages.delete(oldest.value);
    stale?.dispose();
  }
}

export function createNativeReadBookRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = nativeDestinationLifetime(context);
  const pages = new Map<string, NativeReadBook>();
  let disposed = false;
  const current = () => !disposed && lifetime.current();
  const controllerFor = (route: BookRoute): NativeReadBook | undefined => {
    if (!current() || !bookRouteCurrent(context, route)) return undefined;
    const key = bookKey(route);
    const cached = pages.get(key);
    if (cached) return cached;
    const page = new NativeReadBook(context, route);
    retain(pages, key, page);
    return page;
  };
  const renderer: NativeRouteRenderer = {
    render: (route, runtime) => {
      if (route.kind !== 'read-book') return null;
      const controller = controllerFor(route);
      if (!controller) return null;
      const library = readingLibrary(context, route.libraryId);
      if (!library) return null;
      return <ReadBookScreen controller={controller} route={route} comic={library.kind === 'comic'} runtime={runtime}
        onBack={() => {if (current() && context.navigation.getSnapshot().route === route) context.navigation.back(context.authority());}}
        onOpenSettings={() => {if (current() && context.navigation.getSnapshot().route === route) openNativeReadingSettings(context);}}/>;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const page of pages.values()) page.dispose();
      pages.clear();
    },
  };
  return Object.freeze(renderer);
}

export function createNativeReadSeriesRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = nativeDestinationLifetime(context);
  const pages = new Map<string, NativeReadSeries>();
  let disposed = false;
  const current = () => !disposed && lifetime.current();
  const controllerFor = (route: SeriesRoute): NativeReadSeries | undefined => {
    if (!current() || !seriesRouteCurrent(context, route)) return undefined;
    const key = seriesKey(route);
    const cached = pages.get(key);
    if (cached) return cached;
    const page = new NativeReadSeries(context, route);
    retain(pages, key, page);
    return page;
  };
  const renderer: NativeRouteRenderer = {
    render: (route, runtime) => {
      if (route.kind !== 'read-series') return null;
      const controller = controllerFor(route);
      const library = readingLibrary(context, route.libraryId);
      if (!controller || !library) return null;
      return <ReadSeriesScreen controller={controller} route={route} comic={library.kind === 'comic'} runtime={runtime}
        onBack={() => {if (current() && context.navigation.getSnapshot().route === route) context.navigation.back(context.authority());}}/>;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const page of pages.values()) page.dispose();
      pages.clear();
    },
  };
  return Object.freeze(renderer);
}

nativeShellRoutes.registerRoute('read-book', createNativeReadBookRenderer);
nativeShellRoutes.registerRoute('read-series', createNativeReadSeriesRenderer);

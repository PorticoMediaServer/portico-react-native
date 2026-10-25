import React from 'react';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../shell/route-registry';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {openNativeReadingSettings} from '../settings/ReadingSettingsRoute';
import {NativeReadBook} from './read-book-model';
import {NativeReadSeries} from './read-series-model';
import {ReadBookScreen} from './ReadBookScreen';
import {ReadSeriesScreen} from './ReadSeriesScreen';

/** phone-read 3/3c and 4/4c: route-owned book and series destinations. A page
 * keeps one real reading session projection; the reader still opens through the
 * one existing read route/host. */
type BookPage = Readonly<{key: string; item: {id: string; sourceId: string}; controller: NativeReadBook}>;
type SeriesPage = Readonly<{controller: NativeReadSeries; comic: boolean}>;

export function createNativeReadBookRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = nativeDestinationLifetime(context);
  const pages = new Map<string, BookPage>();
  let disposed = false;
  const current = () => !disposed && lifetime.current();
  const pageFor = (route: Extract<Parameters<NativeRouteRenderer['render']>[0], {kind: 'read-book'}>): NativeReadBook | undefined => {
    if (!current()) return;
    const key = JSON.stringify([route.libraryId, route.item.id, route.item.sourceId]);
    let page = pages.get(key);
    if (!page) {
      const controller = new NativeReadBook(context, route.libraryId, route.item);
      page = Object.freeze({key, item: {id: route.item.id, sourceId: route.item.sourceId}, controller});
      pages.set(key, page);
      while (pages.size > 3) {
        const oldest = pages.entries().next();
        if (oldest.done) break;
        pages.delete(oldest.value[0]);
        oldest.value[1].controller.dispose();
      }
      void controller.load();
    } else if (page.item.sourceId !== route.item.sourceId) {
      page.controller.dispose(); pages.delete(key);
      return pageFor(route);
    }
    return page.controller;
  };
  const renderer: NativeRouteRenderer = {
    render: (route, runtime) => {
      if (route.kind !== 'read-book') return null;
      const controller = pageFor(route);
      if (!controller) return null;
      return <ReadBookScreen controller={controller} runtime={runtime}
        onBack={() => {if (current()) context.navigation.back(context.authority());}}
        onOpenSettings={() => {if (current()) openNativeReadingSettings(context);}}/>;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const page of pages.values()) page.controller.dispose();
      pages.clear();
    },
  };
  return Object.freeze(renderer);
}

export function createNativeReadSeriesRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = nativeDestinationLifetime(context);
  const pages = new Map<string, SeriesPage>();
  let disposed = false;
  const current = () => !disposed && lifetime.current();
  const pageFor = (route: Extract<Parameters<NativeRouteRenderer['render']>[0], {kind: 'read-series'}>): SeriesPage | undefined => {
    if (!current()) return;
    const key = JSON.stringify([route.libraryId, route.seriesId]);
    let page = pages.get(key);
    if (!page) {
      const controller = new NativeReadSeries(context, route.libraryId, route.seriesId);
      page = Object.freeze({controller, comic: context.libraries().find(library => library.id === route.libraryId)?.kind === 'comic'});
      pages.set(key, page);
      while (pages.size > 3) {
        const oldest = pages.entries().next();
        if (oldest.done) break;
        pages.delete(oldest.value[0]);
        oldest.value[1].controller.dispose();
      }
      void controller.load();
    }
    return page;
  };
  const renderer: NativeRouteRenderer = {
    render: (route, runtime) => {
      if (route.kind !== 'read-series') return null;
      const page = pageFor(route);
      if (!page) return null;
      return <ReadSeriesScreen controller={page.controller} comic={page.comic} runtime={runtime}
        onBack={() => {if (current()) context.navigation.back(context.authority());}}/>;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const page of pages.values()) page.controller.dispose();
      pages.clear();
    },
  };
  return Object.freeze(renderer);
}

nativeShellRoutes.registerRoute('read-book', createNativeReadBookRenderer);
nativeShellRoutes.registerRoute('read-series', createNativeReadSeriesRenderer);

import {Platform} from 'react-native';
import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import type {NativeShellBootstrapContext} from '../../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../../shell/route-registry';
import {nativeDestinationLifetime} from '../lifetime';
import {createNativeEntryActions} from '../entry-actions';
import {NativeTVMusicController} from './model';
import {TVAlbumScreen, TVArtistScreen} from './TVMusicScreens';
import {PhoneAlbumScreen, PhoneArtistScreen} from './PhoneMusicScreens';
import {createMusicPlaylistPicker, type MusicPlaylistPickerHandle} from './MusicPlaylistPicker';
import {nativeDownloadRequest} from '../../watch/download-request';
import {askNativeDownload} from '../../downloads/request';
import './MusicDiscoverRoute';

type Page = Readonly<{key: string; entry: ContentEntry; controller: NativeTVMusicController; actions: ReturnType<typeof createNativeEntryActions>; picker: MusicPlaylistPickerHandle; abort: AbortController}>;

/** tv-more6–9: TV's album and artist pages. One route-owned controller per entry;
 * the shared queue player and the borrowed Watch menu do the work. */
export function createNativeTVMusicRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = nativeDestinationLifetime(context);
  let pages = new Map<string, Page>(), disposed = false;
  const close = (page: Page) => {page.abort.abort(); page.picker.dispose(); page.actions.dispose(); page.controller.dispose();};
  const current = () => !disposed && lifetime.current();
  const pageFor = (route: {kind: 'music'; entry: ContentEntry}): Page | undefined => {
    if (!current() || route.entry.kind !== 'album' && route.entry.kind !== 'artist') return;
    const key = JSON.stringify([route.entry.kind, route.entry.id]);
    let page = pages.get(key);
    if (!page) {
      const controller = new NativeTVMusicController({api: context.api, entry: route.entry, lifetime, playback: context.playback});
      const actions = createNativeEntryActions(context, {current: () => current() && context.navigation.getSnapshot().route === route,
        contains: entry => controller.contains(entry), subscribe: controller.subscribe});
      page = Object.freeze({key, entry: route.entry, controller, actions, picker: createMusicPlaylistPicker(context), abort: new AbortController()});
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
      if (route.kind !== 'music') return null;
      const page = pageFor(route);
      if (!page) return null;
      const openEntry = (entry: ContentEntry) => {if (current()) context.navigation.open({kind: 'music', entry}, context.authority());};
      const back = () => {if (current()) context.navigation.back(context.authority());};
      const download = (entry: ContentEntry) => {const request = nativeDownloadRequest(entry); if (request) askNativeDownload(request);};
      const pageCurrent = () => {
        const active = context.navigation.getSnapshot().route;
        return !!active && active.kind === 'music' && active.entry.kind === page.entry.kind && active.entry.id === page.entry.id;
      };
      const onPlaylist = page.entry.kind === 'album' ? () => page.picker.openAlbum(
        {albumId: page.entry.id, load: () => page.controller.albumMembership()},
        {signal: page.abort.signal, isCurrent: () => current() && pageCurrent()},
      ) : undefined;
      if (!Platform.isTV) return page.entry.kind === 'album'
        ? <PhoneAlbumScreen controller={page.controller} entry={page.entry} runtime={runtime} actions={page.actions} openEntry={openEntry} onBack={back} download={download} onPlaylist={onPlaylist}/>
        : <PhoneArtistScreen controller={page.controller} entry={page.entry} runtime={runtime} actions={page.actions} openEntry={openEntry} onBack={back}/>;
      return <>
        {page.entry.kind === 'album'
          ? <TVAlbumScreen controller={page.controller} entry={page.entry} runtime={runtime} actions={page.actions} openEntry={openEntry} onPlaylist={onPlaylist}/>
          : <TVArtistScreen controller={page.controller} entry={page.entry} runtime={runtime} actions={page.actions} openEntry={openEntry}/>}
        {page.picker.render(runtime)}
      </>;
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

nativeShellRoutes.registerRoute('music', createNativeTVMusicRenderer);

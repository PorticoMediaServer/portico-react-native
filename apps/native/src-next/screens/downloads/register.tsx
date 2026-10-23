import React from 'react';
import {View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {nativeShellRoutes, type NativeRouteFactory} from '../../shell/route-registry';
import {phoneBarHeight, shellLayout} from '../../shell/model';
import {titleRoute} from '../../shell/routes';
import {DownloadsScreen} from './DownloadsScreen';
import {createNativeDownloadsDevice} from './device';
import type {NativeDownloadsCopy} from './presentation';

export const nativeDownloadsCopy = Object.freeze({
  emptyBody: 'next.saved.phone.emptyBody', storageLimitHelp: 'next.saved.phone.storageLimitHelp', freeOnPhone: 'next.saved.phone.free',
  removeFromPhone: 'next.saved.phone.remove', stoppedBody: 'next.saved.stopped', downloading: 'next.saved.downloading',
  needsCheckIn: 'next.saved.checkIn', goneFromServer: 'next.saved.phone.gone', otherProfiles: 'next.saved.phone.otherProfiles',
  stoppedAt: 'server.plays.stoppedAt', stoppedHelp: 'next.saved.phone.stoppedHelp',
} satisfies NativeDownloadsCopy);

function DownloadsRoute(props: React.ComponentProps<typeof DownloadsScreen>) {
  const insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  const layout = shellLayout(dimensions.width, dimensions.height, false);
  // This route covers the Saved page while its genuine bottom navigation remains mounted.
  return <View style={{flex: 1, marginBottom: layout.tabs ? phoneBarHeight(insets.bottom) : 0}}><DownloadsScreen {...props}/></View>;
}

export const createNativeDownloadsModule: NativeRouteFactory = context => {
  const bound = createNativeDownloadsDevice(context);
  return {
    render: (route, runtime) => route.kind === 'downloads' ? <DownloadsRoute device={bound.device} runtime={runtime} copy={nativeDownloadsCopy}
      back={() => {if (context.current()) context.navigation.back(context.authority());}}
      openTitle={entry => {
        if (!context.current()) return;
        const live = bound.device.getSnapshot().entries.find(value => value.id === entry.id && value.itemId === entry.itemId);
        const kind = live?.info?.kind ?? live?.kind;
        if (!live || !live.libraryId || !kind || !['movie', 'episode', 'song', 'audiobook_file', 'extra'].includes(kind)) {
          runtime.reportError(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
        }
        // The descriptor uses the cached title's actual identity. The Title owner
        // reads its authorized detail; this does not synthesize a detail response.
        const title: ContentEntry = {id: live.itemId, libraryId: live.libraryId, kind: kind as ContentEntry['kind'], title: live.info?.title || live.title};
        context.navigation.open(titleRoute(title), context.authority());
      }}/> : null,
    dispose: bound.dispose,
  };
};

nativeShellRoutes.registerRoute('downloads', createNativeDownloadsModule);

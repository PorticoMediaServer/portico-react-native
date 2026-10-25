import React from 'react';
import {View, useWindowDimensions} from 'react-native';
import {useTheme} from '../../kit/theme';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {nativeShellRoutes, type NativeRouteFactory} from '../../shell/route-registry';
import {phoneBarHeight, shellLayout} from '../../shell/model';
import {nativeEntryRoute} from '../../shell/routes';
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
  const insets = useSafeAreaInsets(), dimensions = useWindowDimensions(), theme = useTheme();
  const layout = shellLayout(dimensions.width, dimensions.height, false);
  const landscapePhone = layout.kind === 'phone' && dimensions.width > dimensions.height;
  // This route covers the Saved page while its genuine bottom navigation remains mounted.
  // Its own absolute box (and ink) means a natural-height screen can never let the
  // previous route show through below the list.
  return <View style={{position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: theme.colors.ink,
    paddingBottom: layout.tabs ? phoneBarHeight(insets.bottom, landscapePhone) : 0}}><DownloadsScreen {...props}/></View>;
}

export const createNativeDownloadsModule: NativeRouteFactory = context => {
  const bound = createNativeDownloadsDevice(context);
  return {
    render: (route, runtime) => route.kind === 'downloads' ? <DownloadsRoute device={bound.device} service={bound.service} runtime={runtime} copy={nativeDownloadsCopy}
      back={() => {if (context.current()) context.navigation.back(context.authority());}}
      openTitle={entry => {
        if (!context.current()) return;
        const live = bound.device.getSnapshot().entries.find(value => value.id === entry.id && value.itemId === entry.itemId);
        const kind = live?.info?.kind ?? live?.kind;
        // A downloaded publication opens the shared book destination, which reads
        // the real ebook or comic entity from its authorized library page. The
        // download's own metadata only supplies that genuine identity.
        const destinationKind = kind === 'ebook' || kind === 'comic' ? 'book' : kind;
        if (!live || !live.libraryId || !kind || !['movie', 'episode', 'song', 'audiobook_file', 'extra', 'ebook', 'comic'].includes(kind)) {
          runtime.reportError(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
        }
        // The descriptor uses the cached title's actual identity. The Title owner
        // reads its authorized detail; this does not synthesize a detail response.
        const title: ContentEntry = {id: live.itemId, libraryId: live.libraryId, kind: destinationKind as ContentEntry['kind'], title: live.info?.title || live.title};
        context.navigation.open(nativeEntryRoute(title), context.authority());
      }}/> : null,
    dispose: bound.dispose,
  };
};

nativeShellRoutes.registerRoute('downloads', createNativeDownloadsModule);

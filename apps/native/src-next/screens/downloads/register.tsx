import React, {useLayoutEffect} from 'react';
import {View, useWindowDimensions} from 'react-native';
import {useTheme} from '../../kit/theme';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteFactory} from '../../shell/route-registry';
import {phoneBarHeight, sameAuthority, shellLayout, type ShellAuthority} from '../../shell/model';
import {nativeEntryRoute, type NativeShellRoute} from '../../shell/routes';
import type {OfflineEntry} from '../../platform/offline-downloads';
import {openNativeReadingDetail, type NativeReadOrigin} from '../read/eligibility';
import {isReadingLibraryKind} from '../read/platform';
import {DownloadsScreen} from './DownloadsScreen';
import {createNativeDownloadsDevice} from './device';
import type {NativeDownloadsCopy} from './presentation';

export const nativeDownloadsCopy = Object.freeze({
  emptyBody: 'next.saved.phone.emptyBody', storageLimitHelp: 'next.saved.phone.storageLimitHelp', freeOnPhone: 'next.saved.phone.free',
  removeFromPhone: 'next.saved.phone.remove', stoppedBody: 'next.saved.stopped', downloading: 'next.saved.downloading',
  needsCheckIn: 'next.saved.checkIn', goneFromServer: 'next.saved.phone.gone', otherProfiles: 'next.saved.phone.otherProfiles',
  stoppedAt: 'server.plays.stoppedAt', stoppedHelp: 'next.saved.phone.stoppedHelp',
} satisfies NativeDownloadsCopy);

/** The route instance this list actually rendered on, captured in layout. A
 * press never adopts a later route, session, authority or signal. */
type DownloadsLease = Readonly<{
  origin: NativeReadOrigin; sessionFamilyId: string; authority: ShellAuthority; signal: AbortSignal;
}>;
type DownloadsLeaseRef = {current?: DownloadsLease};

function DownloadsRoute({context, lease, route, ...props}: React.ComponentProps<typeof DownloadsScreen> & Readonly<{
  context: NativeShellBootstrapContext; lease: DownloadsLeaseRef; route: NativeShellRoute;
}>) {
  const insets = useSafeAreaInsets(), dimensions = useWindowDimensions(), theme = useTheme();
  const layout = shellLayout(dimensions.width, dimensions.height, false);
  const landscapePhone = layout.kind === 'phone' && dimensions.width > dimensions.height;
  useLayoutEffect(() => {
    const snapshot = context.navigation.getSnapshot(), selected = context.session();
    if (!selected || snapshot.route !== route) return;
    const abort = new AbortController();
    lease.current = Object.freeze({
      origin: Object.freeze({route: snapshot.route, revision: snapshot.revision}),
      sessionFamilyId: selected.sessionFamilyId, authority: Object.freeze({...context.authority()}), signal: abort.signal,
    });
    return () => {abort.abort(); if (lease.current?.signal === abort.signal) lease.current = undefined;};
  }, [context, lease, route]);
  // This route covers the Saved page while its genuine bottom navigation remains mounted.
  // Its own absolute box (and ink) means a natural-height screen can never let the
  // previous route show through below the list.
  return <View style={{position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: theme.colors.ink,
    paddingBottom: layout.tabs ? phoneBarHeight(insets.bottom, landscapePhone) : 0}}><DownloadsScreen {...props}/></View>;
}

/** The exact rendered copy, not a reselection from newer state. */
const downloadIdentity = (entry: OfflineEntry): string => JSON.stringify([entry.id, entry.itemId, entry.libraryId,
  entry.kind, entry.info?.kind, entry.owner, entry.receipt?.receiptId]);

export const createNativeDownloadsModule: NativeRouteFactory = context => {
  const bound = createNativeDownloadsDevice(context);
  const lease: DownloadsLeaseRef = {};
  let readingOpening: object | undefined;
  const currentLease = (): DownloadsLease | undefined => {
    const live = lease.current;
    if (!live || !context.current()) return undefined;
    const selected = context.session(), snapshot = context.navigation.getSnapshot();
    if (!selected || selected.sessionFamilyId !== live.sessionFamilyId || !sameAuthority(live.authority, context.authority())) return undefined;
    return snapshot.route === live.origin.route && snapshot.revision === live.origin.revision ? live : undefined;
  };
  return {
    render: (route, runtime) => route.kind === 'downloads' ? <DownloadsRoute context={context} lease={lease} route={route} device={bound.device} service={bound.service} runtime={runtime} copy={nativeDownloadsCopy}
      back={() => {if (context.current()) context.navigation.back(context.authority());}}
      openTitle={entry => {
        const active = currentLease();
        if (!active) return;
        const live = bound.device.getSnapshot().entries.find(value => value.id === entry.id && value.itemId === entry.itemId);
        const kind = live?.info?.kind ?? live?.kind;
        if (!live || !live.libraryId || !kind) {
          runtime.reportError(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
        }
        // A downloaded book or comic opens its own Reading page. The item and
        // version come from the device's signed binding; the page's start facts
        // come from an authorized preview manifest, never the cached label.
        if (kind === 'ebook' || kind === 'comic') {
          if (downloadIdentity(live) !== downloadIdentity(entry)) {
            runtime.reportError(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
          }
          const library = context.libraries().find(value => value.id === live.libraryId);
          if (!library || !isReadingLibraryKind(library.kind)) {
            runtime.reportError(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
          }
          let source: Readonly<{sourceId: string; revision: string}> | undefined;
          try {source = bound.device.publicationSource?.(live);} catch (error) {if (currentLease() === active) runtime.reportError(error); return;}
          if (!source) {runtime.reportError(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;}
          if (readingOpening) return;
          const ticket = {};
          readingOpening = ticket;
          void openNativeReadingDetail(context, active.origin, {libraryId: live.libraryId, itemId: live.itemId, sourceId: source.sourceId, title: live.info?.title || live.title,
            stillCurrent: () => {
              if (currentLease() !== active) return false;
              const now = bound.device.getSnapshot().entries.find(value => value.id === entry.id && value.itemId === entry.itemId);
              return !!now && downloadIdentity(now) === downloadIdentity(entry);
            }}, active.signal)
            .then(ok => {
              if (ok || currentLease() !== active || active.signal.aborted) return;
              runtime.reportError(Object.assign(new Error('source_unavailable'), {code: 'source_unavailable'}));
            }, error => {if (currentLease() === active && !active.signal.aborted) runtime.reportError(error);})
            .finally(() => {if (readingOpening === ticket) readingOpening = undefined;});
          return;
        }
        if (!['movie', 'episode', 'song', 'audiobook_file', 'extra'].includes(kind)) {
          runtime.reportError(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
        }
        // The descriptor uses the cached title's actual identity. The Title owner
        // reads its authorized detail; this does not synthesize a detail response.
        const title: ContentEntry = {id: live.itemId, libraryId: live.libraryId, kind: kind as ContentEntry['kind'], title: live.info?.title || live.title};
        context.navigation.open(nativeEntryRoute(title), context.authority());
      }}/> : null,
    dispose: bound.dispose,
  };
};

nativeShellRoutes.registerRoute('downloads', createNativeDownloadsModule);

import React, {useLayoutEffect, useState} from 'react';
import {View, useWindowDimensions} from 'react-native';
import {useTheme} from '../../kit/theme';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteFactory} from '../../shell/route-registry';
import {phoneBarHeight, sameAuthority, shellLayout, type ShellAuthority} from '../../shell/model';
import {nativeEntryRoute, type NativeShellRoute} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
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

/** The route instance this list actually rendered on, committed in layout. A
 * press passes the lease of the render that showed its entry; it never selects
 * a successor lease. */
type DownloadsLease = Readonly<{
  origin: NativeReadOrigin; sessionFamilyId: string; authority: ShellAuthority; signal: AbortSignal;
}>;

function DownloadsRoute({context, route, onTitle, runtime, ...props}: Omit<React.ComponentProps<typeof DownloadsScreen>, 'openTitle'> & Readonly<{
  context: NativeShellBootstrapContext; route: NativeShellRoute; onTitle: (entry: OfflineEntry, lease: DownloadsLease, runtime: NativeShellRuntime) => void;
}>) {
  const insets = useSafeAreaInsets(), dimensions = useWindowDimensions(), theme = useTheme();
  const layout = shellLayout(dimensions.width, dimensions.height, false);
  const landscapePhone = layout.kind === 'phone' && dimensions.width > dimensions.height;
  // The rendered list and its openTitle callback share this exact committed
  // lease. A later route gets its own lease and aborts this one.
  const [lease, setLease] = useState<DownloadsLease | undefined>(undefined);
  useLayoutEffect(() => {
    const snapshot = context.navigation.getSnapshot(), selected = context.session();
    if (!selected || snapshot.route !== route) {setLease(undefined); return;}
    const abort = new AbortController();
    setLease(Object.freeze({
      origin: Object.freeze({route: snapshot.route, revision: snapshot.revision}),
      sessionFamilyId: selected.sessionFamilyId, authority: Object.freeze({...context.authority()}), signal: abort.signal,
    }));
    return () => {abort.abort();};
  }, [context, route]);
  // This route covers the Saved page while its genuine bottom navigation remains mounted.
  // Its own absolute box (and ink) means a natural-height screen can never let the
  // previous route show through below the list.
  return <View style={{position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: theme.colors.ink,
    paddingBottom: layout.tabs ? phoneBarHeight(insets.bottom, landscapePhone) : 0}}><DownloadsScreen {...props} runtime={runtime}
      openTitle={entry => {if (lease) onTitle(entry, lease, runtime);}}/></View>;
}

/** The exact rendered copy, not a reselection from newer state. */
const downloadIdentity = (entry: OfflineEntry): string => JSON.stringify([entry.id, entry.itemId, entry.libraryId,
  entry.kind, entry.info?.kind, entry.owner, entry.receipt?.receiptId]);

export const createNativeDownloadsModule: NativeRouteFactory = context => {
  const bound = createNativeDownloadsDevice(context);
  let readingOpening: object | undefined;
  const leaseValid = (supplied: DownloadsLease): boolean => {
    if (supplied.signal.aborted || !context.current()) return false;
    const selected = context.session(), snapshot = context.navigation.getSnapshot();
    return !!selected && selected.sessionFamilyId === supplied.sessionFamilyId
      && sameAuthority(supplied.authority, context.authority())
      && snapshot.route === supplied.origin.route && snapshot.revision === supplied.origin.revision;
  };
  const openTitle = (entry: OfflineEntry, supplied: DownloadsLease, runtime: NativeShellRuntime) => {
    if (!leaseValid(supplied)) return;
    const report = (error: unknown) => runtime.reportError(error);
    const live = bound.device.getSnapshot().entries.find(value => value.id === entry.id && value.itemId === entry.itemId);
    const kind = live?.info?.kind ?? live?.kind;
    if (!live || !live.libraryId || !kind) {
      report(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
    }
    // A downloaded book or comic opens its own Reading page. The item and
    // version come from the device's signed binding; the page's start facts
    // come from an authorized preview manifest, never the cached label.
    if (kind === 'ebook' || kind === 'comic') {
      if (downloadIdentity(live) !== downloadIdentity(entry)) {
        report(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
      }
      const library = context.libraries().find(value => value.id === live.libraryId);
      if (!library || !isReadingLibraryKind(library.kind)) {
        report(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
      }
      let source: Readonly<{sourceId: string; revision: string}> | undefined;
      try {source = bound.device.publicationSource?.(live);} catch (error) {if (leaseValid(supplied)) report(error); return;}
      if (!source) {report(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;}
      if (readingOpening) return;
      const ticket = {};
      readingOpening = ticket;
      void openNativeReadingDetail(context, supplied.origin, {libraryId: live.libraryId, itemId: live.itemId, sourceId: source.sourceId, title: live.info?.title || live.title,
        stillCurrent: () => {
          if (!leaseValid(supplied)) return false;
          const now = bound.device.getSnapshot().entries.find(value => value.id === entry.id && value.itemId === entry.itemId);
          return !!now && downloadIdentity(now) === downloadIdentity(entry);
        }}, supplied.signal)
        .then(ok => {
          if (ok || !leaseValid(supplied)) return;
          report(Object.assign(new Error('source_unavailable'), {code: 'source_unavailable'}));
        }, error => {if (leaseValid(supplied)) report(error);})
        .finally(() => {if (readingOpening === ticket) readingOpening = undefined;});
      return;
    }
    if (!['movie', 'episode', 'song', 'audiobook_file', 'extra'].includes(kind)) {
      report(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
    }
    // The descriptor uses the cached title's actual identity. The Title owner
    // reads its authorized detail; this does not synthesize a detail response.
    const title: ContentEntry = {id: live.itemId, libraryId: live.libraryId, kind: kind as ContentEntry['kind'], title: live.info?.title || live.title};
    context.navigation.open(nativeEntryRoute(title), context.authority());
  };
  return {
    render: (route, runtime) => route.kind === 'downloads' ? <DownloadsRoute context={context} route={route} onTitle={openTitle} device={bound.device} service={bound.service} runtime={runtime} copy={nativeDownloadsCopy}
      back={() => {if (context.current()) context.navigation.back(context.authority());}}/> : null,
    dispose: bound.dispose,
  };
};

nativeShellRoutes.registerRoute('downloads', createNativeDownloadsModule);

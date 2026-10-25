import React from 'react';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeEntryRoute} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
import {DownloadsScreen} from './DownloadsScreen';
import {createNativeDownloadsDevice} from './device';
import type {NativeOfflineDownloadsDevice, OfflineEntry} from '../../platform/offline-downloads';
import type {NativeDownloadsCopy} from './presentation';

export const nativeDownloadsCopy = Object.freeze({
  emptyBody: 'next.saved.phone.emptyBody', storageLimitHelp: 'next.saved.phone.storageLimitHelp', freeOnPhone: 'next.saved.phone.free',
  removeFromPhone: 'next.saved.phone.remove', stoppedBody: 'next.saved.stopped', downloading: 'next.saved.downloading',
  needsCheckIn: 'next.saved.checkIn', goneFromServer: 'next.saved.phone.gone', otherProfiles: 'next.saved.phone.otherProfiles',
  stoppedAt: 'server.plays.stoppedAt', stoppedHelp: 'next.saved.phone.stoppedHelp',
} satisfies NativeDownloadsCopy);

/** The row's own title identity. Existing watching kinds only; the reading item-ID
 * seam stays with the Reading owner, so a publication is not sent to the wrong page. */
export function openNativeDownloadTitle(context: NativeShellBootstrapContext, device: NativeOfflineDownloadsDevice, entry: OfflineEntry, runtime: NativeShellRuntime) {
  if (!context.current()) return;
  const live = device.getSnapshot().entries.find(value => value.id === entry.id && value.itemId === entry.itemId);
  const kind = live?.info?.kind ?? live?.kind;
  if (!live || !live.libraryId || !kind || !['movie', 'episode', 'song', 'audiobook_file', 'extra'].includes(kind)) {
    runtime.reportError(Object.assign(new Error('invalid_response'), {code: 'invalid_response'})); return;
  }
  // The descriptor uses the cached title's actual identity. The Title owner
  // reads its authorized detail; this does not synthesize a detail response.
  const title: ContentEntry = {id: live.itemId, libraryId: live.libraryId, kind: kind as ContentEntry['kind'], title: live.info?.title || live.title};
  context.navigation.open(nativeEntryRoute(title), context.authority());
}

/** One real Downloads screen over the authority-local device, usable as the pushed
 * route or inside Saved's Downloads tab. The owner of this view retires its lease. */
export function createNativeDownloadsView(context: NativeShellBootstrapContext) {
  const bound = createNativeDownloadsDevice(context);
  return Object.freeze({
    render: (runtime: NativeShellRuntime, inline = false) => <DownloadsScreen device={bound.device} service={bound.service} runtime={runtime} copy={nativeDownloadsCopy} inline={inline}
      back={() => {if (context.current()) context.navigation.back(context.authority());}}
      openTitle={entry => openNativeDownloadTitle(context, bound.device, entry, runtime)}/>,
    dispose: bound.dispose,
  });
}

import {offlineDownloads, offlineOwnerKey, type OfflineDownloads, type OfflineEntry, type OfflineSettings} from '../../platform/offline-downloads';
import {serviceText} from '../../../../packages/client-core/src/presentation/service-text';

export {groupOfflineEntries} from '../../platform/offline-downloads';
export type {OfflineEntry, OfflineSettings, OfflineSnapshot, OfflineGroup} from '../../platform/offline-downloads';

/** The shell alone binds the current viewer/server through adopt/connect/disconnect. */
export {offlineDownloads};

type DeviceDownloads = Pick<OfflineDownloads, 'getSnapshot' | 'subscribe' | 'open' | 'setSettings' | 'pause' | 'resume' | 'remove' | 'removeOthers' | 'playable' | 'note' | 'localMedia'>;
export type NativeOfflineDownloadsAdapter = Readonly<{
  getSnapshot: DeviceDownloads['getSnapshot'];
  subscribe: DeviceDownloads['subscribe'];
  open: DeviceDownloads['open'];
  setSettings: (settings: Partial<OfflineSettings>) => Promise<void>;
  pause: (entry: OfflineEntry) => Promise<void>;
  resume: (entry: OfflineEntry) => Promise<void>;
  remove: (entry: OfflineEntry) => Promise<void>;
  removeOthers: () => Promise<void>;
  playable: (entry: OfflineEntry) => string;
  note: (entry: OfflineEntry) => string;
  localMedia: DeviceDownloads['localMedia'];
  openOffline: (entry: OfflineEntry) => Promise<void>;
}>;

/** No server list and no second native module owner. Resolve every action against the
 * currently published viewer list, so an old screen cannot act on another viewer's file. */
export function createNativeOfflineDownloadsAdapter(
  openOffline: (entry: OfflineEntry) => Promise<void>,
  device: DeviceDownloads = offlineDownloads,
): NativeOfflineDownloadsAdapter {
  const current = (entry: OfflineEntry): OfflineEntry => {
    const live = device.getSnapshot().entries.find(value => value.id === entry.id);
    const owner = (value: OfflineEntry) => value.receipt ? offlineOwnerKey(value.receipt.claims.viewer) : value.owner;
    if (!live || live.itemId !== entry.itemId || owner(live) !== owner(entry)) throw new Error(serviceText('downloads.offline.otherProfile'));
    return live;
  };
  return Object.freeze({
    getSnapshot: device.getSnapshot,
    subscribe: device.subscribe,
    open: () => device.open(),
    setSettings: settings => device.setSettings(settings),
    pause: entry => device.pause(current(entry)),
    resume: entry => device.resume(current(entry)),
    remove: entry => device.remove(current(entry)),
    removeOthers: () => device.removeOthers(),
    playable: entry => device.playable(current(entry)),
    note: entry => device.note(current(entry)),
    localMedia: entry => device.localMedia(current(entry)),
    openOffline: async entry => {
      const live = current(entry), reason = device.playable(live);
      if (reason) throw new Error(reason);
      await openOffline(live);
    },
  });
}

import {KnownDirectServers, type KnownServerStorage} from '../../../../packages/client-core/src/known-servers';
import {NativeQueueStore} from './queue-storage';

/**
 * Remembered direct servers on Apple (client-core `KnownDirectServers`): the list lives in the
 * app's native record store (atomic read-modify-write); it holds no credentials.
 */
const store = new NativeQueueStore();
const KEY = 'known-direct-servers';

export const appleKnownServerStorage: KnownServerStorage = {
  read: () => store.change(KEY, raw => ({record: raw, value: raw ?? undefined})),
  change: async update => {
    await store.change(KEY, raw => {
      const next = update(raw ?? undefined);
      return {record: (next ?? null) as never, value: undefined};
    });
  },
};

export const knownDirectServers = new KnownDirectServers(appleKnownServerStorage);
